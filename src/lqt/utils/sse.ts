/**
 * React hook around `EventSource` for the LQT gateway's three SSE
 * streams (`/api/audit/tail`, `/api/ops/replicator-lag`,
 * `/api/md/bbo`).
 *
 * Design choices (documented in T-UI-003):
 *
 *  1. `EventSource` does not support custom headers natively. We
 *     append the scoped session-bearer JWT as a `?token=<jwt>` query
 *     param — the gateway accepts both `Authorization: Bearer` and
 *     `?token=` for SSE endpoints. The token leaks into the URL bar
 *     and server access logs, but: it's 10-min TTL + scoped
 *     `aud=lqt`, so the blast radius is bounded. The cleaner
 *     alternative (an `eventsource` polyfill that supports headers)
 *     is an explicit follow-up.
 *
 *  2. Auto-reconnect with capped exponential backoff (250ms →
 *     8s; mirrors T-OMS-014's gRPC reconnect shape). On the next
 *     connect, we send `Last-Event-ID` as a query param too
 *     (`?last_event_id=…`) since the native `EventSource` only
 *     forwards it via header.
 *
 *  3. Watchdog: if we don't see ANY event (data or comment heartbeat)
 *     for 30s, we tear down and reconnect. The gateway's harness
 *     emits a 4Hz comment heartbeat, so 30s of silence means the
 *     connection is dead in some intermediate reverse proxy.
 *
 *  4. Fallback: when `EventSource` errors out before ever delivering
 *     a frame, we drop to 4Hz polling. The caller passes a
 *     `pollFallback` callback that hits the matching GET endpoint
 *     instead. (Implemented as a hook, but the polling fallback is
 *     opt-in — see options below.)
 */

import { useEffect, useRef, useState } from 'react';

import { getJson, lqtGatewayBaseUrl } from './axios';

export type SseStatus =
  | 'connecting'
  | 'open'
  | 'closed'
  | 'reconnecting'
  | 'fallback_polling'
  | 'error';

export interface UseLqtSseOptions<T> {
  /**
   * Maximum number of events to keep in the `events` buffer. The
   * hook is a rolling window — older frames are dropped to keep
   * React renders cheap. Defaults to 200.
   */
  bufferSize?: number;
  /**
   * Disable auto-reconnect. Used by tests + components that want to
   * own the reconnect lifecycle. Defaults to false.
   */
  noAutoReconnect?: boolean;
  /**
   * If set, the hook will poll this path (via `getJson`) at 4Hz
   * when SSE fails outright. Polling is engaged after the first
   * three reconnect attempts fail. Designed for environments where
   * SSE is broken end-to-end (some corporate proxies).
   */
  pollFallback?: { path: string; params?: Record<string, unknown> } | null;
  /**
   * Parser for the SSE `data` field. Defaults to `JSON.parse`.
   * Custom parsers can reject malformed frames by throwing.
   */
  parse?: (raw: string) => T;
}

export interface UseLqtSseReturn<T> {
  events: T[];
  status: SseStatus;
  error: Error | null;
  /** Manually trigger a reconnect (clears backoff). */
  reconnect: () => void;
  /** Latest Last-Event-ID seen on the stream. */
  lastEventId: string | null;
}

const RECONNECT_INITIAL_MS = 250;
const RECONNECT_MAX_MS = 8_000;
const WATCHDOG_TIMEOUT_MS = 30_000;
const FALLBACK_POLL_INTERVAL_MS = 250;
const FALLBACK_ATTEMPT_THRESHOLD = 3;

/**
 * Pull the scoped bearer through the `lqtAxios` cache and embed it
 * in the SSE URL. We can't share the axios instance directly because
 * `EventSource` is a separate browser primitive.
 */
async function fetchBearerForSse(): Promise<string> {
  // Trigger the axios cache to ensure we have a fresh token, then
  // pull the raw cookie-authenticated mint to read the token value.
  // Slightly duplicates `axios.ts` to avoid exporting the bearer
  // (which is normally hidden behind the interceptor).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax = (await import('axios')).default;
  const res = await ax.get<{ token: string }>('/api/v1/session-bearer', {
    withCredentials: true,
    params: { aud: 'lqt' },
    baseURL: '',
  });
  return res.data.token;
}

