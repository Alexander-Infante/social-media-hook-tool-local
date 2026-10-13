import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { OllamaStatus, TestResult } from '../types';

type Choice = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'custom';

const CHOICES: { id: Choice; icon: string; name: string; tagline: string }[] = [
  { id: 'anthropic', icon: '✳️', name: 'Claude', tagline: 'Recommended. Pay per use.' },
  { id: 'openai', icon: '🤖', name: 'OpenAI', tagline: 'Pay per use. Also transcribes.' },
  { id: 'gemini', icon: '✨', name: 'Gemini', tagline: 'Has a free tier.' },
  { id: 'ollama', icon: '💻', name: 'Free & private', tagline: 'Runs on this computer.' },
  { id: 'custom', icon: '🔌', name: 'Other', tagline: 'OpenRouter, LM Studio…' },
];

const KEY_INFO = {
  anthropic: { company: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', site: 'console.anthropic.com', placeholder: 'sk-ant-…' },
  openai: { company: 'OpenAI', url: 'https://platform.openai.com/api-keys', site: 'platform.openai.com', placeholder: 'sk-…' },
  gemini: { company: 'Google', url: 'https://aistudio.google.com/apikey', site: 'aistudio.google.com', placeholder: 'AIza…' },
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

/** Pick and connect an AI model. Used as the first-run screen and on the Settings page. */
export function ModelSetup({ onDone }: { onDone: () => void }) {
  const [choice, setChoice] = useState<Choice>('anthropic');
  return (
    <div className="model-setup">
      <div className="choice-grid" role="radiogroup" aria-label="AI model">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={choice === c.id}
            className={`choice ${choice === c.id ? 'selected' : ''}`}
            onClick={() => setChoice(c.id)}
          >
            <span className="choice-icon">{c.icon}</span>
            <strong>{c.name}</strong>
            <span className="muted tiny">{c.tagline}</span>
          </button>
        ))}
      </div>
      <div className="setup-panel">
        {choice === 'ollama' ? <OllamaSetup onDone={onDone} /> : choice === 'custom' ? <CustomSetup onDone={onDone} /> : <KeySetup key={choice} provider={choice} onDone={onDone} />}
      </div>
    </div>
  );
}

function Result({ result }: { result?: TestResult }) {
  if (!result) return null;
  return <div className={result.ok ? 'notice' : 'error-box'}>{result.message}</div>;
}

/** Runs a save call, shows its result, and calls onDone after a short pause on success. */
function useSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult>();
  async function save(call: () => Promise<TestResult>) {
    setBusy(true);
    setResult(undefined);
    try {
      const res = await call();
      setResult(res);
      if (res.ok) setTimeout(onDone, 900);
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, save };
}

function KeySetup({ provider, onDone }: { provider: keyof typeof KEY_INFO; onDone: () => void }) {
  const info = KEY_INFO[provider];
  const [apiKey, setApiKey] = useState('');
  const { busy, result, save } = useSave(onDone);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (apiKey.trim()) save(() => api.saveKey(provider, apiKey.trim()));
  }

  return (
    <form className="form" onSubmit={submit}>
      <ol className="steps">
        <li>
          Go to{' '}
          <a href={info.url} target="_blank" rel="noreferrer">
            {info.site} ↗
          </a>
          , sign in and create an API key.
        </li>
        <li>
          <label>
            Paste it here
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
            />
          </label>
        </li>
      </ol>
      <Result result={result} />
      <button className="primary" disabled={busy || !apiKey.trim()}>
        {busy ? 'Checking your key…' : 'Connect'}
      </button>
      <p className="muted tiny">
        Your key is saved only on this computer, in <code>data/settings.json</code>. Usage is billed by {info.company} to your account, so
        consider setting a spending limit there.
      </p>
    </form>
  );
}

