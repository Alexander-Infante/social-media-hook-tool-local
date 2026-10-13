/**
 * One chat turn: ingest any linked/uploaded videos, then ask the chosen LLM and save its reply.
 * Runs in the background inside the server process; the browser polls the chat for progress.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiKeyFor, defaultConnector, getConnector } from './config';
import { detectContainer, downloadFromUrl, extractFrames, frameTimes, probe, sceneCuts } from './ingest';
import { DEFAULT_VIDEO_ASK, SYSTEM_PROMPT, dossier } from './prompts';
import { UserFacingError, chat, type Part, type Turn } from './providers';
import { videoSources, type VideoSource } from './sources';
import * as store from './store';
import { transcribe } from './transcribe';
import type { Connector, Message, Video, VideoMeta } from './types';

/** Sends a tiny request to check the model works. Pass apiKey to check a key before it's saved. */
export async function testConnector(c: Connector, apiKey = apiKeyFor(c)) {
  try {
    const reply = await chat(
      c,
      apiKey,
      'You are a connectivity check.',
      [{ role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: ok' }] }],
      { timeoutMs: 30_000, maxTokens: 2048 },
    );
    return { ok: true, message: `Connected. ${c.model} replied “${reply.trim().slice(0, 40)}”.` };
  } catch (err) {
    return { ok: false, message: err instanceof UserFacingError ? err.message : 'Unexpected error while testing' };
  }
}

export async function runTurn(chatId: string, messageId: string) {
  const progress = (text: string) => store.updateMessage(chatId, messageId, { progress: text });
  try {
    const file = await store.getChat(chatId);
    if (!file) return;
    const { chat: chatItem, messages } = file;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 1 || messages[idx].status !== 'pending' || messages[idx - 1].role !== 'user') return;
    const userMsg = messages[idx - 1];

    const connector = getConnector(chatItem.connectorId) ?? defaultConnector();
    if (!connector) throw new UserFacingError('No AI model is connected yet. Add one on the **Settings** page.');

    // 1. Ingest videos referenced by the new message.
    const sources = videoSources(userMsg);
    const newVideoIds: string[] = [];
    for (const [i, source] of sources.entries()) {
      const label = sources.length > 1 ? ` (${i + 1} of ${sources.length})` : '';
      const video = await ensureVideo(source, (text) => progress(`${text}${label}`));
      newVideoIds.push(video.id);
    }
    if (newVideoIds.length) {
      await store.updateMessage(chatId, userMsg.id, { videoIds: newVideoIds });
      userMsg.videoIds = newVideoIds;
    }

    // 2. Build the conversation. Dossiers ride along every turn; frames only on the turn they're shared.
    const history = messages.slice(0, idx).filter((m) => m.status === 'done');
    const videos = await store.getVideos(history.flatMap((m) => m.videoIds ?? []));
    const turns: Turn[] = [];
    for (const m of history) {
      const parts: Part[] = [];
      for (const id of m.videoIds ?? []) {
        const video = videos.get(id);
        if (!video) continue;
        parts.push({ type: 'text', text: dossier(video) });
        if (m.id === userMsg.id && connector.vision) parts.push(...(await frameParts(video)));
      }
      const text = m.content.trim() || (m.videoIds?.length ? DEFAULT_VIDEO_ASK : '');
      if (text) parts.push({ type: 'text', text });
      if (parts.length) turns.push({ role: m.role, parts });
    }

    // 3. Ask the LLM.
    await progress(`Analyzing with ${connector.label} · ${connector.model}`);
    const reply = await chat(connector, apiKeyFor(connector), SYSTEM_PROMPT, turns);

    await store.updateChat(chatId, ({ chat: c, messages: msgs }) => {
      const msg = msgs.find((m) => m.id === messageId);
      if (msg) Object.assign(msg, { status: 'done', content: reply, progress: undefined, connectorLabel: `${connector.label} · ${connector.model}` });
      c.updatedAt = store.nowMs();
      if (c.title === 'New chat') c.title = titleFor(userMsg, videos);
    });
  } catch (err) {
    console.error('turn failed', err);
    const content =
      err instanceof UserFacingError ? err.message : 'Something went wrong while processing this message. Check the terminal running HookLab for details.';
    await store.updateMessage(chatId, messageId, { status: 'error', content, progress: undefined }).catch(console.error);
  }
}

function titleFor(msg: Message, videos: Map<string, Video>): string {
  const video = msg.videoIds?.map((id) => videos.get(id)).find(Boolean);
  const text = video
    ? [video.meta.uploader && `@${video.meta.uploader.replace(/^@/, '')}`, video.meta.description || video.meta.title]
        .filter(Boolean)
        .join(' · ')
    : msg.content;
  const clean = (text || 'Video breakdown').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return (clean || 'Video breakdown').slice(0, 70);
}

async function frameParts(video: Video): Promise<Part[]> {
  const parts = await Promise.all(
    video.frames.map(async (f): Promise<Part | undefined> => {
      try {
        const data = await readFile(join(store.framesDir(video.id), f.file));
        return { type: 'image', data, label: `Frame at ${f.t.toFixed(1)}s:` };
      } catch {
        return undefined;
      }
    }),
  );
  return parts.filter((p): p is Part => Boolean(p));
}

/** Returns the processed video, reusing a previous result for the same URL or upload. */
async function ensureVideo(source: VideoSource, progress: (text: string) => Promise<unknown>): Promise<Video> {
  const sourceKey = source.type === 'url' ? source.url : `upload:${source.uploadId}`;
  const id = createHash('sha256').update(`${sourceKey}|v1`).digest('hex').slice(0, 24);
  const existing = await store.getVideo(id);
  if (existing) return existing;

  const dir = await mkdtemp(join(tmpdir(), 'hooklab-'));
  const uploadPath = source.type === 'upload' ? join(store.dirs.uploads, source.uploadId) : undefined;
  try {
    let file: string;
    let meta: VideoMeta;
    let subtitles: string | undefined;
    if (source.type === 'url') {
      await progress('Downloading video');
      ({ file, meta, subtitles } = await downloadFromUrl(source.url, dir));
    } else {
      await progress('Loading uploaded video');
      file = uploadPath!;
      await access(file).catch(() => {
        throw new UserFacingError('The uploaded video is missing. Attach it again.');
      });
      meta = { platform: 'Uploaded file' };
    }

    const container = await detectContainer(file);
    await progress('Extracting frames');
    const { durationSec, hasAudio } = await probe(file, container);
    if (durationSec > 10 * 60) throw new UserFacingError('Videos longer than 10 minutes are not supported.');

    const outDir = store.framesDir(id);
    await mkdir(outDir, { recursive: true });
    const [frames, cuts] = await Promise.all([extractFrames(file, container, frameTimes(durationSec), outDir), sceneCuts(file, container)]);
    const speech = hasAudio
      ? await transcribe(file, container, dir, subtitles, progress)
      : { transcript: undefined, transcriptSource: 'no audio track' };

    const video: Video = {
      id,
      status: 'ready',
      sourceUrl: source.type === 'url' ? source.url : undefined,
      uploadId: source.type === 'upload' ? source.uploadId : undefined,
      meta,
      durationSec: Math.round(durationSec * 10) / 10,
      hasAudio,
      transcript: speech.transcript,
      transcriptSource: speech.transcriptSource,
      frames,
      cuts,
      createdAt: store.nowMs(),
    };
    await store.putVideo(video);
    return video;
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (uploadPath) await rm(uploadPath, { force: true });
  }
}
