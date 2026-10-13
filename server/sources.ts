/** Finds the videos a user message refers to. Shared by the API (quota checks) and the agent. */
import type { Message } from './types';

// Only URLs matching these hosts/paths are ever handed to the downloader.
const VIDEO_URL_RE = new RegExp(
  String.raw`https?://(?:` +
    String.raw`(?:www\.|m\.)?tiktok\.com/@[\w.\-]+/(?:video|photo)/\d+` +
    String.raw`|(?:vm|vt)\.tiktok\.com/[\w\-]+` +
    String.raw`|(?:www\.)?tiktok\.com/t/[\w\-]+` +
    String.raw`|(?:www\.)?instagram\.com/(?:[\w.]+/)?(?:reels?|p|tv)/[\w\-]+` +
    String.raw`)/?(?:\?\S*)?`,
  'gi',
);

export const UPLOAD_ID_RE = /^[a-f0-9]{32}\.(mp4|mov|webm)$/;
export const MAX_VIDEOS_PER_MESSAGE = 3;

export type VideoSource = { type: 'url'; url: string } | { type: 'upload'; uploadId: string };

export function findVideoUrls(text: string): string[] {
  const urls = [...(text ?? '').matchAll(VIDEO_URL_RE)].map((m) => m[0].split('?')[0].replace(/\/$/, ''));
  return [...new Set(urls)];
}

export function videoSources(message: Pick<Message, 'content' | 'uploadId'>): VideoSource[] {
  const sources: VideoSource[] = findVideoUrls(message.content).map((url) => ({ type: 'url', url }));
  if (message.uploadId) sources.push({ type: 'upload', uploadId: message.uploadId });
  return sources;
}
