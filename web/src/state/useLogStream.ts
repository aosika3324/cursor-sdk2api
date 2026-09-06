import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Structural subset of the DOM EventSource we depend on. Declaring our own
 * interface keeps the hooks testable (jsdom ships no EventSource) and SSR-safe
 * (we never touch the global unless it exists).
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** One entry off the log stream. Backend shape is `{ level, msg, at, ... }`. */
export interface LogEntry {
  level: string;
  msg: string;
  at: number;
  [key: string]: unknown;
}

/** Client-side bound so a runaway stream can never exhaust the tab's memory. */
const MAX_LOG_ENTRIES = 500;

function defaultFactory(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}

/**
 * Subscribes to the SSE log stream while `enabled`, accumulating "log" events
 * into a bounded array. The EventSource is closed on unmount or whenever the
 * stream is disabled, so there is never a dangling connection. `factory` is
 * injectable purely for tests; production uses the global EventSource.
 */
export function useLogStream(
  enabled: boolean,
  factory?: EventSourceFactory,
): { entries: LogEntry[]; clear: () => void } {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const clear = useCallback(() => setEntries([]), []);

  useEffect(() => {
    if (!enabled) return;
    const make = factoryRef.current
      ?? (typeof EventSource === "undefined" ? undefined : defaultFactory);
    if (!make) return;

    const source = make("/v0/management/logs/stream");
    source.addEventListener("log", (event) => {
      let parsed: LogEntry;
      try {
        parsed = JSON.parse(event.data) as LogEntry;
      } catch {
        return;
      }
      setEntries((prev) => {
        const next = prev.length >= MAX_LOG_ENTRIES ? prev.slice(prev.length - MAX_LOG_ENTRIES + 1) : prev;
        return [...next, parsed];
      });
    });
    // EventSource auto-reconnects on transport errors; just don't crash.
    source.onerror = () => {};

    return () => source.close();
  }, [enabled]);

  return { entries, clear };
}
