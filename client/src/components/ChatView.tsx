import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import { navigate } from '../App';
import type { Chat, Message, Status, VideoSummary } from '../types';
import { VideoCard } from './VideoCard';

const POLL_MS = 1500;
const SUGGESTIONS = [
  'Break down the hook frame by frame',
  'List every open loop and where it closes',
  'Write 5 hooks in this style for my niche: ',
  'Compare these two videos. Why did one outperform?',
];

interface Props {
  chatId?: string;
  status: Status;
  onChatsChanged: () => void;
}

export function ChatView({ chatId, status, onChatsChanged }: Props) {
  const { connectors } = status;
  const [chat, setChat] = useState<Chat>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [videos, setVideos] = useState<Record<string, VideoSummary>>({});
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [newChatConnector, setNewChatConnector] = useState<string>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await api.getChat(chatId);
      setChat(res.chat);
      setMessages(res.messages);
      setVideos(Object.fromEntries(res.videos.map((v) => [v.id, v])));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load chat');
    }
  }, [chatId]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteVideo(video: VideoSummary) {
    if (!confirm('Delete this video? Its transcript and frames are removed; the analysis text stays in the chat.')) return;
    try {
      await api.deleteVideo(video.id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete the video');
    }
  }

  // Poll while the agent is working on a reply.
  const pending = messages.some((m) => m.status === 'pending');
  const wasPending = useRef(false);
  useEffect(() => {
    if (!pending) {
      if (wasPending.current) onChatsChanged(); // title may have changed
      wasPending.current = false;
      return;
    }
    wasPending.current = true;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load, onChatsChanged]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages.at(-1)?.status, messages.at(-1)?.progress]);

  const noConnectors = connectors.length === 0;
  const defaultConnectorId = status.defaultConnectorId;
  const chatConnector = connectors.find((c) => c.id === chat?.connectorId)?.id;
  const selectedConnectorId = chat ? (chatConnector ?? defaultConnectorId) : (newChatConnector ?? defaultConnectorId);

  async function changeConnector(id: string) {
    if (!chat) return setNewChatConnector(id);
    const res = await api.updateChat(chat.id, { connectorId: id });
    setChat(res.chat);
  }

  async function send(text = draft) {
    const content = text.trim();
    if ((!content && !file) || sending || pending) return;
    setSending(true);
    setSendError(undefined);
    try {
      const uploadId = file ? await api.uploadVideo(file) : undefined;
      let id = chatId;
      if (!id) {
        id = (await api.createChat(selectedConnectorId)).chat.id;
      }
      const res = await api.sendMessage(id, content, uploadId);
      setDraft('');
      setFile(undefined);
      if (!chatId) {
        onChatsChanged();
        navigate(`/c/${id}`);
        return;
      }
      setMessages((prev) => [...prev, ...res.messages]);
      onChatsChanged();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  if (loadError) return <div className="chat-empty error-text">{loadError}</div>;

  return (
    <div className="chat">
      <header className="chat-header">
        <h2 className="ellipsis">{chat?.title ?? 'New analysis'}</h2>
        {connectors.length > 0 && (
          <label className="connector-picker">
            <span className="muted small">Model</span>
            <select value={selectedConnectorId} onChange={(e) => changeConnector(e.target.value)}>
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.model}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="hero-mark">🪝</div>
            <h1>What made it go viral?</h1>
            <p className="muted">
              Paste a TikTok or Instagram Reel link, or attach a video file. Your own AI breaks down the hook, open
              loops, pacing, and what to steal.
            </p>
            {noConnectors ? (
              <a className="primary button-link" href="#/settings">
                Connect an AI model to get started →
              </a>
            ) : (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => setDraft((d) => (d ? `${d}\n${s}` : s))}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} videos={videos} onDeleteVideo={deleteVideo} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        {sendError && <div className="error-box">{sendError}</div>}
        {file && (
          <div className="attachment">
            🎬 {file.name} <span className="muted">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
            <button className="icon-button" onClick={() => setFile(undefined)} aria-label="Remove attachment">
              ×
            </button>
          </div>
        )}
        <div className="composer">
          <button
            className="icon-button attach"
            title="Attach a video file"
            aria-label="Attach a video file"
            onClick={() => fileInput.current?.click()}
            disabled={noConnectors}
          >
            📎
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <textarea
            rows={1}
            value={draft}
            placeholder={noConnectors ? 'Connect an AI model in Settings first' : 'Paste a TikTok / Reel link or ask a follow-up…'}
            disabled={noConnectors}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="primary send" onClick={() => send()} disabled={sending || pending || noConnectors || (!draft.trim() && !file)}>
            {sending ? '…' : '↑'}
          </button>
        </div>
        <p className="tiny muted center">Runs on your computer with your own API keys. Videos up to 150 MB and 10 minutes.</p>
      </div>
    </div>
  );
}

function MessageBubble({
  message: m,
  videos,
  onDeleteVideo,
}: {
  message: Message;
  videos: Record<string, VideoSummary>;
  onDeleteVideo: (video: VideoSummary) => void;
}) {
  if (m.role === 'user') {
    return (
      <div className="msg user">
        {(m.videoIds ?? []).map((id) =>
          videos[id] ? (
            <VideoCard key={id} video={videos[id]} onDelete={() => onDeleteVideo(videos[id])} />
          ) : (
            <div key={id} className="muted small">🗑 Video deleted</div>
          ),
        )}
        {m.uploadId && !m.videoIds?.length && <div className="muted small">🎬 Uploaded video</div>}
        {m.content && <div className="bubble">{m.content}</div>}
      </div>
    );
  }
  return (
    <div className={`msg assistant ${m.status}`}>
      {m.status === 'pending' && (
        <div className="thinking">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          {m.progress ?? 'Working…'}
        </div>
      )}
      {m.status === 'error' && (
        <div className="error-box">
          <Markdown>{m.content}</Markdown>
        </div>
      )}
      {m.status === 'done' && (
        <>
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
          </div>
          <div className="msg-meta">
            {m.connectorLabel && <span>{m.connectorLabel}</span>}
            <button className="link tiny" onClick={() => navigator.clipboard.writeText(m.content)}>
              Copy
            </button>
          </div>
        </>
      )}
    </div>
  );
}
