import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLogStream, type EventSourceLike } from "../useLogStream";
import { useActivityStream } from "../useActivityStream";

/**
 * Minimal EventSource stand-in. jsdom ships no EventSource, so the hooks accept
 * an optional factory; tests inject this fake and drive it with emit().
 */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: { data: string }) => void): void {
    (this.listeners[type] ||= []).push(listener);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners[type] ?? []) listener({ data });
  }

  close(): void {
    this.closed = true;
  }
}

function factory() {
  FakeEventSource.instances = [];
  return {
    make: (url: string) => new FakeEventSource(url),
    latest: (): FakeEventSource => {
      const source = FakeEventSource.instances[FakeEventSource.instances.length - 1];
      if (!source) throw new Error("no EventSource created");
      return source;
    },
    all: () => FakeEventSource.instances,
  };
}

describe("useLogStream", () => {
  it("accumulates emitted log events into a bounded array", () => {
    const es = factory();
    const { result } = renderHook(() => useLogStream(true, es.make));

    act(() => {
      es.latest().emit("log", JSON.stringify({ level: "info", msg: "boot", at: 1 }));
      es.latest().emit("log", JSON.stringify({ level: "warn", msg: "slow", at: 2 }));
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({ level: "info", msg: "boot" });
    expect(result.current.entries[1]).toMatchObject({ level: "warn", msg: "slow" });
  });

  it("opens the log stream endpoint", () => {
    const es = factory();
    renderHook(() => useLogStream(true, es.make));
    expect(es.latest().url).toContain("/v0/management/logs/stream");
  });

  it("ignores malformed JSON without crashing", () => {
    const es = factory();
    const { result } = renderHook(() => useLogStream(true, es.make));
    act(() => {
      es.latest().emit("log", "not json");
      es.latest().emit("log", JSON.stringify({ level: "info", msg: "ok", at: 3 }));
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({ msg: "ok" });
  });

  it("survives onerror (auto-reconnect) without throwing", () => {
    const es = factory();
    const { result } = renderHook(() => useLogStream(true, es.make));
    act(() => {
      es.latest().onerror?.(new Event("error"));
    });
    expect(result.current.entries).toHaveLength(0);
  });

  it("clears accumulated entries via clear()", () => {
    const es = factory();
    const { result } = renderHook(() => useLogStream(true, es.make));
    act(() => {
      es.latest().emit("log", JSON.stringify({ level: "info", msg: "a", at: 1 }));
    });
    expect(result.current.entries).toHaveLength(1);
    act(() => result.current.clear());
    expect(result.current.entries).toHaveLength(0);
  });

  it("closes the EventSource on unmount (no leak)", () => {
    const es = factory();
    const { unmount } = renderHook(() => useLogStream(true, es.make));
    const source = es.latest();
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("does not open a stream when disabled", () => {
    const es = factory();
    renderHook(() => useLogStream(false, es.make));
    expect(es.all()).toHaveLength(0);
  });

  it("closes the stream when toggled from enabled to disabled", () => {
    const es = factory();
    const { rerender } = renderHook(({ on }: { on: boolean }) => useLogStream(on, es.make), {
      initialProps: { on: true },
    });
    const source = es.latest();
    expect(source.closed).toBe(false);
    rerender({ on: false });
    expect(source.closed).toBe(true);
  });
});

describe("useActivityStream", () => {
  it("accumulates emitted activity events", () => {
    const es = factory();
    const { result } = renderHook(() => useActivityStream(true, es.make));
    act(() => {
      es.latest().emit(
        "activity",
        JSON.stringify({ account: "acct-1", at: 10, clientIp: "127.0.0.1", model: "sonnet", status: 200 }),
      );
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({ account: "acct-1", status: 200 });
  });

  it("opens the activity stream endpoint and closes on unmount", () => {
    const es = factory();
    const { unmount } = renderHook(() => useActivityStream(true, es.make));
    expect(es.latest().url).toContain("/v0/management/activity/stream");
    const source = es.latest();
    unmount();
    expect(source.closed).toBe(true);
  });
});
