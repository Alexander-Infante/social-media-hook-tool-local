import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';

/** The Terms of Use / EULA. As a gate, it must be accepted once before the app can be used. */
export function Terms({ gate, onAccepted }: { gate?: boolean; onAccepted?: () => void }) {
  const [terms, setTerms] = useState<{ version: string; text: string }>();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.terms().then(setTerms, (err) => setError(err.message));
  }, []);

  async function accept() {
    if (!terms) return;
    try {
      await api.acceptTerms(terms.version);
      onAccepted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  const body = (
    <div className="markdown terms-text">{terms ? <Markdown remarkPlugins={[remarkGfm]}>{terms.text}</Markdown> : <p className="muted">Loading…</p>}</div>
  );

  if (!gate) return <div className="page">{body}</div>;

  return (
    <div className="center-screen">
      <div className="auth-card terms-card">
        <div className="brand">
          <span className="brand-mark">🪝</span> HookLab
        </div>
        <p className="muted small">Before you start, please read and accept the terms.</p>
        {error && <div className="error-box">{error}</div>}
        {body}
        <label className="checkbox">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I have read and agree to the Terms of Use and
          License Agreement.
        </label>
        <button className="primary" disabled={!agreed || !terms} onClick={accept}>
          Agree and continue
        </button>
      </div>
    </div>
  );
}
