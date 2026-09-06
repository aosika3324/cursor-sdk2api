import { useCallback, useEffect, useRef, useState } from "react";
import type { EventSourceFactory, EventSourceLike } from "./useLogStream";

/** One request-activity row off the SSE stream. */
export interface ActivityEntry {
  account: string;
  at: number;
  clientIp: string;
  model: string;
  status: number;
  credentialId?: string;
  durationMs?: number;
  /**
   * Stable client-side identity, assigned on ingest. Selection and export key
   * off this so they track the actual row, not its position in a filtered list.
   */
  clientId: number;
  [key: string]: unknown;
}

/** Client-side bound mirroring the log buffer so the tab can't grow unbounded. */
const MAX_ACTIVITY_ENTRIES = 500;

function defaultFactory(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}

/**
 * Subscribes to the SSE activity stream while `enabled`, accumulating
 * "activity" events into a bounded array. Mirrors useLogStream: closes the
 * EventSource on unmount / disable, tolerates malformed data and onerror,
 * and takes an injectable factory for testing.
 */
export function useActivityStream(
  enabled: boolean,
  factory?: EventSourceFactory,
): { entries: ActivityEntry[]; clear: () => void } {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const clear = useCallback(() => setEntries([]), []);
  const nextId = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const make = factoryRef.current
      ?? (typeof EventSource === "undefined" ? undefined : defaultFactory);
    if (!make) return;

    const source = make("/v0/management/activity/stream");
    source.addEventListener("activity", (event) => {
      let parsed: ActivityEntry;
      try {
        parsed = JSON.parse(event.data) as ActivityEntry;
      } catch {
        return;
      }
      const entry = { ...parsed, clientId: nextId.current++ };
      setEntries((prev) => {
        const next =
          prev.length >= MAX_ACTIVITY_ENTRIES ? prev.slice(prev.length - MAX_ACTIVITY_ENTRIES + 1) : prev;
        return [...next, entry];
      });
    });
    source.onerror = () => {};

    return () => source.close();
  }, [enabled]);

  return { entries, clear };
}
