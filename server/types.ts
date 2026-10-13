export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

/** One model the user configured (in the app or in .env). The API key lives only in config.ts and is never sent to the browser. */
export interface Connector {
  id: string;
  provider: Provider;
  label: string;
  model: string;
  baseUrl?: string;
  vision: boolean;
}

export interface Chat {
  id: string;
  title: string;
  connectorId?: string;
  createdAt: number;
  updatedAt: number;
}

export type MessageStatus = 'pending' | 'done' | 'error';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  createdAt: number;
  uploadId?: string;
  videoIds?: string[];
  progress?: string;
  connectorLabel?: string;
}

export interface VideoMeta {
  platform?: string;
  url?: string;
  title?: string;
  description?: string;
  uploader?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  saveCount?: number;
  uploadDate?: string;
  track?: string;
  artist?: string;
  hashtags?: string[];
}

export interface Frame {
  t: number;
  file: string;
}

export interface Video {
  id: string;
  status: 'ready';
  sourceUrl?: string;
  uploadId?: string;
  meta: VideoMeta;
  durationSec?: number;
  hasAudio?: boolean;
  transcript?: string;
  transcriptSource?: string;
  frames: Frame[];
  cuts: number[];
  createdAt: number;
}
