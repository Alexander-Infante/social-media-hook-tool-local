/**
 * Speech-to-text. The hook analysis lives or dies on knowing exactly what is said in the first
 * 3 seconds, so every transcriber returns "[m:ss.s] text" phrases with real timestamps.
 *
 * Transcribers are tried in the order from transcriberChain() (see config.ts) until one finds speech:
 *   openai   - OpenAI Whisper (whisper-1), word-level timestamps, ~$0.006/min on your OpenAI key
 *   groq     - Groq Whisper large-v3-turbo, word-level timestamps, very cheap / free tier
 *   local    - Whisper running on this computer via transformers.js; free and private, slower
 *   captions - the platform's own captions downloaded by yt-dlp (often missing)
 */
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { dirs } from './store';
import { transcriberChain, transcription, type TranscriberName } from './config';
import { decodePcm, extractAudio, type Container } from './ingest';
import { fmtTime } from './prompts';

export interface TranscriptResult {
  transcript?: string;
  transcriptSource: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

const LABELS: Record<TranscriberName, string> = {
  openai: 'OpenAI Whisper',
  groq: 'Groq Whisper',
  local: 'local Whisper',
  captions: 'platform captions',
};

export async function transcribe(
  file: string,
  container: Container,
  dir: string,
  captions: string | undefined,
  progress: (text: string) => Promise<unknown>,
): Promise<TranscriptResult> {
  const chain = transcriberChain();
  if (!chain.length) return { transcriptSource: 'transcription turned off' };
  const failures: string[] = [];
  let audioPath: string | undefined;

  for (const name of chain) {
    try {
      let transcript: string | undefined;
      if (name === 'captions') {
        transcript = captions;
      } else if (name === 'local') {
        await progress('Transcribing on this computer (first run downloads the Whisper model)');
        const pcm = await decodePcm(file, container);
        if (!pcm) throw new Error('could not decode audio');
        transcript = await transcribeLocal(pcm);
      } else {
        audioPath ??= await extractAudio(file, container, dir);
        if (!audioPath) throw new Error('could not extract audio');
        await progress(`Transcribing with ${LABELS[name]}`);
        transcript = await transcribeApi(name, audioPath);
      }
      if (transcript?.trim()) {
        const note = failures.length ? ` (after ${failures.join('; ')})` : '';
        return { transcript, transcriptSource: `${LABELS[name]}${note}` };
      }
      failures.push(`${LABELS[name]}: no speech found`);
    } catch (err) {
      console.error(`[transcribe] ${name} failed:`, err instanceof Error ? err.message : err);
      failures.push(`${LABELS[name]} failed`);
    }
  }
  return { transcriptSource: failures.join('; ') || 'no speech found' };
}

// ---- Whisper APIs (OpenAI and Groq speak the same protocol) -----------------

async function transcribeApi(name: 'openai' | 'groq', audioPath: string): Promise<string | undefined> {
  const client =
    name === 'openai'
      ? new OpenAI({ apiKey: transcription.openaiKey!, timeout: 5 * 60_000, maxRetries: 2 })
      : new OpenAI({ apiKey: transcription.groqKey!, baseURL: 'https://api.groq.com/openai/v1', timeout: 5 * 60_000, maxRetries: 2 });
  const res = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: name === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    ...(transcription.whisperLanguage ? { language: transcription.whisperLanguage } : {}),
  });

  // Whisper invents phrases ("Thanks for watching!") over music or silence; drop segments it thinks aren't speech.
  const segments = (res.segments ?? []).filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -1));
  const words = res.words ?? [];
  if (!words.length) return segments.map((s) => `[${fmtTime(s.start)}] ${s.text.trim()}`).join('\n') || undefined;
  if (!res.segments) return toPhrases(words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))) || undefined;

  // The word list has no punctuation, the segments do. Where the counts line up, borrow the punctuated tokens.
  const out: Word[] = [];
  for (const seg of segments) {
    const segWords = words.filter((w) => w.start >= seg.start - 0.05 && w.start < seg.end);
    const tokens = seg.text.trim().split(/\s+/);
    const punctuated = tokens.length === segWords.length;
    segWords.forEach((w, i) => out.push({ text: punctuated ? tokens[i] : w.word.trim(), start: w.start, end: w.end }));
  }
  return toPhrases(out) || undefined;
}

// ---- local Whisper ----------------------------------------------------------

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
let asr: Promise<Asr> | undefined;
let queue: Promise<unknown> = Promise.resolve();

async function loadAsr(): Promise<Asr> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = dirs.models;
  return (await pipeline('automatic-speech-recognition', transcription.whisperModel)) as unknown as Asr;
}

/** Runs one transcription at a time; Whisper already uses every CPU core. */
function transcribeLocal(pcm: Float32Array): Promise<string | undefined> {
  const job = queue.then(async () => {
    asr ??= loadAsr().catch((err) => {
      asr = undefined;
      throw err;
    });
    const model = await asr;
    const base = {
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(transcription.whisperLanguage ? { language: transcription.whisperLanguage, task: 'transcribe' } : {}),
    };
    try {
      const out = await model(pcm, { ...base, return_timestamps: 'word' });
      const words = (out.chunks ?? []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] }));
      return toPhrases(words.filter((w) => w.text)) || undefined;
    } catch {
      // Some Whisper exports lack the alignment data needed for word timings; fall back to phrase timings.
      const out = await model(pcm, { ...base, return_timestamps: true });
      return (out.chunks ?? []).map((c) => `[${fmtTime(c.timestamp[0])}] ${c.text.trim()}`).join('\n') || undefined;
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

// ---- formatting -------------------------------------------------------------

/** Words -> short phrases, split at sentence ends, pauses over 0.7s, or 14 words. */
export function toPhrases(words: Word[]): string {
  const phrases: { start: number; words: string[]; end: number }[] = [];
  let current: { start: number; words: string[]; end: number } | undefined;
  for (const w of words) {
    if (current && (w.start - current.end > 0.7 || current.words.length >= 14)) current = undefined;
    if (!current) {
      current = { start: w.start, words: [], end: w.end };
      phrases.push(current);
    }
    current.words.push(w.text);
    current.end = w.end;
    if (/[.?!]["')\]]?$/.test(w.text)) current = undefined;
  }
  return phrases.map((p) => `[${fmtTime(p.start)}] ${p.words.join(' ')}`).join('\n');
}
