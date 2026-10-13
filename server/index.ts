/**
 * HookLab Local: an Express server on 127.0.0.1 that serves the React app and its JSON API.
 * Nothing is reachable from other machines, and API keys never leave this process except
 * to go directly to the LLM / transcription provider you configured.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pipeline as pump } from 'node:stream/promises';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_MODELS,
  PORT,
  ROOT,
  connectors,
  defaultConnector,
  env,
  getConnector,
  localWhisperProblem,
  transcriberChain,
  transcription,
} from './config';
import { runTurn, testConnector } from './pipeline';
import { OLLAMA_URL, ollamaStatus, saveSettings, setupSummary, startOllamaPull, testGroqKey } from './settings';
import { MAX_VIDEOS_PER_MESSAGE, UPLOAD_ID_RE, videoSources } from './sources';
import * as store from './store';
import { INSTALL_HINTS, ensureYtdlp, toolVersions, ytdlpState } from './tools';
import type { Message, Video } from './types';

const DEV = process.argv.includes('--dev');
const HOST = '127.0.0.1';
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 8000;
const UPLOAD_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const TERMS_TEXT = readFileSync(join(ROOT, 'TERMS.md'), 'utf8');
const TERMS_VERSION = createHash('sha256').update(TERMS_TEXT).digest('hex').slice(0, 12);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const app = express();
app.disable('x-powered-by');

// ---- local-only guard ---------------------------------------------------------
// The server listens on 127.0.0.1 only. These checks also stop other websites open in your browser
// from using it: DNS-rebinding (wrong Host header) and cross-site requests (foreign Origin) are refused.
app.use((req, res, next) => {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!LOCAL_HOSTNAMES.has(hostname)) return res.status(403).send('HookLab only answers on localhost.');
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      ok = LOCAL_HOSTNAMES.has(new URL(origin).hostname.replace(/^\[|\]$/g, ''));
    } catch {
      // "null" or malformed origins are refused
    }
    if (!ok) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!DEV) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  next();
});

const api = express.Router();
api.use(express.json({ limit: '100kb' }));

// Use of the app requires accepting the terms once; the acceptance is stored in data/terms-accepted.json.
api.use(async (req, _res, next) => {
  if (req.path === '/status' || req.path === '/terms' || req.path === '/terms/accept') return next();
  const accepted = await store.getTermsAcceptance();
  if (accepted?.version !== TERMS_VERSION) return next(new HttpError(403, 'Accept the Terms of Use to continue.'));
  next();
});

const wrap =
  (fn: (req: Request) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req).then((data) => res.json(data), next);

function str(body: Record<string, unknown> | undefined, key: string, maxLen = 200, required = false): string | undefined {
  const value = body?.[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `'${key}' is required`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maxLen) throw new HttpError(400, `'${key}' must be a string up to ${maxLen} characters`);
  return value.trim();
}

function chatId(req: Request) {
  const id = String(req.params.id);
  if (!store.CHAT_ID_RE.test(id)) throw new HttpError(404, 'Chat not found');
  return id;
}

async function requireChat(id: string) {
  const file = await store.getChat(id);
  if (!file) throw new HttpError(404, 'Chat not found');
  return file;
}

function requireConnectorId(id: string | undefined) {
  if (id && !getConnector(id)) throw new HttpError(400, 'Unknown model');
  return id;
}

// ---- status, settings, terms ---------------------------------------------------

api.get(
  '/status',
  wrap(async () => {
    const tools = await toolVersions();
    const accepted = await store.getTermsAcceptance();
    return {
      connectors,
      defaultConnectorId: defaultConnector()?.id,
      transcription: {
        mode: transcription.mode,
        chain: transcriberChain(),
        whisperModel: transcription.whisperModel,
        localWhisperProblem: localWhisperProblem(),
      },
      tools: { ...tools, ytdlpInstalling: ytdlpState.installing, ytdlpError: ytdlpState.error, hints: INSTALL_HINTS },
      dataDir: store.dirs.chats.replace(/[/\\]chats$/, ''),
      termsAccepted: accepted?.version === TERMS_VERSION,
    };
  }),
);

api.get('/terms', (_req, res) => {
  res.json({ version: TERMS_VERSION, text: TERMS_TEXT });
});

api.post(
  '/terms/accept',
  wrap(async (req) => {
    if (req.body?.version !== TERMS_VERSION) throw new HttpError(409, 'The terms changed. Reload the page.');
    await store.acceptTerms(TERMS_VERSION);
    return { ok: true };
  }),
);

api.post(
  '/connectors/test',
  wrap(async (req) => {
    const connector = getConnector(str(req.body, 'connectorId', 300, true));
    if (!connector) throw new HttpError(404, 'Unknown model');
    return testConnector(connector);
  }),
);

// ---- setup: connect models from the browser; saved to data/settings.json -----------

const KEY_VARS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' } as const;
const LLM_LABELS = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' } as const;
type KeyProvider = keyof typeof KEY_VARS;

/** A setting from the request body; keys and model names can't contain spaces. */
function settingValue(body: Record<string, unknown> | undefined, key: string, required = true, re = /^\S+$/) {
  const value = str(body, key, 500, required);
  const label = { apiKey: 'API key', model: 'model name', name: 'name' }[key] ?? key;
  if (value !== undefined && !re.test(value)) throw new HttpError(400, `That ${label} doesn't look right. Check for extra spaces.`);
  return value;
}
const MODEL_RE = /^[\w.:/@+-]+(,[\w.:/@+-]+)*$/;

