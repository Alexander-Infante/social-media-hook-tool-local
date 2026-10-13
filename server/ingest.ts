/**
 * Turns a TikTok/Instagram URL or an uploaded file into analysis inputs:
 * metadata (yt-dlp), still frames, scene cuts and audio (ffmpeg), and platform captions if present.
 */
import { execFile } from 'node:child_process';
import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FFMPEG } from './config';
import { fmtTime } from './prompts';
import { UserFacingError } from './providers';
import { ensureYtdlp, ytdlp } from './tools';
import type { VideoMeta } from './types';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(cmd: string, args: string[], timeoutMs: number, encoding: 'utf8' | 'buffer' = 'utf8') {
  return new Promise<RunResult & { raw?: Buffer }>((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new UserFacingError(`\`${cmd}\` is not installed. See **Settings** in HookLab for setup help.`));
      }
      if (err && err.killed) return reject(new UserFacingError('Processing the video timed out.'));
      resolve({
        stdout: encoding === 'utf8' ? stdout.toString('utf8') : '',
        raw: encoding === 'buffer' ? stdout : undefined,
        stderr: stderr.toString('utf8'),
        code: err ? Number((err as { code?: number }).code ?? 1) : 0,
      });
    });
  });
}

// ---- input safety -----------------------------------------------------------

/**
 * ffmpeg picks a demuxer by sniffing file contents, so a "video" that is really an HLS or concat
 * playlist could make it read other files on this computer. We check the container ourselves and
 * force that demuxer (plus file-only I/O) on every ffmpeg call.
 */
export type Container = 'mov' | 'matroska';

export async function detectContainer(file: string): Promise<Container> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    if (bytesRead >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) return 'matroska'; // EBML: .webm / .mkv
    const box = buffer.subarray(4, 8).toString('latin1');
    if (bytesRead >= 8 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return 'mov'; // .mp4 / .mov
  } finally {
    await handle.close();
  }
  throw new UserFacingError("That file isn't a supported video. Use an .mp4, .mov or .webm file.");
}

const input = (file: string, container: Container) => ['-protocol_whitelist', 'file', '-f', container, '-i', file];

// ---- download ---------------------------------------------------------------

