import { api } from '../api';
import { navigate, type Route } from '../App';
import type { Chat } from '../types';

interface Props {
  route: Route;
  chats: Chat[];
  onChatsChanged: () => void;
}

export function Sidebar({ route, chats, onChatsChanged }: Props) {
  const activeChat = route.page === 'chat' ? route.chatId : undefined;

  async function remove(chat: Chat) {
    if (!confirm(`Delete “${chat.title}” and the videos in it?`)) return;
    await api.deleteChat(chat.id);
    if (activeChat === chat.id) navigate('/');
    onChatsChanged();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">🪝</span> HookLab
      </div>
      <button className="primary new-chat" onClick={() => navigate('/')}>
        + New analysis
      </button>

      <nav className="chat-list">
        {chats.length === 0 && <p className="muted small pad">Your analyses will show up here.</p>}
        {chats.map((chat) => (
          <div key={chat.id} className={`chat-item ${chat.id === activeChat ? 'active' : ''}`}>
            <a href={`#/c/${chat.id}`} title={chat.title}>
              {chat.title}
            </a>
            <button className="icon-button" onClick={() => remove(chat)} aria-label="Delete chat" title="Delete">
              ×
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <a href="#/settings" className={`nav-link ${route.page === 'settings' ? 'active' : ''}`}>
          ⚙️ Settings
        </a>
        <a href="#/terms" className={`nav-link ${route.page === 'terms' ? 'active' : ''}`}>
          📄 Terms
        </a>
        <p className="tiny muted pad">Running locally. Your keys stay on this computer.</p>
      </div>
    </aside>
  );
}
