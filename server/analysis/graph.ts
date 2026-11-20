/**
 * Deep analysis: a LangGraph pipeline that breaks a newly shared video down step by step.
 *
 *            ┌─ hook ──────┐
 *            ├─ script ────┤
 *   evidence ┼─ share ─────┼─ write ─ review ─┬─ done
 *            ├─ algorithm ─┤     ▲            │
 *            └─ craft ─────┘     └── revise ──┘ (at most once)
 *
 * 1. evidence: a factual log of what's on screen and what's said, so later steps share one ground truth.
 * 2. five specialists run in parallel, each with only the frameworks it needs.
 * 3. write: turns their notes into the user-facing breakdown.
 * 4. review: fact-checks the breakdown against the evidence and sends it back once if needed.
 * Every step is one call to the model the user picked, through the same adapters as chat.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { frameParts } from '../frames';
import { BREAKDOWN_FORMAT, GROUND_RULES, PERSONA, dossier } from '../prompts';
import { UserFacingError, chat, type Part } from '../providers';
import type { AnalysisStep, Connector, Video } from '../types';
import {
  ALGORITHM,
  BRAND,
  DELIVERY,
  GRID,
  HOOKS,
  IDEATION,
  METRICS,
  MOMENTS,
  NICHE,
  OPEN_LOOPS,
  SCRIPT_STRUCTURES,
  SHARE_TRIGGERS,
  STORY_TOOLS,
  VISUALS,
} from './framework';

export interface DeepAnalysisInput {
  connector: Connector;
  apiKey: string;
  videos: Video[];
  /** What the user asked (or the default ask when they only shared a link). */
  ask: string;
  /** Earlier messages in the chat, for the final write-up. */
  context?: string;
  progress: (text: string) => Promise<unknown>;
}

type FrameSet = 'all' | 'hook' | 'none';

interface Specialist {
  id: 'hook' | 'script' | 'share' | 'algorithm' | 'craft';
  title: string;
  frames: FrameSet;
  framework: string[];
  task: string;
}

const SPECIALISTS: Specialist[] = [
  {
    id: 'hook',
    title: 'Hook & skip rate',
    frames: 'hook',
    framework: [METRICS, HOOKS, OPEN_LOOPS],
    task: `Analyze the first 3 seconds and estimate the skip rate. Cover, in order:
- **Frame 0:** exactly what's on screen before the viewer decides
- **Visual hook, audio hook** (exact words, timestamps, time to the first word) **and text hook** (verbatim)
- **By 1.5s:** what changes (a cut, zoom, reveal, gesture)
- **Hook form** (surprising fact, personal story, provocative question, imaginative scenario, or other) and **the open loop** with its type
- **Why viewers stay past 3s:** the causal chain, grounded in the frames and the words
- **Skip risks:** slow build, dead air, an intro or logo, context before the hook, unclear who it's for; or "none significant"
- **Clarity:** does the opening tell both the viewer and the algorithm who this is for within 3 seconds?
- **Skip-rate estimate** against the under-40% target, with your confidence and the evidence
- **3 stronger alternative hooks**, each labeled with its hook form and open-loop type`,
  },
  {
    id: 'script',
    title: 'Script breakdown & retention',
    frames: 'none',
    framework: [METRICS, STORY_TOOLS, SCRIPT_STRUCTURES, OPEN_LOOPS],
    task: `Break the script down line by line, then judge retention.
1. **Line-by-line table** covering every transcript line (merge only trivial fragments): | Time | Line (exact words, trimmed) | What it does for the viewer | Storytelling tool | Section |
2. **Sections:** group the lines by their role, name the structure the script follows (compare it with Hook → Ask → Prove → Shock → Explain → Reframe → Empower if it teaches something), and explain how each section builds momentum. Note tools that are overused or missing.
3. **Open loops:** | # | Loop (the question in the viewer's mind) | Type | Opened | Closed | How it's sustained |. Then the longest stretch with no open loop (the likely drop-off point), and any loop left open on purpose.
4. **Retention estimate:** will half the audience still be watching past 5 seconds? Can average watch time clear 21 seconds (for short videos, through rewatches)? Name the re-hooks, pattern interrupts and drop-off points with timestamps.
5. **Reusable template:** the script as fill-in-the-blank lines, one per section.
If there is no speech, analyze the story told by the visuals and on-screen text the same way.`,
  },
  {
    id: 'share',
    title: 'Share engine & post breakdown',
    frames: 'none',
    framework: [METRICS, SHARE_TRIGGERS, GRID, BRAND],
    task: `Explain what makes people share it (or not), and fill in the post breakdown.
1. **Post breakdown:** Medium, Content pillar, Series, Purpose, Story, Visual hook, Audio hook, Value (body), CTA.
2. **Share triggers:** the dominant one(s) with evidence; who the viewer sends it to, and the timestamp where the urge hits.
3. **Numbers:** shares/views against the 6% target, shares-to-likes, saves vs shares (skip if there are no metrics).
4. **Value of the content:** what the viewer gets, and two specific changes that would make it worth more to someone else and raise the share rate.
5. **If the video is branded or sells something:** which brand-equity stages it works on (salience → performance and imagery → judgements and feelings → resonance), whether it's community- or product-focused, and the functional, emotional and self-expressive reasons a viewer would want it. Skip this if it isn't branded.`,
  },
  {
    id: 'algorithm',
    title: 'Algorithm & niche',
    frames: 'none',
    framework: [ALGORITHM, METRICS, NICHE, MOMENTS],
    task: `Read the video the way the algorithm does.
1. **Classification signals:** what the spoken words, on-screen text, visuals, sound, caption and hashtags each say the video is about; the topic or category; how early it's clear. Flag anything mixed or vague that could leave the algorithm unsure where it belongs.
2. **Audience path:** the likely test audience, the micro-Tok it was tested in, the macro Tok(s) it could break into, and where the view count suggests it reached (under ~10k: test audience or micro-Tok; over ~100k: macro Toks or the masses). With no metrics, predict it.
3. **Niche:** the three communities whose overlap this video sits in, and its audience, territory, context and tension/stakes.
4. **Profile signals** you can infer (creator, page type, fit with a consistent niche) and what you can't know.
5. **Timing:** the moment type it rides (hallmark, subculture, moment that matters, zeitgeist) and whether its success is evergreen or depends on a trend that will fade.`,
  },
  {
    id: 'craft',
    title: 'Craft: visuals, delivery & editing',
    frames: 'all',
    framework: [VISUALS, DELIVERY, NICHE],
    task: `Analyze the craft: how it looks, sounds and is delivered.
1. **Visual storytelling:** lighting, shot size, angle and movement, framing, space and depth (where is the eye drawn?), line and shape, contrast vs affinity and how it shifts.
2. **Delivery** (if someone is on camera): presence before words, voice, energy, authenticity, focus, how decisively it ends.
3. **Editing:** pace from the cut stats (cuts in the first 3 seconds, average shot length), pattern interrupts, captions, text overlays, zooms, b-roll, sound and music.
4. **Voice:** the creator archetype(s) and page type, and how consistent the look and voice are.
5. **Production verdict:** does the substance carry it or the polish? What would improve it most for the least effort?`,
  },
];