export async function downloadFromUrl(url: string, dir: string) {
  await ensureYtdlp();
  const { stdout, stderr, code } = await run(
    ytdlp(),
    [
      '--ignore-config',
      '--no-playlist',
      '--no-cache-dir',
      '--no-progress',
      '--no-warnings',
      '--dump-json',
      '--no-simulate',
      '-f', 'b[ext=mp4]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--max-filesize', '150M',
      '--hls-prefer-native',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', 'en.*,eng.*',
      '--sub-format', 'vtt/best',
      '--convert-subs', 'vtt',
      '--ffmpeg-location', FFMPEG,
      '--socket-timeout', '20',
      '--retries', '2',
      '-o', join(dir, 'video.%(ext)s'),
      '--',
      url,
    ],
    4 * 60 * 1000,
  );

  const files = await readdir(dir);
  const videoFile = files.find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f));
  if (code !== 0 || !videoFile) {
    const reason = stderr.split('\n').filter((l) => l.includes('ERROR')).pop() ?? stderr.trim().split('\n').pop();
    console.error('yt-dlp failed', url, stderr);
    const hint = url.includes('instagram.com')
      ? 'Instagram often blocks downloads. Save the reel and attach the file instead.'
      : 'The video may be private, deleted, or region-locked, or yt-dlp may need an update (restart HookLab to update it, or run `brew upgrade yt-dlp` if you installed it with Homebrew). You can also save the video and attach the file.';
    throw new UserFacingError(`Couldn't fetch ${url}. ${hint}${reason ? `\n\n\`${reason.slice(0, 200)}\`` : ''}`);
  }

  const lastJson = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const info = lastJson ? (JSON.parse(lastJson) as Record<string, any>) : {};

  const subFile = files.find((f) => f.endsWith('.vtt'));
  const subtitles = subFile ? parseVtt(await readFile(join(dir, subFile), 'utf8')) : undefined;

  return { file: join(dir, videoFile), meta: metaFromInfo(info, url), subtitles: subtitles || undefined };
}

function metaFromInfo(info: Record<string, any>, url: string): VideoMeta {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const description: string | undefined = info.description || undefined;
  const date: string | undefined = info.upload_date;
  return {
    platform: info.extractor_key || (url.includes('instagram') ? 'Instagram' : 'TikTok'),
    url: info.webpage_url || url,
    title: info.title || undefined,
    description,
    uploader: info.uploader || info.channel || info.uploader_id || undefined,
    viewCount: num(info.view_count),
    likeCount: num(info.like_count),
    commentCount: num(info.comment_count),
    shareCount: num(info.repost_count),
    saveCount: num(info.save_count),
    uploadDate: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : undefined,
    track: info.track || undefined,
    artist: info.artist || info.artists?.[0] || undefined,
    hashtags: description ? [...new Set(description.match(/#[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 30) : undefined,
  };
}

/** WebVTT -> "[m:ss.s] text" lines, with duplicate rolling-caption lines removed. */
export function parseVtt(vtt: string): string {
  const out: string[] = [];
  let last = '';
  for (const block of vtt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/.exec(lines[timingIdx]);
    if (!m) continue;
    const t = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const text = lines
      .slice(timingIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === last) continue;
    last = text;
    out.push(`[${fmtTime(t)}] ${text}`);
  }
  return out.join('\n');
}

// ---- analysis ---------------------------------------------------------------

export async function probe(file: string, container: Container) {
  // `ffmpeg -i` with no output exits non-zero but prints stream info to stderr.
  const { stderr } = await run(FFMPEG, ['-hide_banner', ...input(file, container)], 30_000);
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d) throw new UserFacingError("That file doesn't look like a playable video.");
  return {
    durationSec: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    hasAudio: /Stream #.*Audio:/.test(stderr),
  };
}

/** Dense sampling in the hook window, sparse afterwards. */
export function frameTimes(duration: number): number[] {
  const hook = [0, 0.5, 1, 1.5, 2, 2.5, 3].filter((t) => t < duration - 0.1);
  const body: number[] = [];
  const start = 4;
  const end = duration - 0.5;
  if (end > start) {
    const n = Math.min(6, Math.ceil((end - start) / 3));
    for (let i = 0; i < n; i++) body.push(Math.round((start + ((end - start) * i) / Math.max(1, n - 1)) * 10) / 10);
  }
  return [...new Set([...hook, ...body])];
}

export async function extractFrames(file: string, container: Container, times: number[], outDir: string) {
  const frames: { t: number; file: string }[] = [];
  for (let i = 0; i < times.length; i += 4) {
    const batch = times.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (t) => {
        const name = `${t.toFixed(1)}.jpg`;
        const { code } = await run(
          FFMPEG,
          ['-v', 'error', '-ss', String(t), ...input(file, container), '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', '-y', join(outDir, name)],
          30_000,
        );
        return code === 0 ? { t, file: name } : undefined;
      }),
    );
    frames.push(...results.filter((f): f is { t: number; file: string } => Boolean(f)));
  }
  return frames;
}

/** Timestamps of hard cuts, via ffmpeg scene-change detection on a downscaled stream. */
export async function sceneCuts(file: string, container: Container): Promise<number[]> {
  const { stderr } = await run(
    FFMPEG,
    ['-hide_banner', ...input(file, container), '-an', '-vf', "scale=240:-2,select='gt(scene,0.35)',showinfo", '-f', 'null', '-'],
    120_000,
  );
  return [...stderr.matchAll(/Parsed_showinfo.*?pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 10) / 10);
}

/** Small mono AAC for transcription APIs (well under their 25 MB upload limit for a 10-minute video). */
export async function extractAudio(file: string, container: Container, dir: string): Promise<string | undefined> {
  const path = join(dir, 'audio.m4a');
  const { code } = await run(
    FFMPEG,
    ['-v', 'error', ...input(file, container), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '64k', '-y', path],
    120_000,
  );
  return code === 0 ? path : undefined;
}

/** Raw 16 kHz mono float samples, the input local Whisper expects. */
export async function decodePcm(file: string, container: Container): Promise<Float32Array | undefined> {
  const { code, raw } = await run(
    FFMPEG,
    ['-v', 'error', ...input(file, container), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
    120_000,
    'buffer',
  );
  if (code !== 0 || !raw?.length) return undefined;
  const aligned = new Uint8Array(raw).buffer; // copy so the Float32Array view is 4-byte aligned
  return new Float32Array(aligned, 0, Math.floor(raw.length / 4));
}
