export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

export interface Connector {
  id: string;
  provider: Provider;
  label: string;
  model: string;
  baseUrl?: string;
  vision: boolean;
}

export interface Status {
  connectors: Connector[];
  defaultConnectorId?: string;
  transcription: { mode: string; chain: ('openai' | 'groq' | 'local' | 'captions')[]; whisperModel: string; localWhisperProblem?: string };
  tools: {
    ytdlp: string | null;
    ffmpeg: string | null;
    ytdlpInstalling: boolean;
    ytdlpError?: string;
    hints: { ytdlp: string; ffmpeg: string };
  };
  dataDir: string;
  termsAccepted: boolean;
}

export type KeyProvider = 'anthropic' | 'openai' | 'gemini' | 'groq';

export interface SavedSettings {
  keys: Record<KeyProvider, boolean>;
  custom?: { baseUrl: string; model: string; name: string; hasKey: boolean };
}

export interface OllamaStatus {
  running: boolean;
  url: string;
  models: { name: string; sizeGb: number; vision?: boolean }[];
  pull?: { model: string; status: string; percent?: number; error?: string; done?: boolean };
  recommended: { name: string; size: string };
}

export type TestResult = { ok: boolean; message: string };

export interface Chat {
  id: string;
  title: string;
  connectorId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'done' | 'error';
  createdAt: number;
  uploadId?: string;
  videoIds?: string[];
  progress?: string;
  connectorLabel?: string;
}

export interface VideoSummary {
  id: string;
  sourceUrl?: string;
  platform?: string;
  author?: string;
  caption?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  durationSec?: number;
  transcript?: string;
  transcriptSource?: string;
  thumbnailUrl?: string;
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openai_compatible: 'OpenAI-compatible',
};
