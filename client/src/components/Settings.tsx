import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { PROVIDER_NAMES, type Connector, type SavedSettings, type Status, type TestResult } from '../types';
import { ModelSetup } from './ModelSetup';

const TRANSCRIBER_INFO = {
  openai: { name: 'OpenAI Whisper', detail: 'Uses your OpenAI key. About $0.006 per minute of audio, word-level timing.' },
  groq: { name: 'Groq Whisper', detail: 'Uses your Groq key. Very cheap or free tier, word-level timing.' },
  local: { name: 'Local Whisper', detail: 'Runs on this computer. Free and private; the model downloads on first use.' },
  captions: { name: 'Platform captions', detail: 'Captions TikTok/Instagram provide, when they exist. Used as a fallback.' },
};

export function Settings({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const { connectors, transcription, tools } = status;
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<SavedSettings>();

  const refresh = () => {
    onChanged();
    api.setup().then(setSaved, () => {});
  };
  useEffect(refresh, []);

  // Refresh while yt-dlp downloads in the background, so its status updates by itself.
  useEffect(() => {
    if (!tools.ytdlpInstalling) return;
    const timer = setInterval(onChanged, 3000);
    return () => clearInterval(timer);
  }, [tools.ytdlpInstalling, onChanged]);

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">
        HookLab runs entirely on this computer. Keys you add here are saved in <code>data/settings.json</code> in the HookLab folder and are
        sent only to the provider they belong to.
      </p>

      <h2>AI models</h2>
      <div className="connector-list">
        {connectors.map((c) => (
          <ConnectorRow key={c.id} connector={c} isDefault={c.id === status.defaultConnectorId} onChanged={refresh} />
        ))}
      </div>
      {adding || connectors.length === 0 ? (
        <div className="card">
          <div className="connector-main">
            <strong>Add a model</strong>
            {connectors.length > 0 && (
              <button className="link small" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
          </div>
          <ModelSetup
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
          {saved?.custom && (
            <p className="muted tiny">Connecting a local (Ollama) or “Other” model replaces your current one ({saved.custom.name || saved.custom.baseUrl}).</p>
          )}
        </div>
      ) : (
        <button onClick={() => setAdding(true)}>+ Add a model</button>
      )}

      <h2>Transcription</h2>
      <p className="muted small">Tried in this order until one finds speech:</p>
      {transcription.chain.length === 0 ? (
        <div className="notice">
          Transcription is turned off (<code>TRANSCRIPTION=off</code>).
        </div>
      ) : (
        <ol className="transcriber-list">
          {transcription.chain.map((t) => (
            <li key={t}>
              <strong>{TRANSCRIBER_INFO[t].name}</strong>
              {t === 'local' && <code className="small"> {transcription.whisperModel}</code>}
              <div className="muted small">{TRANSCRIBER_INFO[t].detail}</div>
            </li>
          ))}
        </ol>
      )}
      {transcription.localWhisperProblem && <div className="notice">{transcription.localWhisperProblem}</div>}
      {saved && <GroqKey saved={saved.keys.groq} onChanged={refresh} />}

      <h2>Tools</h2>
      <div className="card">
        <div>
          <strong>yt-dlp</strong> <span className="muted small">downloads TikTok / Instagram links</span>
          {tools.ytdlp ? (
            <div className="muted small">{tools.ytdlp}</div>
          ) : tools.ytdlpInstalling ? (
            <div className="muted small">Downloading it for you…</div>
          ) : (
            <div className="error-text small">{tools.ytdlpError ?? tools.hints.ytdlp}</div>
          )}
        </div>
        <div>
          <strong>ffmpeg</strong> <span className="muted small">extracts frames and audio</span>
          <div className={tools.ffmpeg ? 'muted small' : 'error-text small'}>{tools.ffmpeg ?? tools.hints.ffmpeg}</div>
        </div>
      </div>

      <h2>Your data</h2>
      <p className="muted small">
        Chats, transcripts and frames are saved in <code>{status.dataDir}</code>. Delete that folder to erase everything, including your saved keys.
      </p>
    </div>
  );
}

function ConnectorRow({ connector: c, isDefault, onChanged }: { connector: Connector; isDefault: boolean; onChanged: () => void }) {
  const [result, setResult] = useState<TestResult>();
  const [busy, setBusy] = useState(false);
  const provider = c.provider === 'openai_compatible' ? 'custom' : c.provider;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setResult(undefined);
    try {
      await action();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  const test = () => run(async () => setResult(await api.testConnector(c.id)));
  const makeDefault = () => run(() => api.setDefaultModel(c.id).then(onChanged));
  const remove = () => {
    if (!confirm(`Remove ${c.label}? ${provider === 'custom' ? '' : 'Its API key is deleted from this computer.'}`)) return;
    run(() => api.removeProvider(provider).then(onChanged));
  };

  return (
    <div className="card connector">
      <div className="connector-main">
        <div>
          <strong>{c.label}</strong> {isDefault && <span className="pill">Default</span>}
          <div className="muted small">
            {PROVIDER_NAMES[c.provider]} · <code>{c.model}</code>
            {c.baseUrl && <> · {new URL(c.baseUrl).host}</>}
            {!c.vision && <> · text only</>}
          </div>
        </div>
        <div className="row-actions">
          <button onClick={test} disabled={busy}>
            {busy ? '…' : 'Test'}
          </button>
          {!isDefault && (
            <button onClick={makeDefault} disabled={busy}>
              Make default
            </button>
          )}
          <button className="danger" onClick={remove} disabled={busy}>
            Remove
          </button>
        </div>
      </div>
      {result && <div className={result.ok ? 'notice' : 'error-box'}>{result.message}</div>}
    </div>
  );
}

/** Optional Groq key for fast, cheap transcription. */
function GroqKey({ saved, onChanged }: { saved: boolean; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(undefined);
    try {
      const res = await api.saveKey('groq', apiKey.trim());
      setResult(res);
      if (res.ok) {
        setApiKey('');
        onChanged();
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <p className="muted small">
        Groq key saved.{' '}
        <button className="link small" onClick={() => api.removeProvider('groq').then(onChanged)}>
          Remove
        </button>
      </p>
    );
  }
  return (
    <form className="card form groq" onSubmit={submit}>
      <div className="small">
        <strong>Optional: faster transcription.</strong>{' '}
        <span className="muted">
          Paste a free{' '}
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
            Groq key ↗
          </a>{' '}
          for quick, accurate transcripts with word timing.
        </span>
      </div>
      <div className="inline-form">
        <input type="password" autoComplete="off" placeholder="gsk_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button disabled={busy || !apiKey.trim()}>{busy ? 'Checking…' : 'Save'}</button>
      </div>
      {result && <div className={result.ok ? 'notice' : 'error-box'}>{result.message}</div>}
    </form>
  );
}
