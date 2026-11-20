/**
 * The analysis framework: how short-form distribution works and the craft tools behind it.
 * Split into sections so each step of the analysis graph (graph.ts) gets only what it needs,
 * and the follow-up chat prompt (prompts.ts) gets the whole thing.
 */

export const METRICS = `## The metrics that matter
| Metric | What it measures | Target | Creative lever |
| --- | --- | --- | --- |
| Skip rate | Share of views that swipe away in the first 3 seconds (its inverse is "thumbstop", like a website's bounce rate) | under 40% skip, so 60%+ thumbstop | The hook |
| Share rate | Share of viewers who share the video | over 6% | The value of the content |
| Average watch time | Average time spent watching | over 21 seconds | Value, retention tactics, the hook |
| Retention curve | Share of the audience still watching at each moment | 50% still watching past 5 seconds | Value, retention tactics, the hook |

Skip rate and share rate drive distribution most, in that order. Average watch time and the retention curve show whether the rest of the video earns its length; a video shorter than 21 seconds can only beat the watch-time target through rewatches, so replay value matters for short videos.

Retention data is not public, so skip rate, watch time and the retention curve are always estimates: label them as estimates. Public shares/views is the closest stand-in for share rate; few videos reach 6%, so say how far a video is from the target rather than calling everything below it a failure. A shares-to-likes ratio above about 1:10 means people pass it on rather than just approve. Saves point to personal value; shares point to social value. Reach is indirect evidence: a video with a large view count almost certainly passed the early audience tests, so explain why it held instead of doubting that it did.`;

export const ALGORITHM = `## How the algorithm decides who sees a video
1. **It analyzes the content** to classify it: the spoken words, the text on screen, the visuals, the audio or sound, and the topic or category. This is SEO for short-form video: what is said and shown tells the platform what the video is about and who it's for.
2. **It analyzes the creator's profile:** the profile itself, what the account has engaged with, who has typically engaged with its content, and the account's standing. A new account must be warmed up (used like a real member of its niche) before it posts.
3. **It tests the video on audiences in stages:** a small test audience → a micro "Tok" (one specific community, like Fantasy inside BookTok) → a macro Tok or several Toks → the masses. Roughly, under 10k views means it stayed in its test audience or micro-Tok; over 100k means it broke out to macro Toks or the masses; videos stuck around 300 views never got past the test audience. **If the algorithm can't figure out where a video belongs, it won't put it anywhere.**`;

export const NICHE = `## Niche and positioning
- **A niche is the overlap of three communities or big ideas** (think subreddits or cultural movements; e.g. water + sustainability + 90s rock culture). The overlap is where a brand or creator is unmistakable.
- A niche is defined by its **audience** (who it's for: shared needs, tastes, attitudes), **territory** (what the account keeps exploring), **context** (the everyday moment when it matters) and **tension/stakes** (what the audience wants, what gets in the way, and what's at stake).
- **Why people want it (the audience's side):** functional (what I want it to do), emotional (how I want to feel), self-expressive (who I want to be).
- **Creator archetypes** (how people experience the voice): Lab Rat / Glow-Up (shares a transformation), Builder (builds in public), Connector (surfaces people and ideas), Analyst / Visionary (finds patterns), Translator / Teacher (makes things understandable), Provoker (challenges a belief), Lifestylist / Curator (curates a way of living), Performer (entertains), Operator (shows how things run), Reviewer (tests and gives a verdict), Relatable Best Friend (reflects shared experience).
- **Page types:** community, founder/personality, faceless, brand (created), brand (curated), brand (decentralized, many creators).
- **Content mix:** roughly 60–80% community-focused content and 20–40% product-focused. Community content earns the attention that product content spends.`;

export const BRAND = `## Brand equity (for branded or product videos)
The brand lives in the viewer's mind and is built by repeated exposure, in stages that build on each other:
1. **Salience** (identity: who are you?) → brand awareness
2. **Performance** (tangible benefits, quality, price; points of parity vs points of difference) and **Imagery** (what life looks like with the problem solved, even aspirationally; when the viewer would appreciate it most) → meaning: what are you?
3. **Judgements** (rational: quality, credibility, superiority) and **Feelings** (emotional: warmth, fun, excitement, security, social approval, self-respect) → responses: what about you?
4. **Resonance** (intense, active loyalty: attachment, advocacy, community; the brand becomes part of the viewer's identity) → relationship: what about you and me?
The left side (performance, judgements) is logic; the right side (imagery, feelings) is passion. Strong brands do both, though most lean one way.`;

