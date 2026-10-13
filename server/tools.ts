import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN_DIR, FFMPEG, YTDLP_OVERRIDE } from './config';

function version(cmd: string, args: string[], timeout = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.split('\n')[0].trim() || null);
    });
  });
}

// ---- yt-dlp -------------------------------------------------------------------
// Uses YTDLP_PATH, else yt-dlp on PATH, else downloads the official build into ./bin/yt-dlp
// (checked against the release's SHA-256 list) and replaces it whenever a newer release is out.

const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases';
const INSTALL_DIR = join(BIN_DIR, 'yt-dlp');

/**
 * The release file for this platform. macOS and Windows get the unpacked ("onedir") zip: the
 * single-file builds unpack themselves on every run, which costs ~12 seconds per call on macOS.
 */
function ytdlpAsset(): { file: string; zip: boolean } | undefined {
  const { platform, arch } = process;
  if (platform === 'darwin') return { file: 'yt-dlp_macos.zip', zip: true };
  if (platform === 'win32') return { file: arch === 'arm64' ? 'yt-dlp_win_arm64.zip' : 'yt-dlp_win.zip', zip: true };
  if (platform === 'linux' && arch === 'x64') return { file: 'yt-dlp_linux', zip: false };
  if (platform === 'linux' && arch === 'arm64') return { file: 'yt-dlp_linux_aarch64', zip: false };
}

let ytdlpPath = YTDLP_OVERRIDE ?? 'yt-dlp';
export const ytdlpState: { installing: boolean; error?: string } = { installing: false };
let ensuring: Promise<void> | undefined;

export const ytdlp = () => ytdlpPath;

/** Makes sure a working yt-dlp exists, downloading it if needed. Safe to call repeatedly. */
export function ensureYtdlp(): Promise<void> {
  ensuring ??= findOrInstallYtdlp().finally(() => {
    cached = undefined; // re-read versions now that yt-dlp may have changed
    if (ytdlpState.error) ensuring = undefined; // let the next call retry
  });
  return ensuring;
}

async function findOrInstallYtdlp() {
  if (YTDLP_OVERRIDE || (await version('yt-dlp', ['--version']))) return;
  const installed = await findExecutable(INSTALL_DIR);
  const current = installed && (await version(installed, ['--version'], 60_000));
  if (installed && current) {
    ytdlpPath = installed;
    // TikTok and Instagram change often; a stale yt-dlp is the usual reason links stop working.
    void latestRelease().then(async (latest) => {
      if (!latest || latest === current) return;
      console.log(`  Updating yt-dlp ${current} → ${latest}…`);
      await installYtdlp().catch((err) => console.error(`  ⚠️  Couldn't update yt-dlp: ${(err as Error).message}`));
    });
    return;
  }
  try {
    console.log('  Downloading yt-dlp (one time)…');
    await installYtdlp();
    console.log('  ✅ yt-dlp installed.');
  } catch (err) {
    ytdlpState.error = `Couldn't download yt-dlp (${(err as Error).message}). Links won't work until it's installed, but attached video files will. ${INSTALL_HINTS.ytdlp}`;
    console.error(`  ⚠️  ${ytdlpState.error}`);
  }
}

/** The newest release tag, e.g. "2026.08.19", read from where GitHub's "latest" link redirects. */
async function latestRelease() {
  const res = await fetch(`${RELEASES}/latest`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  return res?.headers.get('location')?.split('/tag/')[1];
}

async function findExecutable(dir: string) {
  const files = await readdir(dir).catch(() => [] as string[]);
  const name = files.find((f) => /^yt-dlp[\w-]*(\.exe)?$/.test(f) && f.endsWith('.exe') === (process.platform === 'win32'));
  return name && join(dir, name);
}

function unzip(zip: string, dest: string) {
  // Windows 10+ ships bsdtar, which reads zips; call it by path so Git Bash's GNU tar can't shadow it.
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['ditto', ['-x', '-k', zip, dest]]
      : [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest]];
  return new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000 }, (err) => (err ? reject(new Error(`couldn't unzip it: ${err.message}`)) : resolve())),
  );
}

/** Downloads, verifies and unpacks the latest release next to the current one, then swaps it in. */
async function installYtdlp() {
  const asset = ytdlpAsset();
  if (!asset) throw new Error(`no build for ${process.platform}/${process.arch}`);
  ytdlpState.installing = true;
  ytdlpState.error = undefined;
  const staging = `${INSTALL_DIR}.new`;
  const old = `${INSTALL_DIR}.old`;
  try {
    const download = async (name: string) => {
      const res = await fetch(`${RELEASES}/latest/download/${name}`);
      if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
      return res;
    };
    const [bin, sums] = await Promise.all([
      download(asset.file).then(async (r) => Buffer.from(await r.arrayBuffer())),
      download('SHA2-256SUMS').then((r) => r.text()),
    ]);
    const expected = sums.split('\n').find((l) => l.trim().endsWith(` ${asset.file}`))?.split(/\s+/)[0];
    if (!expected || createHash('sha256').update(bin).digest('hex') !== expected) throw new Error('checksum mismatch');

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    if (asset.zip) {
      const zip = join(staging, asset.file);
      await writeFile(zip, bin);
      await unzip(zip, staging);
      await rm(zip);
    } else {
      await writeFile(join(staging, 'yt-dlp'), bin);
      await chmod(join(staging, 'yt-dlp'), 0o755);
    }
    // The first run is slow on macOS while the system scans the new files, so allow plenty of time.
    const exe = await findExecutable(staging);
    if (!exe || !(await version(exe, ['--version'], 90_000))) throw new Error("the downloaded copy doesn't run");

    await rm(old, { recursive: true, force: true });
    if (existsSync(INSTALL_DIR)) await rename(INSTALL_DIR, old);
    await rename(staging, INSTALL_DIR);
    await rm(old, { recursive: true, force: true }).catch(() => {});
    ytdlpPath = (await findExecutable(INSTALL_DIR)) ?? ytdlpPath;
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    ytdlpState.installing = false;
    cached = undefined;
  }
}

// ---- versions -------------------------------------------------------------------

let cached: Promise<{ ytdlp: string | null; ffmpeg: string | null }> | undefined;

/** Versions of the external tools, or null when one is missing. */
export function toolVersions() {
  cached ??= Promise.all([version(ytdlpPath, ['--version']), version(FFMPEG, ['-version'])]).then(([ytdlp, ffmpeg]) => ({
    ytdlp,
    ffmpeg: ffmpeg?.replace(/^ffmpeg version (\S+).*/, '$1') ?? null,
  }));
  return cached;
}

export const INSTALL_HINTS = {
  ytdlp: 'To install it yourself: `brew install yt-dlp` (macOS), `winget install yt-dlp` (Windows), or `pipx install "yt-dlp[default,curl-cffi]"` (Linux). Then restart HookLab.',
  ffmpeg: 'Install ffmpeg: `brew install ffmpeg` (macOS), `winget install ffmpeg` (Windows), or `sudo apt install ffmpeg` (Linux). Then restart HookLab.',
};