function keyProvider(value: unknown): KeyProvider {
  if (typeof value !== 'string' || !(value in KEY_VARS)) throw new HttpError(400, 'Unknown provider');
  return value as KeyProvider;
}

api.get('/setup', (_req, res) => {
  res.json(setupSummary());
});

api.get('/setup/ollama', wrap(ollamaStatus));

/** Checks the key with a tiny request, and saves it only if it works. */
api.post(
  '/setup/key',
  wrap(async (req) => {
    const provider = keyProvider(req.body?.provider);
    const apiKey = settingValue(req.body, 'apiKey')!;
    if (provider === 'groq') {
      const result = await testGroqKey(apiKey);
      if (result.ok) await saveSettings({ GROQ_API_KEY: apiKey });
      return result;
    }
    const model = env(`${KEY_VARS[provider].replace('_API_KEY', '')}_MODEL`)?.split(',')[0].trim() ?? DEFAULT_MODELS[provider];
    const result = await testConnector({ id: 'setup', provider, label: LLM_LABELS[provider], model, vision: true }, apiKey);
    if (result.ok) await saveSettings({ [KEY_VARS[provider]]: apiKey });
    return result;
  }),
);

/** Any OpenAI-compatible server (OpenRouter, LM Studio, …). Uses the single COMPAT_* slot, so it replaces Ollama if set. */
api.post(
  '/setup/custom',
  wrap(async (req) => {
    const baseUrl = str(req.body, 'baseUrl', 300, true)!;
    try {
      if (!/^https?:$/.test(new URL(baseUrl).protocol)) throw new Error();
    } catch {
      throw new HttpError(400, 'The server URL must start with http:// or https://');
    }
    const model = settingValue(req.body, 'model', true, MODEL_RE)!;
    const apiKey = settingValue(req.body, 'apiKey', false);
    const name = settingValue(req.body, 'name', false, /^.{1,40}$/);
    const vision = req.body?.vision !== false;
    const label = name ?? new URL(baseUrl).host;
    const result = await testConnector(
      { id: 'setup', provider: 'openai_compatible', label, model: model.split(',')[0], baseUrl: baseUrl.replace(/\/$/, ''), vision },
      apiKey ?? 'not-needed',
    );
    if (result.ok) {
      await saveSettings({ COMPAT_BASE_URL: baseUrl, COMPAT_API_KEY: apiKey ?? '', COMPAT_MODEL: model, COMPAT_NAME: name ?? '', COMPAT_VISION: String(vision) });
    }
    return result;
  }),
);

api.post(
  '/setup/ollama',
  wrap(async (req) => {
    const model = settingValue(req.body, 'model', true, /^[\w.:/-]{1,100}$/)!;
    const { running, models } = await ollamaStatus();
    if (!running) throw new HttpError(400, "Ollama isn't running. Open the Ollama app and try again.");
    const found = models.find((m) => m.name === model);
    if (!found) throw new HttpError(400, `${model} isn't downloaded in Ollama yet.`);
    await saveSettings({
      COMPAT_BASE_URL: `${OLLAMA_URL}/v1`,
      COMPAT_API_KEY: '',
      COMPAT_MODEL: model,
      COMPAT_NAME: 'Ollama',
      COMPAT_VISION: String(found.vision !== false),
    });
    return { ok: true, message: `Connected. HookLab will use ${model} on this computer.` };
  }),
);

