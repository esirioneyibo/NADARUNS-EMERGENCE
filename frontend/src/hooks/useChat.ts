import { useEffect, useRef, useState, useCallback } from 'react';

const BASE_WS_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.replace('http', 'ws') || 'ws://localhost:8001';

export interface ChatMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_type: 'driver' | 'shipper' | 'customer';
  sender_name: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface UseChatOptions {
  orderId: string;
  userId: string;
  userType: 'driver' | 'shipper' | 'customer';
  userName: string;
  onNewMessage?: (message: ChatMessage) => void;
  enabled?: boolean;
}

/**
 * Hook for real-time chat via WebSocket
 */
export function useChat({
  orderId,
  userId,
  userType,
  userName,
  onNewMessage,
  enabled = true,
}: UseChatOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !orderId || !userId) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `${BASE_WS_URL}/ws/chat/${orderId}?user_id=${userId}&user_type=${userType}&user_name=${encodeURIComponent(userName)}`;
    console.log('[Chat] Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Chat] Connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'chat_history') {
          setMessages(data.messages || []);
          const unread = (data.messages || []).filter(
            (m: ChatMessage) => !m.read && m.sender_id !== userId
          ).length;
          setUnreadCount(unread);
        } else if (data.type === 'new_message') {
          const message = data.message as ChatMessage;
          setMessages((prev) => [...prev, message]);
          if (message.sender_id !== userId) {
            setUnreadCount((prev) => prev + 1);
            onNewMessage?.(message);
          }
        } else if (data.type === 'messages_read') {
          setMessages((prev) =>
            prev.map((m) =>
              data.message_ids.includes(m.id) ? { ...m, read: true } : m
            )
          );
        } else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        console.warn('[Chat] Parse error:', e);
      }
    };

    ws.onerror = (error) => {
      console.log('[Chat] Error:', error);
    };

    ws.onclose = () => {
      console.log('[Chat] Disconnected');
      setIsConnected(false);

      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[Chat] Attempting to reconnect...');
          connect();
        }, 5000);
      }
    };
  }, [orderId, userId, userType, userName, enabled, onNewMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && text.trim()) {
        wsRef.current.send(
          JSON.stringify({
            type: 'send_message',
            message: text.trim(),
          })
        );
      }
    },
    []
  );

  const markAsRead = useCallback((messageIds: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'mark_read',
          message_ids: messageIds,
        })
      );
      setUnreadCount(0);
    }
  }, []);

  return {
    isConnected,
    messages,
    unreadCount,
    sendMessage,
    markAsRead,
  };
}

export default { useChat };
