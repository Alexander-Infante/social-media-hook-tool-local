import type { Chat, KeyProvider, Message, OllamaStatus, SavedSettings, Status, TestResult, VideoSummary } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  status: () => request<Status>('GET', '/status'),
  terms: () => request<{ version: string; text: string }>('GET', '/terms'),
  acceptTerms: (version: string) => request('POST', '/terms/accept', { version }),
  testConnector: (connectorId: string) => request<TestResult>('POST', '/connectors/test', { connectorId }),

  setup: () => request<SavedSettings>('GET', '/setup'),
  saveKey: (provider: KeyProvider, apiKey: string) => request<TestResult>('POST', '/setup/key', { provider, apiKey }),
  saveCustom: (input: { baseUrl: string; model: string; apiKey?: string; name?: string; vision: boolean }) =>
    request<TestResult>('POST', '/setup/custom', input),
  ollama: () => request<OllamaStatus>('GET', '/setup/ollama'),
  useOllamaModel: (model: string) => request<TestResult>('POST', '/setup/ollama', { model }),
  pullOllamaModel: (model: string) => request('POST', '/setup/ollama/pull', { model }),
  setDefaultModel: (connectorId: string) => request('POST', '/setup/default', { connectorId }),
  removeProvider: (provider: KeyProvider | 'custom') => request('DELETE', `/setup/${provider}`),

  listChats: () => request<{ chats: Chat[] }>('GET', '/chats'),
  createChat: (connectorId?: string) => request<{ chat: Chat }>('POST', '/chats', { connectorId }),
  getChat: (id: string) => request<{ chat: Chat; messages: Message[]; videos: VideoSummary[] }>('GET', `/chats/${id}`),
  updateChat: (id: string, input: { title?: string; connectorId?: string }) => request<{ chat: Chat }>('PATCH', `/chats/${id}`, input),
  deleteChat: (id: string) => request('DELETE', `/chats/${id}`),
  deleteVideo: (id: string) => request('DELETE', `/videos/${id}`),
  sendMessage: (chatId: string, content: string, uploadId?: string) =>
    request<{ messages: Message[] }>('POST', `/chats/${chatId}/messages`, { content, uploadId }),

  /** Sends the file to the local server; returns the uploadId to attach to a message. */
  async uploadVideo(file: File): Promise<string> {
    const res = await fetch('/api/uploads', { method: 'POST', headers: { 'content-type': file.type }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'Upload failed');
    return data.uploadId;
  },
};
