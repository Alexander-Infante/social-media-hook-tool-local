import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';

/** The Terms of Use / EULA, linked from the sidebar. */
export function Terms() {
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.terms().then((t) => setText(t.text), (err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      {error && <div className="error-box">{error}</div>}
      <div className="markdown">{text ? <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown> : !error && <p className="muted">Loading…</p>}</div>
    </div>
  );
}
