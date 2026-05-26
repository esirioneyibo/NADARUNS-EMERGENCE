import { useEffect, useRef, useState, useCallback } from 'react';

const BASE_WS_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.replace('http', 'ws') || 'ws://localhost:8001';

interface LocationUpdate {
  type: 'location_update';
  driver_id: string;
  order_id: string;
  location: {
    lat: number;
    lng: number;
  };
  timestamp: string;
}

interface StatusUpdate {
  type: 'status_update';
  order_id: string;
  status: string;
  data: Record<string, any>;
  timestamp: string;
}

interface InitialState {
  type: 'initial_state';
  order_id: string;
  status: string;
  driver_location: { lat: number; lng: number } | null;
  timestamp: string;
}

type WebSocketMessage = LocationUpdate | StatusUpdate | InitialState | { type: 'ping' } | { type: 'pong' };

interface UseOrderTrackingOptions {
  orderId: string;
  onLocationUpdate?: (location: { lat: number; lng: number }, driverId: string) => void;
  onStatusUpdate?: (status: string, data: Record<string, any>) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  enabled?: boolean;
}

/**
 * Hook for real-time order tracking via WebSocket.
 * Used by shippers to track their deliveries.
 */
export function useOrderTracking({
  orderId,
  onLocationUpdate,
  onStatusUpdate,
  onConnected,
  onDisconnected,
  enabled = true,
}: UseOrderTrackingOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !orderId) return;
    
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `${BASE_WS_URL}/ws/track/${orderId}`;
    console.log('[WS] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected to order tracking');
      setIsConnected(true);
      onConnected?.();
      
      // Start ping interval to keep connection alive
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'location_update':
            const locUpdate = message as LocationUpdate;
            setDriverLocation(locUpdate.location);
            onLocationUpdate?.(locUpdate.location, locUpdate.driver_id);
            break;
            
          case 'status_update':
            const statusUpdate = message as StatusUpdate;
            setOrderStatus(statusUpdate.status);
            onStatusUpdate?.(statusUpdate.status, statusUpdate.data);
            break;
            
          case 'initial_state':
            const initial = message as InitialState;
            if (initial.driver_location) {
              setDriverLocation(initial.driver_location);
            }
            setOrderStatus(initial.status);
            break;
            
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (e) {
        // Handle plain text messages (like "pong")
        if (event.data === 'pong') {
          // Connection is alive
        }
      }
    };

    ws.onerror = (error) => {
      console.log('[WS] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setIsConnected(false);
      onDisconnected?.();
      
      // Clear ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      
      // Attempt to reconnect after 5 seconds
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WS] Attempting to reconnect...');
          connect();
        }, 5000);
      }
    };
  }, [orderId, enabled, onLocationUpdate, onStatusUpdate, onConnected, onDisconnected]);

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
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connect]);

  return {
    isConnected,
    driverLocation,
    orderStatus,
  };
}

interface UseDriverLocationOptions {
  driverId: string;
  orderId?: string;
  enabled?: boolean;
}

/**
 * Hook for drivers to send their location updates via WebSocket.
 */
export function useDriverLocation({
  driverId,
  orderId,
  enabled = true,
}: UseDriverLocationOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (!enabled || !driverId) return;
    
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `${BASE_WS_URL}/ws/driver/${driverId}`;
    console.log('[WS Driver] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS Driver] Connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'pong') {
          // Connection alive
        }
      } catch (e) {
        // Handle plain text
      }
    };

    ws.onerror = (error) => {
      console.log('[WS Driver] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS Driver] Disconnected');
      setIsConnected(false);
      
      // Reconnect after 5 seconds
      if (enabled) {
        setTimeout(connect, 5000);
      }
    };
  }, [driverId, enabled]);

  useEffect(() => {
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendLocation = useCallback((location: { lat: number; lng: number }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'location_update',
        location,
        order_id: orderId,
      }));
    }
  }, [orderId]);

  return {
    isConnected,
    sendLocation,
  };
}

export default { useOrderTracking, useDriverLocation };
