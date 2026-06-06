import { useEffect, useRef, useCallback } from 'react';

export interface WebSocketMessage {
  type: 'message' | 'deal_update' | 'payment' | 'status_change';
  payload: any;
  timestamp: number;
}

export interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    url,
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        reconnectAttemptsRef.current = 0;
        onOpen?.();
      };

      wsRef.current.onclose = () => {
        onClose?.();
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current.onerror = (error) => {
        onError?.(error);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          onMessage?.(data);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };
    } catch (e) {
      console.error('WebSocket connection error:', e);
    }
  }, [url, onMessage, onOpen, onClose, onError, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { send, disconnect, connect };
}

export function createWebSocketUrl(baseUrl: string, dealId: string, token: string): string {
  // Use page protocol to decide ws vs wss (avoids Mixed Content in Telegram HTTPS WebView)
  const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const wsUrl = isSecurePage
    ? baseUrl.replace(/^https?/, 'wss')
    : baseUrl.replace(/^http/, 'ws');
  return `${wsUrl}/deals/${dealId}/ws?token=${encodeURIComponent(token)}`;
}