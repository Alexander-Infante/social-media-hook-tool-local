import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ChatView } from './components/ChatView';
import { ModelSetup } from './components/ModelSetup';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Terms } from './components/Terms';
import type { Chat, Status } from './types';

export type Route = { page: 'chat'; chatId?: string } | { page: 'settings' } | { page: 'terms' };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'settings') return { page: 'settings' };
  if (hash === 'terms') return { page: 'terms' };
  const m = /^c\/([a-f0-9]{16})$/.exec(hash);
  return { page: 'chat', chatId: m?.[1] };
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};

export function App() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();

  const refreshStatus = useCallback(
    () =>
      api
        .status()
        .then(setStatus)
        .catch((err) => setError(err.message)),
    [],
  );
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  if (error) return <div className="center-screen error-text">Couldn't reach the HookLab server: {error}</div>;
  if (!status) return <div className="center-screen muted">Loading…</div>;
  if (!status.termsAccepted) return <Terms gate onAccepted={refreshStatus} />;
  if (status.connectors.length === 0) return <FirstRunSetup onDone={refreshStatus} />;
  return <Shell status={status} onStatusChanged={refreshStatus} />;
}

function FirstRunSetup({ onDone }: { onDone: () => void }) {
  return (
    <div className="center-screen">
      <div className="auth-card setup-card">
        <div className="brand">
          <span className="brand-mark">🪝</span> HookLab
        </div>
        <h1>Connect an AI model</h1>
        <p className="muted small">
          HookLab sends each video's frames and transcript to an AI model you choose. Pick one to get started; you can add more later in
          Settings.
        </p>
        <ModelSetup onDone={onDone} />
      </div>
    </div>
  );
}

function Shell({ status, onStatusChanged }: { status: Status; onStatusChanged: () => void }) {
  const [route, setRoute] = useState<Route>(parseHash);
  const [chats, setChats] = useState<Chat[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshChats = useCallback(() => api.listChats().then((r) => setChats(r.chats)), []);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      setSidebarOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    refreshChats();
    return () => window.removeEventListener('hashchange', onHash);
  }, [refreshChats]);

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar route={route} chats={chats} onChatsChanged={refreshChats} />
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          ☰
        </button>
        {route.page === 'settings' ? (
          <Settings status={status} onChanged={onStatusChanged} />
        ) : route.page === 'terms' ? (
          <Terms />
        ) : (
          <ChatView key={route.chatId ?? 'new'} chatId={route.chatId} status={status} onChatsChanged={refreshChats} />
        )}
      </main>
    </div>
  );
}
