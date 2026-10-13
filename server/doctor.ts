/** `npm run doctor`: checks the setup and says exactly what to fix. Never prints API keys. */
import { connectors, localWhisperProblem, transcriberChain, transcription } from './config';
import { INSTALL_HINTS, ensureYtdlp, toolVersions, ytdlpState } from './tools';

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const warn = (msg: string) => console.log(`  ⚠️  ${msg}`);
const fail = (msg: string) => console.log(`  ❌ ${msg}`);

console.log('\nHookLab setup check\n');
let problems = 0;

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 12)) ok(`Node.js ${process.versions.node}`);
else (fail(`Node.js ${process.versions.node} is too old. Install Node 20.12 or newer from https://nodejs.org`), problems++);

if (connectors.length) ok(`Models: ${connectors.map((c) => `${c.label} · ${c.model}`).join(', ')}`);
else warn('No AI model connected yet. Run `npm start` and HookLab walks you through it in your browser.');

await ensureYtdlp();
const tools = await toolVersions();
if (tools.ffmpeg) ok(`ffmpeg ${tools.ffmpeg}`);
else (fail(INSTALL_HINTS.ffmpeg), problems++);
if (tools.ytdlp) ok(`yt-dlp ${tools.ytdlp}`);
else warn(ytdlpState.error ?? `yt-dlp not found, so TikTok/Instagram links won't work (uploads still will). ${INSTALL_HINTS.ytdlp}`);

const chain = transcriberChain();
if (!chain.length) warn('Transcription is off (TRANSCRIPTION=off). The analysis will rely on frames and captions only.');
else ok(`Transcription order: ${chain.join(' → ')}`);
const whisperProblem = localWhisperProblem();
if (chain.includes('local')) {
  ok(`Local Whisper model: ${transcription.whisperModel} (about 300 MB, downloaded to data/models on first use)`);
} else if (whisperProblem) {
  warn(whisperProblem);
}

console.log(problems ? `\n${problems} problem(s) to fix.\n` : '\nAll set. Run: npm start\n');
process.exit(problems ? 1 : 0);
