/**
 * Backs the in-app setup screen: saves settings to data/settings.json (gitignored, like the rest of
 * data/) and applies them immediately, and talks to a local Ollama install. Keys are written only to
 * that file on this computer and are never sent back to the browser.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SETTINGS_FILE, env, loadConnectors, savedSettings } from './config';

/**
 * Merges the given values (same names as .env) into data/settings.json, then reloads the model list.
 * An empty string is saved too, so removing a key in the app also hides one set in .env.
 */
export async function saveSettings(updates: Record<string, string>) {
  Object.assign(savedSettings, updates);
  const sorted = Object.fromEntries(Object.entries(savedSettings).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  // Owner-only permissions, and write-then-rename so a crash never leaves half-written JSON.
  const tmp = `${SETTINGS_FILE}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, SETTINGS_FILE);
  await chmod(SETTINGS_FILE, 0o600).catch(() => {}); // no-op on Windows
  loadConnectors();
}

/** What the setup screen may know: which keys exist, never their values. */
export function setupSummary() {
  const baseUrl = env('COMPAT_BASE_URL');
  return {
    keys: {
      anthropic: !!env('ANTHROPIC_API_KEY'),
      openai: !!env('OPENAI_API_KEY'),
      gemini: !!env('GEMINI_API_KEY'),
      groq: !!env('GROQ_API_KEY'),
    },
    custom: baseUrl ? { baseUrl, model: env('COMPAT_MODEL') ?? '', name: env('COMPAT_NAME') ?? '', hasKey: !!env('COMPAT_API_KEY') } : undefined,
  };
}

/** Checks a Groq key (used only for transcription) by listing its models. */
export async function testGroqKey(apiKey: string) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, message: 'Connected. Groq will transcribe your videos.' };
    return { ok: false, message: res.status === 401 ? 'Groq rejected that key.' : `Groq returned HTTP ${res.status}.` };
  } catch {
    return { ok: false, message: "Couldn't reach Groq. Check your internet connection." };
  }
}

// ---- Ollama ---------------------------------------------------------------------

export const OLLAMA_URL = (env('OLLAMA_URL') ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
/** Offered as a one-click download: small enough for most laptops, and it can see video frames. */
export const RECOMMENDED_OLLAMA_MODEL = { name: 'gemma3:4b', size: '3.3 GB' };

export interface OllamaModel {
  name: string;
  sizeGb: number;
  vision?: boolean;
}

let pull: { model: string; status: string; percent?: number; error?: string; done?: boolean } | undefined;

async function ollama<T>(path: string, body?: unknown, timeoutMs = 3000): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Whether Ollama is running, which models it has (and whether each can read images), and any download in progress. */
export async function ollamaStatus() {
  let models: OllamaModel[] = [];
  let running = false;
  try {
    const tags = await ollama<{ models?: { name: string; size: number }[] }>('/api/tags');
    running = true;
    models = await Promise.all(
      (tags.models ?? []).map(async (m) => {
        const show = await ollama<{ capabilities?: string[] }>('/api/show', { model: m.name }).catch(() => ({}) as { capabilities?: string[] });
        return { name: m.name, sizeGb: Math.round(m.size / 1e8) / 10, vision: show.capabilities?.includes('vision') };
      }),
    );
  } catch {
    // not installed or not running
  }
  return { running, url: OLLAMA_URL, models, pull, recommended: RECOMMENDED_OLLAMA_MODEL };
}

/** Starts downloading a model in the background; progress is reported by ollamaStatus(). */
export function startOllamaPull(model: string) {
  if (pull && !pull.done && !pull.error) throw new Error(`Already downloading ${pull.model}`);
  const state: NonNullable<typeof pull> = { model, status: 'Starting download…' };
  pull = state;
  void (async () => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
      if (!res.ok || !res.body) throw new Error(`Ollama returned HTTP ${res.status}`);
      const decoder = new TextDecoder();
      let buffered = '';
      for await (const chunk of res.body) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (event.error) throw new Error(event.error);
          if (event.total && event.completed !== undefined) {
            state.percent = Math.floor((event.completed / event.total) * 100);
            state.status = 'Downloading…';
          } else if (event.status) {
            state.percent = undefined;
            state.status = event.status === 'success' ? 'Done' : `${event.status[0].toUpperCase()}${event.status.slice(1)}…`;
          }
        }
      }
      state.done = true;
    } catch (err) {
      state.error = `Download failed: ${(err as Error).message}`;
    }
  })();
}
