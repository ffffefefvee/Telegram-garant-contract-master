import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { dealsApi } from '../api';
import { useWebSocket, createWebSocketUrl } from '../hooks/useWebSocket';
import { EmptyState, Skeleton, useToast } from './ui';
import './ChatWindow.css';

interface Message {
  id: string;
  content: string;
  senderId: string;
  type: 'text' | 'system';
  createdAt: string;
}

interface ChatWindowProps {
  dealId: string;
  otherUser: {
    id: string;
    name: string;
    avatar?: string;
  };
  systemMessages?: string[];
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ dealId, otherUser, systemMessages = [] }) => {
  const { user } = useAppStore();
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const wsUrl = createWebSocketUrl(
    import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001',
    dealId,
    localStorage.getItem('auth_token') || '',
  );

  useWebSocket({
    url: wsUrl,
    onMessage: (msg) => {
      if (msg.type === 'message') {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === msg.payload.id);
          if (exists) return prev;
          return [...prev, msg.payload];
        });
      }
    },
  });

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dealsApi.getMessages(dealId);
      setMessages(data);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !user || sending) return;

    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      content: text,
      senderId: user.id,
      type: 'text',
      createdAt: new Date().toISOString(),
    };

    setInput('');
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    try {
      const saved = await dealsApi.sendMessage(dealId, text);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? saved : m)),
      );
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
      showToast('Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const isOwnMessage = (senderId: string) => senderId === user?.id;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-avatar">
          {otherUser.avatar ? (
            <img src={otherUser.avatar} alt={otherUser.name} />
          ) : (
            <span>{otherUser.name[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="chat-header-info">
          <span className="chat-header-name">{otherUser.name}</span>
          <span className="chat-header-status">Переписка по сделке</span>
        </div>
      </div>

      <div className="chat-messages">
        {loading ? (
          <div className="chat-loading">
            <Skeleton height={48} />
            <Skeleton height={48} width="70%" />
            <Skeleton height={48} width="60%" />
          </div>
        ) : messages.length === 0 && systemMessages.length === 0 ? (
          <EmptyState
            title="Начните переписку"
            description="Напишите контрагенту, чтобы уточнить детали сделки"
          />
        ) : (
          <>
            {systemMessages.map((text, i) => (
              <div key={`sys-${i}`} className="chat-message chat-message--system">
                <div className="chat-message-content chat-message-content--system">
                  {text}
                </div>
              </div>
            ))}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-message ${msg.type === 'system' ? 'chat-message--system' : isOwnMessage(msg.senderId) ? 'own' : 'other'}`}
              >
                <div
                  className={`chat-message-content ${msg.type === 'system' ? 'chat-message-content--system' : ''}`}
                >
                  {msg.content}
                  {msg.type !== 'system' && (
                    <span className="chat-message-time">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите сообщение…"
          disabled={sending}
        />
        <button type="button" onClick={() => void handleSend()} disabled={!input.trim() || sending} aria-label="Отправить">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};