const EVIDENCE_TASK = `Write a factual EVIDENCE LOG for the video(s). Describe, don't judge: every later step relies on this log, so be precise and complete. For each video:

### Frame log
One line per attached frame, in order: \`m:ss.s: subject, shot size and angle, setting, lighting, motion cues, faces and expressions, graphics; on-screen text "verbatim"\`.

### Spoken timeline
The transcript regrouped into beats: \`m:ss–m:ss: what is said\`, quoting the key words exactly. Mark the first spoken word.

### Sound and metadata
The sound or music, caption, hashtags and stats exactly as given.

### Can't tell
What the evidence doesn't show (what happens between frames, tone of voice, anything unreadable).`;

const REVIEW_TASK = `You are a demanding editor fact-checking a video breakdown before it reaches the creator. Check it against the dossier, the evidence log and the analysts' notes:
1. Every quote, timestamp, number and piece of on-screen text appears in the dossier or evidence log (nothing invented).
2. Estimates (skip rate, watch time, retention) are labeled as estimates.
3. Targets are used correctly: skip rate under 40%, share rate over 6%, average watch time over 21 seconds, half the audience past 5 seconds.
4. Every section of the format is present, specific to this video, and consistent with the others and with the notes.
5. Advice is concrete and grounded in the evidence; nothing generic.
6. It never mentions notes, analysts, steps or where the frameworks come from.

Reply with the first line exactly \`VERDICT: PASS\` or \`VERDICT: REVISE\`, then up to 10 bullet points naming each specific problem and its fix. Choose PASS when only trivial issues remain.`;

const needsRevision = (review?: string) => /VERDICT:\s*REVISE/i.test(review ?? '');