api.post(
  '/setup/ollama/pull',
  wrap(async (req) => {
    const model = settingValue(req.body, 'model', true, /^[\w.:/-]{1,100}$/)!;
    if (!(await ollamaStatus()).running) throw new HttpError(400, "Ollama isn't running. Open the Ollama app and try again.");
    try {
      startOllamaPull(model);
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
    return { ok: true };
  }),
);

api.post(
  '/setup/default',
  wrap(async (req) => {
    const connector = getConnector(str(req.body, 'connectorId', 300, true));
    if (!connector) throw new HttpError(404, 'Unknown model');
    await saveSettings({ DEFAULT_MODEL: connector.id });
    return { ok: true };
  }),
);

/** Removes a provider's key (or the custom/Ollama model). */
api.delete(
  '/setup/:provider',
  wrap(async (req) => {
    const provider = String(req.params.provider);
    if (provider === 'custom') await saveSettings({ COMPAT_BASE_URL: '', COMPAT_API_KEY: '', COMPAT_MODEL: '', COMPAT_NAME: '' });
    else await saveSettings({ [KEY_VARS[keyProvider(provider)]]: '' });
    return { ok: true };
  }),
);

// ---- chats ----------------------------------------------------------------------

api.get('/chats', wrap(async () => ({ chats: await store.listChats() })));

api.post(
  '/chats',
  wrap(async (req) => {
    const ts = store.nowMs();
    const chat = {
      id: store.newId(),
      title: 'New chat',
      connectorId: requireConnectorId(str(req.body, 'connectorId', 300)),
      createdAt: ts,
      updatedAt: ts,
    };
    await store.createChat(chat);
    return { chat };
  }),
);

api.get(
  '/chats/:id',
  wrap(async (req) => {
    const { chat, messages } = await requireChat(chatId(req));
    const videos = await store.getVideos(messages.flatMap((m) => m.videoIds ?? []));
    return { chat, messages, videos: [...videos.values()].map(publicVideo) };
  }),
);

function publicVideo(v: Video) {
  const thumb = v.frames[0];
  return {
    id: v.id,
    sourceUrl: v.sourceUrl,
    platform: v.meta.platform,
    author: v.meta.uploader,
    caption: v.meta.description || v.meta.title,
    views: v.meta.viewCount,
    likes: v.meta.likeCount,
    comments: v.meta.commentCount,
    shares: v.meta.shareCount,
    durationSec: v.durationSec,
    transcript: v.transcript,
    transcriptSource: v.transcriptSource,
    thumbnailUrl: thumb ? `/api/frames/${v.id}/${thumb.file}` : undefined,
  };
}

api.patch(
  '/chats/:id',
  wrap(async (req) => {
    const id = chatId(req);
    await requireChat(id);
    const title = 'title' in (req.body ?? {}) ? str(req.body, 'title', 120, true) : undefined;
    const connectorId = 'connectorId' in (req.body ?? {}) ? requireConnectorId(str(req.body, 'connectorId', 300)) : undefined;
    const chat = await store.updateChat(id, ({ chat: c }) => {
      if (title) c.title = title;
      if (connectorId) c.connectorId = connectorId;
      return c;
    });
    return { chat };
  }),
);

/** Deleting a chat also deletes the videos shared in it (record, transcript and frames). */
api.delete(
  '/chats/:id',
  wrap(async (req) => {
    const id = chatId(req);
    const { messages } = await requireChat(id);
    for (const videoId of new Set(messages.flatMap((m) => m.videoIds ?? []))) await store.deleteVideo(videoId);
    await store.deleteChat(id);
    return { ok: true };
  }),
);

api.post(
  '/chats/:id/messages',
  wrap(async (req) => {
    const id = chatId(req);
    const content = str(req.body, 'content', MAX_MESSAGE_CHARS) ?? '';
    const uploadId = str(req.body, 'uploadId', 64);
    if (uploadId && !UPLOAD_ID_RE.test(uploadId)) throw new HttpError(400, 'Invalid uploadId');
    if (!content && !uploadId) throw new HttpError(400, 'Message is empty');
    if (videoSources({ content, uploadId }).length > MAX_VIDEOS_PER_MESSAGE) {
      throw new HttpError(400, `Up to ${MAX_VIDEOS_PER_MESSAGE} videos per message`);
    }

    const ts = store.nowMs();
    const userMsg: Message = { id: store.newMessageId(ts), role: 'user', content, uploadId, status: 'done', createdAt: ts };
    const assistantMsg: Message = { id: store.newMessageId(ts + 1), role: 'assistant', content: '', status: 'pending', progress: 'Queued…', createdAt: ts + 1 };
    const added = await store.updateChat(id, ({ chat, messages }) => {
      if (messages.some((m) => m.status === 'pending')) return 'busy' as const;
      messages.push(userMsg, assistantMsg);
      chat.updatedAt = ts;
      return 'ok' as const;
    });
    if (!added) throw new HttpError(404, 'Chat not found');
    if (added === 'busy') throw new HttpError(409, 'Still working on the previous message');

    void runTurn(id, assistantMsg.id);
    return { messages: [userMsg, assistantMsg] };
  }),
);

// ---- videos & uploads -------------------------------------------------------------

api.delete(
  '/videos/:id',
  wrap(async (req) => {
    const id = String(req.params.id);
    if (!store.VIDEO_ID_RE.test(id) || !(await store.deleteVideo(id))) throw new HttpError(404, 'Video not found');
    return { ok: true };
  }),
);

api.get('/frames/:videoId/:file', (req, res, next) => {
  const { videoId, file } = req.params;
  if (!store.VIDEO_ID_RE.test(videoId) || !/^\d+\.\d\.jpg$/.test(file)) return next(new HttpError(404, 'Not found'));
  res.sendFile(join(store.framesDir(videoId), file), { headers: { 'Cache-Control': 'private, max-age=86400' } }, (err) => {
    if (err && !res.headersSent) next(new HttpError(404, 'Not found'));
  });
});

/** The browser sends the raw file as the request body; it's streamed to data/uploads. */
api.post('/uploads', async (req, res, next) => {
  const ext = UPLOAD_TYPES[String(req.headers['content-type'] ?? '').split(';')[0]];
  if (!ext) return next(new HttpError(400, 'Upload an .mp4, .mov or .webm video'));
  if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) return next(new HttpError(413, 'Videos must be under 150 MB'));
  const uploadId = `${randomBytes(16).toString('hex')}.${ext}`;
  const path = join(store.dirs.uploads, uploadId);
  let bytes = 0;
  req.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) req.destroy(new HttpError(413, 'Videos must be under 150 MB'));
  });
  try {
    await pump(req, createWriteStream(path));
    res.json({ uploadId });
  } catch (err) {
    await rm(path, { force: true });
    next(err instanceof HttpError ? err : new HttpError(400, 'Upload failed'));
  }
});

