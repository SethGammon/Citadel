import { useState, useEffect, useRef } from 'react';

const MAX_EVENTS = 500;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface CitadelEvent {
  [key: string]: unknown;
}

interface UseEventsResult {
  events: CitadelEvent[];
  connected: boolean;
  wsPort: number | null;
}

export function useEvents(): UseEventsResult {
  const [events, setEvents] = useState<CitadelEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [wsPort, setWsPort] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portRef = useRef<number | null>(null);
  const connectedRef = useRef(false);

  // Fetch the WS port from main process
  useEffect(() => {
    void window.citadel.getWsPort().then((result: unknown) => {
      if (typeof result === 'number') {
        portRef.current = result;
        setWsPort(result);
      }
    });

    const cleanup = window.citadel.onWsPort((port: number) => {
      portRef.current = port;
      setWsPort(port);
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (!wsPort) return;

    function connect() {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const port = portRef.current;
      if (!port) return;

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        connectedRef.current = true;
        setConnected(true);
        backoffRef.current = BACKOFF_INITIAL_MS;
      });

      ws.addEventListener('message', (msg) => {
        try {
          const event = JSON.parse(msg.data as string) as CitadelEvent;
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        } catch {
          // Ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        connectedRef.current = false;
        setConnected(false);
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // close will fire after error — reconnect handled there
      });
    }

    function scheduleReconnect() {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(
          backoffRef.current * 2,
          BACKOFF_MAX_MS
        );
        connect();
      }, backoffRef.current);
    }

    connect();

    const handleVisibility = () => {
      if (!document.hidden && !connectedRef.current) connect();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsPort]);

  return { events, connected, wsPort };
}