export async function runDeepAnalysis(input: DeepAnalysisInput): Promise<{ reply: string; steps: AnalysisStep[] }> {
  const { connector, apiKey, videos, progress } = input;

  const ask = (system: string, parts: Part[]) => chat(connector, apiKey, system, [{ role: 'user', parts }], { maxTokens: 12000 });
  const system = (...sections: string[]) => [PERSONA, GROUND_RULES, ...sections].join('\n\n');

  /** Each video's dossier, plus its frames when the model can see them. */
  async function videoParts(frames: FrameSet): Promise<Part[]> {
    const parts: Part[] = [];
    for (const video of videos) {
      parts.push({ type: 'text', text: dossier(video) });
      if (frames !== 'none' && connector.vision) parts.push(...(await frameParts(video, frames === 'hook' ? 3 : Infinity)));
    }
    if (frames !== 'none' && !connector.vision) parts.push({ type: 'text', text: 'Frames are not available: this model is text-only.' });
    return parts;
  }

  const text = (t: string): Part => ({ type: 'text', text: t });
  const section = (title: string, body: string) => text(`=== ${title} ===\n${body}`);

  const State = Annotation.Root({
    evidenceLog: Annotation<string>(),
    notes: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
    failures: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
    draft: Annotation<string>(),
    reviews: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
    revisions: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  });
  type S = typeof State.State;

  async function evidence(): Promise<Partial<S>> {
    await progress('Step 1 of 4 · Logging what is on screen and what is said');
    return { evidenceLog: await ask(system(EVIDENCE_TASK), await videoParts('all')) };
  }

  let done = 0;
  const specialist = (spec: Specialist) => async (state: S): Promise<Partial<S>> => {
    try {
      const note = await ask(
        system('# Framework', ...spec.framework, `# Your task: ${spec.title}`, spec.task),
        [...(await videoParts(spec.frames)), section('EVIDENCE LOG', state.evidenceLog), text(`The creator asked: ${input.ask}`)],
      );
      return { notes: { [spec.id]: note } };
    } catch (err) {
      return { failures: { [spec.id]: err instanceof Error ? err.message : String(err) } };
    } finally {
      done++;
      await progress(`Step 2 of 4 · Analyzing hook, script, shareability, algorithm fit and craft (${done} of ${SPECIALISTS.length} done)`);
    }
  };

  async function write(state: S): Promise<Partial<S>> {
    if (Object.keys(state.notes).length === 0) {
      const first = Object.values(state.failures)[0];
      throw new UserFacingError(first ?? 'The analysis failed.');
    }
    const revising = needsRevision(state.reviews.at(-1));
    await progress(revising ? 'Step 4 of 4 · Fixing what the fact-check found' : 'Step 3 of 4 · Writing the breakdown');
    const notes = SPECIALISTS.filter((s) => state.notes[s.id]).map((s) => section(`ANALYST NOTES: ${s.title}`, state.notes[s.id]));
    const parts: Part[] = [
      ...(await videoParts('none')),
      section('EVIDENCE LOG', state.evidenceLog),
      ...notes,
      ...(input.context ? [section('EARLIER IN THIS CHAT', input.context)] : []),
      text(`The creator asked: ${input.ask}`),
    ];
    if (revising) {
      parts.push(section('YOUR PREVIOUS DRAFT', state.draft), section('FACT-CHECK', state.reviews.at(-1)!));
      parts.push(text('Return the full breakdown again with every fact-check issue fixed.'));
    }
    const writer = `You are writing the final breakdown for the creator from your analysts' step-by-step notes. Use their findings, keep the specifics (exact words, timestamps, numbers, tables), and resolve any disagreement in favor of the dossier and evidence log. Don't mention the notes or the analysts.`;
    const draft = await ask(system(METRICS, IDEATION, writer, BREAKDOWN_FORMAT), parts);
    return { draft, revisions: revising ? state.revisions + 1 : state.revisions };
  }

  async function review(state: S): Promise<Partial<S>> {
    await progress('Step 4 of 4 · Fact-checking the breakdown');
    try {
      const notes = SPECIALISTS.filter((s) => state.notes[s.id]).map((s) => section(`ANALYST NOTES: ${s.title}`, state.notes[s.id]));
      const verdict = await ask(system(REVIEW_TASK), [
        ...(await videoParts('none')),
        section('EVIDENCE LOG', state.evidenceLog),
        ...notes,
        section('BREAKDOWN TO CHECK', state.draft),
      ]);
      return { reviews: [verdict] };
    } catch {
      return { reviews: ['VERDICT: PASS (the fact-check could not run)'] };
    }
  }

  const graph = new StateGraph(State)
    .addNode('evidence', evidence)
    .addNode('hook', specialist(SPECIALISTS[0]))
    .addNode('script', specialist(SPECIALISTS[1]))
    .addNode('share', specialist(SPECIALISTS[2]))
    .addNode('algorithm', specialist(SPECIALISTS[3]))
    .addNode('craft', specialist(SPECIALISTS[4]))
    .addNode('write', write)
    .addNode('review', review)
    .addEdge(START, 'evidence')
    .addEdge('evidence', 'hook')
    .addEdge('evidence', 'script')
    .addEdge('evidence', 'share')
    .addEdge('evidence', 'algorithm')
    .addEdge('evidence', 'craft')
    .addEdge(['hook', 'script', 'share', 'algorithm', 'craft'], 'write')
    .addEdge('write', 'review')
    .addConditionalEdges('review', (s: S) => (needsRevision(s.reviews.at(-1)) && s.revisions < 1 ? 'write' : END), ['write', END])
    .compile();

  const final = await graph.invoke({});

  const steps: AnalysisStep[] = [
    { id: 'evidence', title: 'Evidence log', content: final.evidenceLog },
    ...SPECIALISTS.map((s) => ({
      id: s.id,
      title: s.title,
      content: final.notes[s.id] ?? `_This step failed: ${final.failures[s.id] ?? 'unknown error'}_`,
    })),
    { id: 'review', title: 'Fact-check', content: final.reviews.join('\n\n---\n\n') },
  ];
  return { reply: final.draft, steps };
}