export function useLqtSse<T = unknown>(
  path: string | null,
  options: UseLqtSseOptions<T> = {},
): UseLqtSseReturn<T> {
  const {
    bufferSize = 200,
    noAutoReconnect = false,
    pollFallback = null,
    parse = (raw: string) => JSON.parse(raw) as T,
  } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<Error | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  // Stable refs for everything mutable so callbacks don't churn.
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef<number>(RECONNECT_INITIAL_MS);
  const attemptRef = useRef<number>(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const cancelledRef = useRef<boolean>(false);

  function clearAllTimers() {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (fallbackIntervalRef.current) clearInterval(fallbackIntervalRef.current);
    watchdogRef.current = null;
    reconnectTimerRef.current = null;
    fallbackIntervalRef.current = null;
  }

  function teardown() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    clearAllTimers();
  }

  function pumpWatchdog() {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      // No frames for 30s; treat as dead.
      // eslint-disable-next-line no-console
      console.warn('[lqt-sse] watchdog timeout; reconnecting', { path });
      reconnectWithBackoff();
    }, WATCHDOG_TIMEOUT_MS);
  }

  function startFallbackPolling() {
    if (!pollFallback || fallbackIntervalRef.current) return;
    setStatus('fallback_polling');
    fallbackIntervalRef.current = setInterval(async () => {
      try {
        const data = await getJson<T>(pollFallback.path, pollFallback.params);
        setEvents((prev) => {
          const next = [...prev, data];
          return next.length > bufferSize ? next.slice(-bufferSize) : next;
        });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    }, FALLBACK_POLL_INTERVAL_MS);
  }

  async function connect() {
    if (cancelledRef.current || path == null) return;
    setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
    setError(null);

    let token: string;
    try {
      token = await fetchBearerForSse();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      reconnectWithBackoff();
      return;
    }
    if (cancelledRef.current) return;

    const params = new URLSearchParams();
    params.set('token', token);
    if (lastEventIdRef.current != null) {
      params.set('last_event_id', lastEventIdRef.current);
    }
    const url = `${lqtGatewayBaseUrl()}${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus('open');
      backoffRef.current = RECONNECT_INITIAL_MS;
      attemptRef.current = 0;
      pumpWatchdog();
    };

    es.onmessage = (ev) => {
      if (ev.lastEventId) {
        lastEventIdRef.current = ev.lastEventId;
        setLastEventId(ev.lastEventId);
      }
      pumpWatchdog();
      try {
        const parsed = parse(ev.data);
        setEvents((prev) => {
          const next = [...prev, parsed];
          return next.length > bufferSize ? next.slice(-bufferSize) : next;
        });
      } catch (e) {
        // Malformed frame — log + drop, don't tear down the stream.
        // eslint-disable-next-line no-console
        console.warn('[lqt-sse] parse error; dropping frame', e);
      }
    };

    es.onerror = (ev) => {
      // eslint-disable-next-line no-console
      console.warn('[lqt-sse] error event; tearing down', { path, ev });
      reconnectWithBackoff();
    };
  }

  function reconnectWithBackoff() {
    if (cancelledRef.current || noAutoReconnect) {
      teardown();
      setStatus('closed');
      return;
    }
    teardown();
    attemptRef.current += 1;
    if (
      pollFallback &&
      attemptRef.current >= FALLBACK_ATTEMPT_THRESHOLD &&
      !fallbackIntervalRef.current
    ) {
      startFallbackPolling();
      return;
    }
    setStatus('reconnecting');
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
    reconnectTimerRef.current = setTimeout(() => {
      void connect();
    }, delay);
  }

  function reconnect() {
    backoffRef.current = RECONNECT_INITIAL_MS;
    attemptRef.current = 0;
    teardown();
    void connect();
  }

  useEffect(() => {
    cancelledRef.current = false;
    if (path != null) {
      void connect();
    } else {
      setStatus('closed');
    }
    return () => {
      cancelledRef.current = true;
      teardown();
      setStatus('closed');
    };
    // We intentionally re-run the effect only when `path` changes;
    // option changes are read via closure but don't trigger reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return { events, status, error, reconnect, lastEventId };
}
