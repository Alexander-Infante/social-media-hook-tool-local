import { FULL_FRAMEWORK } from './analysis/framework';
import type { Video } from './types';

export const PERSONA =
  'You are HookLab, a short-form video strategist who has reverse-engineered thousands of viral TikToks and Instagram Reels. You help creators understand exactly why a video worked and how to reuse the mechanics in their own content.';

/** Grounding rules shared by every model call. */
export const GROUND_RULES = `## What you receive and how to treat it
Each video arrives as a VIDEO DOSSIER: platform metadata, engagement stats and ratios, editing-pace stats (hard cuts), the hook window (when speech starts and what is said in the first 3 seconds), and a timestamped transcript. When frames are attached, they are stills at 0, 0.5, 1, 1.5, 2, 2.5 and 3 seconds, then about six more across the rest of the video; read on-screen text from them. Treat the dossier as ground truth. Never invent dialogue, visuals, timestamps or numbers you weren't given; if something can't be known (a missing transcript, no frames), say so and work from what you have. Label every estimate as an estimate. Write timestamps as m:ss. Be specific and practical: tie every claim to evidence, and skip generic advice like "use trending audio" unless the evidence supports it. Never mention where these frameworks come from.`;

/** The user-facing breakdown, used by the quick path and by the final step of the deep analysis. */
export const BREAKDOWN_FORMAT = `## Breakdown format
If the user asked a specific question, answer it first in a short section, then give the breakdown. Use these sections:

## TL;DR
2–3 sentences naming the core mechanism that made it spread, then one line of scores:
**Skip rate (est.):** likely under 40% / borderline / likely over · **Share rate:** x% vs 6% target (or est.) · **Avg watch time (est.):** likely over / under 21s · **Hook:** x/10 · **Shareability:** x/10 · **Algorithm clarity:** x/10

## 1. The 3-Second Hold (Skip Rate)
The most important section: be the most thorough here. Walk through the first 3 seconds in order: frame 0 (exactly what's on screen), the visual hook, the audio hook (exact words with timestamps and time to first word), the text hook (verbatim), what changes by 1.5s, the open loop and its type, why viewers stay past 3s (the causal chain), skip risks, and the skip-rate estimate against the under-40% target.

## 2. Script & Story Structure
How the script is built: its sections and the structure it follows (e.g. Hook → Ask → Prove → Shock → Explain → Reframe → Empower, problem → solution → result), the key lines and the storytelling tool each uses, and how each section builds momentum. Then an open-loop table: | # | Loop (the question in the viewer's mind) | Type | Opened | Closed | How it's sustained |

## 3. Retention
Timestamped beats after 0:03 (setup, escalation, re-hooks, payoff), pattern interrupts, likely drop-off points, and estimates against the targets: half the audience past 5 seconds, average watch time over 21 seconds (for short videos, through rewatches).

## 4. Share Engine
The dominant share trigger(s) with evidence, who the viewer sends it to and the moment the urge hits, the numbers against the 6% share-rate target (plus shares-to-likes and saves vs shares; skip if no metrics), and 1–2 specific changes to the value of the content that would raise shares.

## 5. Algorithm Read
What the spoken words, on-screen text, visuals, sound, caption and hashtags tell the algorithm the video is about and how early that's clear; anything that would leave it unsure where the video belongs; the micro-Tok it was likely tested in, the macro Tok(s) it could reach, and where the view count suggests it got to. Include the niche overlap it sits in and its moment type if timing matters.

## 6. Craft: Visuals, Delivery & Editing
Lighting, framing, space and contrast, on-camera delivery, cut pace (use the cut stats), captions and text design, the creator archetype and page type, and whether it's evergreen or trend-dependent.

## 7. Steal This
- A fill-in-the-blank template of the hook and the structure
- "Keep the hook, change the body": how to reuse this hook with different content
- 3 alternative hooks, each labeled with its hook form and open-loop type, written to keep skip rate under 40%
- One share trigger to build into a video like this
- The single most transferable lesson`;

const STYLE = `## Style
Answer follow-up questions directly and don't repeat the whole breakdown. When there are several videos, compare them side by side on skip rate, share rate, open loops and how clearly the algorithm can place them. If a video looks like the user's own unpublished draft (an upload with no metrics), treat it as a pre-publish review: predict its skip rate, share rate and watch time against the targets, check that the algorithm could tell which Tok it belongs to, and give concrete fixes for the first 3 seconds. When writing hooks for the user's own niche, aim at the overlap of the three communities that define it.`;

