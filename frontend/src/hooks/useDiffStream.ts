import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffMetadata } from 'shared/types';

interface UseDiffStreamResult {
  diffs: DiffMetadata[];
  isComplete: boolean;
  error: string | null;
}

type DiffMetadataWsMessage =
  | {
      type: 'snapshot';
      entries: Record<string, DiffMetadata>;
    }
  | {
      type: 'upsert';
      path: string;
      diff: DiffMetadata;
    }
  | {
      type: 'remove';
      path: string;
    };

function diffMetadataEqual(a: DiffMetadata, b: DiffMetadata): boolean {
  return (
    a.change === b.change &&
    a.oldPath === b.oldPath &&
    a.newPath === b.newPath &&
    a.contentOmitted === b.contentOmitted &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  );
}

function entryMapEqual(
  a: Record<string, DiffMetadata>,
  b: Record<string, DiffMetadata>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const aValue = a[key];
    const bValue = b[key];
    if (!bValue || !diffMetadataEqual(aValue, bValue)) {
      return false;
    }
  }
  return true;
}

export const useDiffStream = (
  attemptId: string | null,
  enabled: boolean
): UseDiffStreamResult => {
  const [entries, setEntries] = useState<Record<string, DiffMetadata>>({});
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptsRef = useRef<number>(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const streamKey = enabled && attemptId ? attemptId : null;

  useEffect(() => {
    setEntries({});
    setIsFinished(false);
    setError(null);
    retryAttemptsRef.current = 0;
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [streamKey]);

  useEffect(() => {
    if (!streamKey) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptsRef.current = 0;
      return;
    }

    const httpEndpoint = `/api/task-attempts/${streamKey}/diff-metadata-ws`;
    const wsEndpoint = httpEndpoint.startsWith('http')
      ? httpEndpoint.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${
          window.location.host
        }${httpEndpoint}`;
    const ws = new WebSocket(wsEndpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      setError(null);
      retryAttemptsRef.current = 0;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: DiffMetadataWsMessage = JSON.parse(event.data);
        if (msg.type === 'snapshot') {
          setEntries((prev) =>
            entryMapEqual(prev, msg.entries) ? prev : msg.entries
          );
          setIsFinished(true);
          return;
        }
        if (msg.type === 'upsert') {
          setEntries((prev) => {
            const existing = prev[msg.path];
            if (existing && diffMetadataEqual(existing, msg.diff)) {
              return prev;
            }
            return {
              ...prev,
              [msg.path]: msg.diff,
            };
          });
          return;
        }
        if (msg.type === 'remove') {
          setEntries((prev) => {
            if (!(msg.path in prev)) return prev;
            const next = { ...prev };
            delete next[msg.path];
            return next;
          });
          return;
        }
      } catch (err) {
        console.error('Failed to process diff metadata message:', err);
        setError('Failed to process stream update');
      }
    };

    ws.onerror = () => {
      setError('Connection failed');
    };

    ws.onclose = () => {
      wsRef.current = null;
      retryAttemptsRef.current += 1;
      const delay = Math.min(
        8000,
        1000 * Math.pow(2, retryAttemptsRef.current)
      );
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setRetryNonce((n) => n + 1);
      }, delay);
    };

    return () => {
      if (wsRef.current) {
        const socket = wsRef.current;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [streamKey, retryNonce]);

  const diffs = useMemo(() => {
    return Object.values(entries);
  }, [entries]);

  return { diffs, isComplete: isFinished, error };
};