export const HOOKS = `## Hooks
A hook is the one-sentence opening (spoken, written on screen, or shown) that makes someone want to keep watching. Classic forms: a surprising statistic or fact, a personal story or anecdote, a provocative question, an imaginative scenario ("Imagine waking up and…"). Every video has a **visual hook** (what grabs the eye at frame 0: motion, a face, bold text, a transition, something unexpected) and usually an **audio hook** (the first words or sound). The strongest hooks open a loop the viewer needs closed.`;

export const OPEN_LOOPS = `## Open loops
An open loop creates curiosity by leaving part of the story, idea or answer unresolved, so only watching further closes it. It is the main retention tactic. Types:
- **Cliffhanger:** the story stops at the turning point ("I was about to sign the deal of my life… then something changed everything")
- **Mystery or puzzle:** a question few people talk about ("There's one decision every great leader makes")
- **Promised payoff:** "By the end you'll know the three words that…"
- **Delayed reveal:** "I'll share my biggest mistake, but not until the end"
- **Result first:** show the outcome, then rewind to how it happened
- **Numbered promise:** "3 mistakes that…"; strongest when the best item comes last
- **In medias res:** open at the peak of a story with no setup
- **Contrarian:** "Stop doing X"; challenges something the viewer believes
- **Direct callout:** "If you're a ___, watch this"; the viewer self-selects in
- **Stakes:** a challenge, bet, countdown or risk the viewer wants resolved
- **Visual pattern interrupt:** something unexpected at frame 0 that demands an explanation
- **Stacked loops:** a new question opens before the current one closes, so there's never a clean exit
- **Deliberately unresolved:** left open to drive comments, follows or a part 2`;

export const STORY_TOOLS = `## Storytelling tools (label each line of a script with the one it uses)
- **Hook:** the opening line that earns attention
- **Open loop:** an unresolved question that sustains attention
- **Callback:** a reference back to an earlier story, phrase or image; creates cohesion and a satisfying close
- **Rule of three:** ideas grouped in threes; two beats set the pattern, the third lands the point or punchline
- **Contrast:** before/after, failure/success, ordinary/extraordinary, risk/reward; the brain notices shifts
- **Make the audience work:** questions, predictions, incomplete statements that make viewers draw the conclusion themselves
- **Signposting:** telling viewers where they are and what's next ("first…", "here's the second…")
- **Ethos:** credibility, own or borrowed (experts, studies, the team, customers)
- **Logos:** data, cause and effect, comparisons, a logical sequence
- **Pathos:** emotion, values, vivid imagery, empathy or tension
- **Pattern interrupt:** a deliberate break in rhythm (tone shift, format switch, surprise visual, breaking the fourth wall, a pause)
- **Memorable metaphor:** an abstract idea turned into a picture ("leaving your front door open with a neon welcome sign")
- **Call to action:** the next step (follow, comment, share, buy), or a lingering question
Use tools judiciously: a script crowded with tricks feels like a sticker-covered laptop.`;

export const SCRIPT_STRUCTURES = `## Script breakdown method and structures
Break a script down line by line: what is each line doing for the viewer, which storytelling tool does it use, and why does it exist? Then group lines into sections by their role in the story and explain how each section builds momentum and keeps the viewer engaged. Finally, turn each line into a reusable template.

A proven structure for educational short-form: **Hook → Ask → Prove → Shock → Explain → Reframe → Empower**
- Hook: a relatable scene or claim that stops the scroll
- Ask: the question the video will answer
- Prove: credible evidence (a study, an expert, a test)
- Shock: the surprising result, made concrete with a number or vivid comparison
- Explain: why it happens
- Reframe: shift what the viewer should care about
- Empower: what to do instead; leaves the viewer more capable
Other common shapes: problem → solution → result; before → process → after; story arc with a callback ending. Delivery rule: **end decisively.**`;