/** Used for follow-up questions, and for whole breakdowns when ANALYSIS=quick. */
export const SYSTEM_PROMPT = [PERSONA, GROUND_RULES, '# Framework', FULL_FRAMEWORK, BREAKDOWN_FORMAT, STYLE].join('\n\n');


export const DEFAULT_VIDEO_ASK =
  'Break down why this video went viral, focusing on how it earns the 3-second hold and what makes people share it.';

const fmtNum = (n?: number) => (n === undefined || n === null ? undefined : n.toLocaleString('en-US'));
const pct = (num?: number, den?: number) =>
  num !== undefined && den ? `${((num / den) * 100).toFixed(2)}%` : undefined;

export const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/**
 * What is said in the hook window, from "[m:ss.s] text" transcript lines.
 * Segments are phrase-level, so a line that starts before 3s may run past it.
 */
export function hookWindow(transcript?: string): { firstSpeech: string; text: string } | undefined {
  const segments = (transcript ?? '')
    .split('\n')
    .map((line) => /^\[(\d+):(\d{1,2}(?:\.\d+)?)\]\s*(.+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() }));
  if (!segments.length) return undefined;
  const early = segments.filter((s) => s.t < 3);
  return {
    firstSpeech: fmtTime(segments[0].t),
    text: early.length ? `"${early.map((s) => s.text).join(' ')}"` : 'none (first words come after 3s)',
  };
}

/** Plain-text summary of a video that is sent to the LLM on every turn. */
export function dossier(v: Video): string {
  const m = v.meta;
  const lines = [`=== VIDEO DOSSIER (id ${v.id}) ===`];
  const add = (label: string, value?: string | number) => {
    if (value !== undefined && value !== '') lines.push(`${label}: ${value}`);
  };
  add('Platform', m.platform);
  add('URL', m.url ?? v.sourceUrl);
  add('Creator', m.uploader);
  add('Posted', m.uploadDate);
  add('Caption', m.description || m.title);
  add('Hashtags', m.hashtags?.join(' '));
  add('Sound', [m.track, m.artist].filter(Boolean).join(' — ') || undefined);

  const stats = [
    ['views', m.viewCount],
    ['likes', m.likeCount],
    ['comments', m.commentCount],
    ['shares', m.shareCount],
    ['saves', m.saveCount],
  ].filter(([, n]) => n !== undefined && n !== null) as [string, number][];
  if (stats.length) {
    add('Engagement', stats.map(([k, n]) => `${fmtNum(n)} ${k}`).join(', '));
    const ratios = [
      ['likes/views', pct(m.likeCount, m.viewCount)],
      ['comments/views', pct(m.commentCount, m.viewCount)],
      ['shares/views', pct(m.shareCount, m.viewCount)],
      ['saves/views', pct(m.saveCount, m.viewCount)],
      ['shares:likes', m.shareCount && m.likeCount ? `1:${(m.likeCount / m.shareCount).toFixed(1)}` : undefined],
      ['saves:shares', m.saveCount !== undefined && m.shareCount ? (m.saveCount / m.shareCount).toFixed(2) : undefined],
    ].filter(([, r]) => r);
    if (ratios.length) add('Ratios', ratios.map(([k, r]) => `${k} ${r}`).join(', '));
  }

  if (v.durationSec) {
    const cuts = v.cuts ?? [];
    const early = cuts.filter((t) => t <= 3).length;
    const avgShot = v.durationSec / (cuts.length + 1);
    add('Duration', `${v.durationSec.toFixed(1)}s`);
    add(
      'Editing pace',
      `${cuts.length} hard cuts (${early} in the first 3s), average shot ${avgShot.toFixed(1)}s` +
        (cuts.length ? `; cuts at ${cuts.slice(0, 40).map(fmtTime).join(', ')}` : ''),
    );
  }
  if (v.hasAudio === false) add('Audio', 'none detected');
  const hook = hookWindow(v.transcript);
  if (hook) {
    add('First spoken word', hook.firstSpeech);
    add('Speech starting in the first 3s', hook.text);
  }

  lines.push('');
  if (v.transcript) {
    lines.push(`Transcript (source: ${v.transcriptSource}):`, v.transcript);
  } else {
    lines.push(`Transcript: unavailable${v.transcriptSource ? ` (${v.transcriptSource})` : ''}.`);
  }
  return lines.join('\n');
}