api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be JSON' });
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});
app.use('/api', api);

// ---- start ------------------------------------------------------------------------

const server = createServer(app);

if (DEV) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: join(ROOT, 'client', 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('The app is not built. Run `npm start` (it builds first).');
    process.exit(1);
  }
  app.use(express.static(dist, { index: 'index.html' }));
}

await store.failInterruptedTurns();

const URL_ = `http://localhost:${PORT}`;

/** Opens HookLab in the default browser, unless OPEN_BROWSER=false. */
function openBrowser() {
  if (DEV || env('OPEN_BROWSER') === 'false') return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [URL_]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL_]] : ['xdg-open', [URL_]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

server.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Most likely HookLab is already running (e.g. the launcher was double-clicked twice): just show it.
  const running = await fetch(`http://127.0.0.1:${PORT}/api/status`)
    .then((r) => r.json())
    .then((s) => 'termsAccepted' in s)
    .catch(() => false);
  if (running) {
    console.log(`\n  HookLab is already running at ${URL_}. Opening it in your browser.\n`);
    openBrowser();
    process.exit(0);
  }
  console.error(`\n  Port ${PORT} is used by another app. Start HookLab with a different port, e.g. PORT=8788 npm start, or set PORT in .env.\n`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  // Finding yt-dlp takes a moment; a first-time download continues in the background.
  await Promise.race([ensureYtdlp(), new Promise((r) => setTimeout(r, 5000))]);
  const tools = await toolVersions();
  const lines = [
    '',
    `  🪝 HookLab is running at ${URL_}`,
    '',
    `  Models:        ${connectors.length ? connectors.map((c) => `${c.label} · ${c.model}`).join(', ') : 'none yet. Pick one in your browser.'}`,
    `  Transcription: ${transcriberChain().join(' → ') || 'off'}`,
    ...(localWhisperProblem() ? [`                 ⚠️  ${localWhisperProblem()}`] : []),
    `  yt-dlp:        ${tools.ytdlp ?? (ytdlpState.installing ? 'downloading…' : `missing. ${ytdlpState.error ?? INSTALL_HINTS.ytdlp}`)}`,
    `  ffmpeg:        ${tools.ffmpeg ?? `missing. ${INSTALL_HINTS.ffmpeg}`}`,
    '',
    '  Keep this window open while you use HookLab. Close it (or press Ctrl+C) to quit.',
    '',
  ];
  console.log(lines.join('\n'));
  openBrowser();
});
