/**
 * Plain JSON files under ./data, so everything stays on this computer and is easy to inspect or delete.
 *
 *   data/chats/<chatId>.json     chat metadata + messages
 *   data/videos/<videoId>.json   ingested video (metadata, transcript, frame list)
 *   data/frames/<videoId>/*.jpg  still frames
 *   data/uploads/<uploadId>      uploaded files waiting to be processed
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config';
import type { Chat, Message, Video } from './types';

export const dirs = {
  chats: join(DATA_DIR, 'chats'),
  videos: join(DATA_DIR, 'videos'),
  frames: join(DATA_DIR, 'frames'),
  uploads: join(DATA_DIR, 'uploads'),
  models: join(DATA_DIR, 'models'),
};
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

export const CHAT_ID_RE = /^[a-f0-9]{16}$/;
export const VIDEO_ID_RE = /^[a-f0-9]{24}$/;

export const nowMs = () => Date.now();
export const newId = () => randomBytes(8).toString('hex');
export const newMessageId = (ts = nowMs()) => `${String(ts).padStart(13, '0')}-${randomBytes(3).toString('hex')}`;

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Write to a temp file and rename, so a crash never leaves half-written JSON. */
async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

// Read-modify-write of a chat file is serialized per chat, so the API and a running turn never clobber each other.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const settled = run.catch(() => undefined);
  locks.set(key, settled);
  settled.then(() => locks.get(key) === settled && locks.delete(key));
  return run;
}

// ---- chats & messages -------------------------------------------------------

interface ChatFile {
  chat: Chat;
  messages: Message[];
}

const chatPath = (id: string) => join(dirs.chats, `${id}.json`);
const readChat = (id: string) => readJson<ChatFile>(chatPath(id));

export async function listChats(): Promise<Chat[]> {
  const files = (await readdir(dirs.chats)).filter((f) => f.endsWith('.json'));
  const chats = await Promise.all(files.map(async (f) => (await readChat(f.slice(0, -5)))?.chat));
  return chats.filter((c): c is Chat => Boolean(c)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getChat = async (id: string) => readChat(id);

export const createChat = (chat: Chat) => withLock(chat.id, () => writeJson(chatPath(chat.id), { chat, messages: [] }));

/** Applies `fn` to the chat file and saves it. Returns undefined if the chat no longer exists. */
export function updateChat<T>(id: string, fn: (file: ChatFile) => T): Promise<T | undefined> {
  return withLock(id, async () => {
    const file = await readChat(id);
    if (!file) return undefined;
    const result = fn(file);
    await writeJson(chatPath(id), file);
    return result;
  });
}

export const updateMessage = (chatId: string, messageId: string, fields: Partial<Message>) =>
  updateChat(chatId, ({ messages }) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete (msg as unknown as Record<string, unknown>)[k];
      else (msg as unknown as Record<string, unknown>)[k] = v;
    }
  });

export const deleteChat = (id: string) => withLock(id, () => rm(chatPath(id), { force: true }));

/** Replies left "pending" when the server stopped can never finish; mark them failed on startup. */
export async function failInterruptedTurns() {
  for (const chat of await listChats()) {
    await updateChat(chat.id, ({ messages }) => {
      for (const m of messages) {
        if (m.status !== 'pending') continue;
        m.status = 'error';
        m.content = 'HookLab was stopped while this reply was running. Send your message again.';
        delete m.progress;
      }
    });
  }
}

// ---- videos -----------------------------------------------------------------

const videoPath = (id: string) => join(dirs.videos, `${id}.json`);
export const framesDir = (videoId: string) => join(dirs.frames, videoId);

export const getVideo = (id: string) => readJson<Video>(videoPath(id));
export const putVideo = (video: Video) => writeJson(videoPath(video.id), video);

export async function getVideos(ids: string[]): Promise<Map<string, Video>> {
  const found = new Map<string, Video>();
  for (const id of new Set(ids)) {
    const video = await getVideo(id);
    if (video) found.set(id, video);
  }
  return found;
}

export async function deleteVideo(id: string) {
  const existed = Boolean(await getVideo(id));
  await rm(videoPath(id), { force: true });
  await rm(framesDir(id), { recursive: true, force: true });
  return existed;
}

// ---- terms ------------------------------------------------------------------

const termsPath = join(DATA_DIR, 'terms-accepted.json');
export const getTermsAcceptance = () => readJson<{ version: string; acceptedAt: string }>(termsPath);
export const acceptTerms = (version: string) => writeJson(termsPath, { version, acceptedAt: new Date().toISOString() });
