/**
 * Adapters for the LLM providers. Every call goes straight from this computer to the provider,
 * using the API key you saved in HookLab (or in .env).
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { Connector } from './types';

export type Part = { type: 'text'; text: string } | { type: 'image'; data: Buffer; label: string };
export type Turn = { role: 'user' | 'assistant'; parts: Part[] };

/** An error whose message is safe and useful to show the user. */
export class UserFacingError extends Error {}

const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

// Claude models that accept the server-side refusal fallback ("default" routing).
const ANTHROPIC_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Merge consecutive same-role turns (some providers require strict alternation). */
function normalize(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const last = out.at(-1);
    if (last && last.role === t.role) last.parts.push(...t.parts);
    else out.push({ role: t.role, parts: [...t.parts] });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

function stripImages(turns: Turn[]): Turn[] {
  return turns.map((t) => ({ ...t, parts: t.parts.filter((p) => p.type === 'text') }));
}

export async function chat(
  c: Connector,
  apiKey: string,
  system: string,
  turns: Turn[],
  opts: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<string> {
  const convo = normalize(c.vision ? turns : stripImages(turns));
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const text =
      c.provider === 'anthropic'
        ? await chatAnthropic(c, apiKey, system, convo, timeout, opts.maxTokens ?? 16000)
        : c.provider === 'gemini'
          ? await chatGemini(c, apiKey, system, convo, timeout)
          : await chatOpenAI(c, apiKey, system, convo, timeout);
    if (!text.trim()) throw new UserFacingError(`${c.label} returned an empty response.`);
    return text;
  } catch (err) {
    throw toUserFacing(c, err);
  }
}

async function chatAnthropic(c: Connector, apiKey: string, system: string, turns: Turn[], timeout: number, maxTokens: number) {
  const client = new Anthropic({ apiKey, timeout, maxRetries: 2 });
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.parts.flatMap((p): Anthropic.ContentBlockParam[] =>
      p.type === 'text'
        ? [{ type: 'text', text: p.text }]
        : [
            { type: 'text', text: p.label },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.data.toString('base64') } },
          ],
    ),
  }));
  const params = { model: c.model, max_tokens: maxTokens, system, messages };

  const message = ANTHROPIC_FALLBACK_MODELS.has(c.model)
    ? await client.beta.messages
        .stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        .finalMessage()
    : await client.messages.stream(params).finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new UserFacingError(`${c.label} declined to answer this request.`);
  }
  const text = (message.content as { type: string; text?: string }[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (message.stop_reason === 'max_tokens') return `${text}\n\n_(Response was cut off at the length limit.)_`;
  return text;
}

async function chatOpenAI(c: Connector, apiKey: string, system: string, turns: Turn[], timeout: number) {
  const client = new OpenAI({ apiKey, baseURL: c.baseUrl, timeout, maxRetries: 2 });
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...turns.map((t): OpenAI.ChatCompletionMessageParam => {
      if (t.role === 'assistant') {
        return { role: 'assistant', content: t.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n') };
      }
      return {
        role: 'user',
        content: t.parts.flatMap((p): OpenAI.ChatCompletionContentPart[] =>
          p.type === 'text'
            ? [{ type: 'text', text: p.text }]
            : [
                { type: 'text', text: p.label },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.data.toString('base64')}` } },
              ],
        ),
      };
    }),
  ];
  const res = await client.chat.completions.create({ model: c.model, messages });
  const choice = res.choices[0];
  if (choice?.message?.refusal) throw new UserFacingError(`${c.label} declined: ${choice.message.refusal}`);
  return choice?.message?.content ?? '';
}

async function chatGemini(c: Connector, apiKey: string, system: string, turns: Turn[], timeout: number) {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout } });
  const res = await ai.models.generateContent({
    model: c.model,
    contents: turns.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: t.parts.flatMap((p) =>
        p.type === 'text'
          ? [{ text: p.text }]
          : [{ text: p.label }, { inlineData: { mimeType: 'image/jpeg', data: p.data.toString('base64') } }],
      ),
    })),
    config: { systemInstruction: system },
  });
  if (res.promptFeedback?.blockReason) {
    throw new UserFacingError(`${c.label} blocked the request (${res.promptFeedback.blockReason}).`);
  }
  return res.text ?? '';
}

function toUserFacing(c: Connector, err: unknown): Error {
  if (err instanceof UserFacingError) return err;
  const e = err as { status?: number; message?: string; name?: string };
  const status = e.status;
  const who = `${c.label} (${c.model})`;
  console.error(`provider error from ${c.provider}`, status, e.message);
  if (status === 401 || status === 403) return new UserFacingError(`${who} rejected the API key. Double-check it, or paste a new one in Settings.`);
  if (status === 404) return new UserFacingError(`${who}: model not found. Check the model name in your .env file.`);
  if (status === 429) return new UserFacingError(`${who} is rate limited or out of credits on your account.`);
  if (status === 413) return new UserFacingError(`${who}: the request was too large for this model.`);
  if (status && status >= 500) return new UserFacingError(`${who} is having problems right now (HTTP ${status}). Try again shortly.`);
  if (e.name?.includes('Timeout') || /timed? ?out/i.test(e.message ?? '')) {
    return new UserFacingError(`${who} took too long to respond. Try again or pick a faster model.`);
  }
  const detail = (e.message ?? String(err)).slice(0, 300);
  return new UserFacingError(`${who} returned an error: ${detail}`);
}