function OllamaSetup({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<OllamaStatus>();
  const [selected, setSelected] = useState('');
  const [otherModel, setOtherModel] = useState('');
  const [pullError, setPullError] = useState<string>();
  const startedPull = useRef<string | undefined>(undefined);
  const { busy, result, save } = useSave(onDone);

  // Keep checking, so the screen updates by itself when Ollama is opened or a download progresses.
  useEffect(() => {
    let alive = true;
    const check = () =>
      api.ollama().then(
        (s) => alive && setStatus(s),
        () => {},
      );
    check();
    const timer = setInterval(check, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const models = status?.models ?? [];
  useEffect(() => {
    if (!selected && models.length) setSelected((models.find((m) => m.vision) ?? models[0]).name);
  }, [models, selected]);

  // When a download started here finishes, use that model straight away.
  const pull = status?.pull;
  useEffect(() => {
    if (pull?.done && pull.model === startedPull.current && models.some((m) => m.name === pull.model)) {
      startedPull.current = undefined;
      save(() => api.useOllamaModel(pull.model));
    }
  }, [pull, models, save]);

  async function download(model: string) {
    setPullError(undefined);
    try {
      startedPull.current = model;
      await api.pullOllamaModel(model);
      setStatus(await api.ollama());
    } catch (err) {
      startedPull.current = undefined;
      setPullError(errorMessage(err));
    }
  }

  if (!status) return <p className="muted">Looking for Ollama on this computer…</p>;

  if (!status.running) {
    return (
      <div className="form">
        <p className="muted small">
          Ollama is a free app that runs AI models on your own computer. Nothing you analyze leaves your machine, and there's nothing to pay.
        </p>
        <ol className="steps">
          <li>
            <a className="button-link primary" href="https://ollama.com/download" target="_blank" rel="noreferrer">
              Download Ollama ↗
            </a>
          </li>
          <li>Install it and open it. This screen notices automatically.</li>
        </ol>
        <p className="muted tiny">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>{' '}
          Waiting for Ollama… Works best on a computer with 16 GB of memory. Local models are slower and less sharp than Claude or OpenAI.
        </p>
      </div>
    );
  }

  const pulling = pull && !pull.done && !pull.error ? pull : undefined;
  const hasRecommended = models.some((m) => m.name === status.recommended.name);
  const selectedModel = models.find((m) => m.name === selected);

  return (
    <div className="form">
      <div className="notice">✅ Ollama is running.</div>

      {models.length > 0 && (
        <>
          <label>
            Use a model you already have
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.sizeGb} GB){m.vision === false ? ', text only' : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedModel?.vision === false && (
            <p className="muted tiny">This model can't see images, so HookLab will analyze the transcript and captions only.</p>
          )}
          <button className="primary" disabled={busy || !selected || !!pulling} onClick={() => save(() => api.useOllamaModel(selected))}>
            {busy ? 'Connecting…' : 'Use this model'}
          </button>
        </>
      )}

      {pulling ? (
        <div className="card">
          <div className="small">
            Downloading <strong>{pulling.model}</strong>: {pulling.status}
            {pulling.percent !== undefined && ` ${pulling.percent}%`}
          </div>
          <div className="progress">
            <div style={{ width: `${pulling.percent ?? 0}%` }} />
          </div>
          <p className="muted tiny">You can keep this page open. HookLab connects it as soon as it finishes.</p>
        </div>
      ) : (
        <>
          {!hasRecommended && (
            <div className="card">
              <strong>{models.length ? 'Or download our pick' : 'Download a model to get started'}</strong>
              <p className="muted small">
                <code>{status.recommended.name}</code> ({status.recommended.size}) is small enough for most laptops and can see video frames.
              </p>
              <button className="primary" onClick={() => download(status.recommended.name)}>
                Download {status.recommended.name}
              </button>
            </div>
          )}
          <details className="small">
            <summary className="muted">Download a different model</summary>
            <div className="inline-form">
              <input placeholder="e.g. qwen2.5vl:7b" value={otherModel} onChange={(e) => setOtherModel(e.target.value)} />
              <button disabled={!otherModel.trim()} onClick={() => download(otherModel.trim())}>
                Download
              </button>
            </div>
            <p className="muted tiny">
              Browse models at{' '}
              <a href="https://ollama.com/search?c=vision" target="_blank" rel="noreferrer">
                ollama.com ↗
              </a>
              . Pick one tagged “vision” so it can see the video.
            </p>
          </details>
        </>
      )}
      {(pullError || pull?.error) && <div className="error-box">{pullError ?? pull?.error}</div>}
      <Result result={result} />
    </div>
  );
}

function CustomSetup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ baseUrl: '', model: '', apiKey: '', name: '', vision: true });
  const { busy, result, save } = useSave(onDone);
  const set = (key: keyof typeof form) => (e: { target: { value: string; checked?: boolean } }) =>
    setForm((f) => ({ ...f, [key]: key === 'vision' ? e.target.checked : e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    save(() =>
      api.saveCustom({
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey.trim() || undefined,
        name: form.name.trim() || undefined,
        vision: form.vision,
      }),
    );
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted small">Any service that speaks the OpenAI API: OpenRouter, Groq, xAI, Together, LM Studio and more.</p>
      <label>
        Server URL
        <input placeholder="https://openrouter.ai/api/v1" value={form.baseUrl} onChange={set('baseUrl')} required />
        <span className="hint">LM Studio: http://localhost:1234/v1</span>
      </label>
      <label>
        Model
        <input placeholder="e.g. google/gemini-2.5-flash" value={form.model} onChange={set('model')} required />
      </label>
      <label>
        API key <span className="hint">(leave empty for local servers)</span>
        <input type="password" autoComplete="off" value={form.apiKey} onChange={set('apiKey')} />
      </label>
      <label>
        Name to show <span className="hint">(optional)</span>
        <input placeholder="OpenRouter" value={form.name} onChange={set('name')} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={form.vision} onChange={set('vision')} />
        This model can read images
      </label>
      <Result result={result} />
      <button className="primary" disabled={busy || !form.baseUrl.trim() || !form.model.trim()}>
        {busy ? 'Testing…' : 'Connect'}
      </button>
    </form>
  );
}