export const DELIVERY = `## Laws of on-camera delivery
1. Presence before words (posture, eye line, energy land before the first line)
2. The voice is an instrument (pace, pitch, emphasis, pauses)
3. Know and adapt to the audience (their language, slang and references)
4. Story is everything
5. Memorize structure, not words
6. Be authentic to yourself
7. A good steak is made of good steak (substance beats polish; production can't save a weak idea)
8. Keep the energy up
9. Cut the fat and stay focused
10. Practice, preparation and passion
11. End decisively`;

export const VISUALS = `## Visual storytelling and production
- **Pre-production:** shot lists, storyboards, overhead diagrams of the set (camera, lights, audio, props).
- **Lighting and camera:** is the subject clearly lit and separated from the background? Shot size, angle, movement, framing.
- **Line and shape:** imaginary lines and linear motifs guide the eye; repeated shapes build a motif.
- **Space and depth:** depth cues (convergence, size change, overlap, textural diffusion, tonal separation, color separation, focus). Types of space: deep, flat, limited, ambiguous. Ask where the eye is drawn.
- **Contrast and affinity:** contrast (differences in tone, color, space, movement, pace) raises intensity; affinity (sameness) calms it. Shifts between them create rhythm.
- Our brains blend senses to find patterns, so creators can control perception: the look, sound and words should point the same way.
- **Editing:** pace, cuts, captions (required for accessibility and silent viewing), text overlays, zooms, b-roll, sound. Clean and purposeful beats overloaded effects.`;

export const GRID = `## Post breakdown fields
For each post: **Medium** (reel, carousel, poster/meme, thread), **Content pillar** (macro category: influencer content, behind the scenes, product showcase, educational…), **Series** (part of a recurring concept? "Day X doing Y", day in the life), **Purpose** (awareness, engagement, trust, conversion), **Story** (the narrative: before/after, day in the life, why we made this), **Visual hook**, **Audio hook**, **Value** (what the viewer gets from the body: education, entertainment, benefit), **CTA** (if any).`;

export const MOMENTS = `## Timing: moment types
- **Hallmark moments:** fixed, widely known dates and seasons (Mother's Day, back-to-school, the Super Bowl); predictable attention spikes.
- **Subculture moments:** niche holidays, internet traditions and community rituals (National Dog Day, Comic-Con); signal belonging.
- **Moments that matter:** where the audience's needs naturally meet the product or expertise (payday, finals week, Sunday reset, tax season); the foundation of a calendar.
- **Zeitgeist moments:** breaking news, viral trends and conversations in real time; need fast action and fade fast.
- **Personalized moments:** individual milestones (birthday, first purchase, 100th workout).`;

export const IDEATION = `## Turning analysis into new content
- **Simulation vs synthesis:** synthesis creates something new from your own taste; simulation takes something already proven and reuses its structure, transforms its medium, or borrows its hook. When nothing is working: **keep the hook, change the body** (the "meat").
- **Research:** a warmed-up account's For You page shows what wins in a niche; collect only top performers in a content bank, along with communities like Reddit and X.
- **Process:** research & SEO → writing → pre-production → production → editing → publishing → analytics, then review the data and improve daily.`;

export const SHARE_TRIGGERS = `## Why people share
- **Utility:** saves someone time, money or a mistake ("send this to someone who needs it")
- **Identity:** sharing signals the sharer's taste, values, humor or profession
- **Tag-a-friend relatability:** "this is so you"; it describes a specific person in the viewer's life
- **High-arousal emotion:** awe, laughter, surprise or righteous anger (low-arousal feelings rarely get shared)
- **Social currency:** insider knowledge, a secret, a hack, being first to know
- **Debate:** a take people send to others to agree or argue with
Share rate's creative lever is the value of the content: people share what is worth something to someone else.`;

/** Everything, for the follow-up chat. */
export const FULL_FRAMEWORK = [
  ALGORITHM,
  METRICS,
  HOOKS,
  OPEN_LOOPS,
  STORY_TOOLS,
  SCRIPT_STRUCTURES,
  SHARE_TRIGGERS,
  GRID,
  NICHE,
  BRAND,
  DELIVERY,
  VISUALS,
  MOMENTS,
  IDEATION,
].join('\n\n');
