/**
 * Settings come from two places, both on this computer and both gitignored:
 *   data/settings.json  written by the in-app setup screen (see settings.ts); wins when both set a value
 *   .env                optional, for editing by hand (see .env.example for every option)
 * API keys are read here and handed straight to the provider SDKs; they are never logged or sent to the browser.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import type { Connector, Provider } from './types';

export const ROOT = resolve(import.meta.dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
export const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

dotenv.config({ path: join(ROOT, '.env'), quiet: true });

/** Values saved from the app, keyed by the same names as .env (e.g. ANTHROPIC_API_KEY). Kept in sync with data/settings.json. */
export const savedSettings: Record<string, string> = readSettingsFile();

function readSettingsFile(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`  ⚠️  Couldn't read ${SETTINGS_FILE}, ignoring it: ${(err as Error).message}`);
    return {};
  }
}

export const env = (name: string) => (savedSettings[name] ?? process.env[name])?.trim() || undefined;
const list = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const PORT = Number(env('PORT') ?? 8787);

// ---- LLMs -------------------------------------------------------------------

const keys = new Map<string, string>();
export const connectors: Connector[] = [];

function addProvider(provider: Provider, apiKey: string | undefined, models: string[], extra: Partial<Connector> = {}) {
  if (!apiKey) return;
  const names: Record<Provider, string> = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    openai_compatible: 'Custom',
  };
  for (const model of models) {
    const id = `${provider}:${model}`;
    if (keys.has(id)) continue;
    connectors.push({ id, provider, label: extra.label ?? names[provider], model, vision: true, ...extra });
    keys.set(id, apiKey);
  }
}

export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  gemini: 'gemini-flash-latest',
};

/** (Re)builds the model list from the settings. Called at startup and after the setup screen saves a change. */
export function loadConnectors() {
  connectors.length = 0;
  keys.clear();
  addProvider('anthropic', env('ANTHROPIC_API_KEY'), list(env('ANTHROPIC_MODEL'), DEFAULT_MODELS.anthropic));
  addProvider('openai', env('OPENAI_API_KEY'), list(env('OPENAI_MODEL'), DEFAULT_MODELS.openai));
  addProvider('gemini', env('GEMINI_API_KEY'), list(env('GEMINI_MODEL'), DEFAULT_MODELS.gemini));

  const compatUrl = env('COMPAT_BASE_URL');
  if (compatUrl) {
    // Local servers like Ollama or LM Studio don't need a key, but the OpenAI SDK requires a non-empty one.
    addProvider('openai_compatible', env('COMPAT_API_KEY') ?? 'not-needed', list(env('COMPAT_MODEL'), ''), {
      baseUrl: compatUrl.replace(/\/$/, ''),
      label: env('COMPAT_NAME') ?? new URL(compatUrl).host,
      vision: env('COMPAT_VISION') !== 'false',
    });
  }

  transcription.openaiKey = env('OPENAI_API_KEY');
  transcription.groqKey = env('GROQ_API_KEY');
}

/** The connector used for new chats: DEFAULT_MODEL if it names a configured model, else the first one. */
export const defaultConnector = (): Connector | undefined => {
  const wanted = env('DEFAULT_MODEL');
  return connectors.find((c) => c.model === wanted || c.id === wanted) ?? connectors[0];
};

export const getConnector = (id: string | undefined) => connectors.find((c) => c.id === id);
export const apiKeyFor = (c: Connector) => keys.get(c.id)!;

// ---- Transcription ----------------------------------------------------------

export type TranscriberName = 'openai' | 'groq' | 'local' | 'captions';

export const transcription = {
  mode: (env('TRANSCRIPTION') ?? 'auto').toLowerCase(),
  openaiKey: env('OPENAI_API_KEY'),
  groqKey: env('GROQ_API_KEY'),
  whisperModel: env('WHISPER_MODEL') ?? 'Xenova/whisper-base',
  whisperLanguage: env('WHISPER_LANGUAGE'),
};

loadConnectors();

const require = createRequire(import.meta.url);

/** Why local Whisper can't run here, or undefined if it can. Its speech engine (onnxruntime) has no Intel Mac build. */
export function localWhisperProblem(): string | undefined {
  try {
    require.resolve('@huggingface/transformers');
  } catch {
    return 'Local Whisper is not installed. Run `npm install` again.';
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return cpus()[0]?.model.includes('Apple')
      ? 'You are running the Intel build of Node.js on an Apple Silicon Mac. Install the Apple Silicon version from https://nodejs.org, then run `rm -rf node_modules && npm install` to enable free local transcription.'
      : 'Local Whisper is not available on Intel Macs. Set OPENAI_API_KEY or GROQ_API_KEY in .env for transcription.';
  }
  return undefined;
}

/**
 * The transcribers to try, in order, until one returns speech.
 * auto: OpenAI Whisper (if OPENAI_API_KEY) -> Groq Whisper (if GROQ_API_KEY) -> local Whisper -> platform captions.
 */
export function transcriberChain(): TranscriberName[] {
  const { mode, openaiKey, groqKey } = transcription;
  if (mode === 'off') return [];
  if (mode === 'captions') return ['captions'];
  if (mode === 'openai' || mode === 'groq' || mode === 'local') return [mode, 'captions'];
  const chain: TranscriberName[] = [];
  if (openaiKey) chain.push('openai');
  if (groqKey) chain.push('groq');
  if (!localWhisperProblem()) chain.push('local');
  chain.push('captions');
  return chain;
}

// ---- Tools ------------------------------------------------------------------

function bundledFfmpeg(): string | undefined {
  try {
    return require('ffmpeg-static') ?? undefined;
  } catch {
    return undefined;
  }
}

export const FFMPEG = env('FFMPEG_PATH') ?? bundledFfmpeg() ?? 'ffmpeg';
/** yt-dlp from YTDLP_PATH, else PATH, else a copy HookLab downloads into ./bin (see tools.ts). */
export const YTDLP_OVERRIDE = env('YTDLP_PATH');
export const BIN_DIR = join(ROOT, 'bin');
