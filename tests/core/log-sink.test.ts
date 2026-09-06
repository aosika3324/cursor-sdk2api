import { describe, expect, it } from "vitest";
import { LogSink, LOG_CAPACITY_STEPS } from "../../src/core/log-sink.js";

describe("LogSink", () => {
  it("defaults to capacity 50 and exposes the step whitelist", () => {
    const sink = new LogSink();
    expect(sink.capacity).toBe(50);
    expect(LOG_CAPACITY_STEPS).toEqual([20, 30, 50, 100, 200, 300]);
  });

  it("keeps only the most recent N entries at capacity", () => {
    const sink = new LogSink(20);
    for (let i = 0; i < 25; i++) sink.push({ level: "info", msg: `m${i}`, at: i });
    const recent = sink.recent();
    expect(recent).toHaveLength(20);
    expect(recent[0]!.msg).toBe("m5");
    expect(recent[19]!.msg).toBe("m24");
  });

  it("trims oldest immediately when capacity is lowered", () => {
    const sink = new LogSink(100);
    for (let i = 0; i < 80; i++) sink.push({ level: "info", msg: `m${i}`, at: i });
    sink.setCapacity(30);
    expect(sink.capacity).toBe(30);
    expect(sink.recent()).toHaveLength(30);
    expect(sink.recent()[0]!.msg).toBe("m50");
  });

  it("rejects a capacity not in the whitelist", () => {
    const sink = new LogSink();
    expect(() => sink.setCapacity(999)).toThrow();
    expect(sink.capacity).toBe(50);
  });

  it("broadcasts pushed entries to subscribers and supports unsubscribe", () => {
    const sink = new LogSink();
    const seen: string[] = [];
    const unsub = sink.subscribe((e) => seen.push(e.msg));
    sink.push({ level: "info", msg: "a", at: 1 });
    unsub();
    sink.push({ level: "info", msg: "b", at: 2 });
    expect(seen).toEqual(["a"]);
  });

  it("swallows a throwing subscriber and still buffers the entry", () => {
    const sink = new LogSink();
    sink.subscribe(() => {
      throw new Error("bad subscriber");
    });
    expect(() => sink.push({ level: "info", msg: "kept", at: 1 })).not.toThrow();
    expect(sink.recent()).toHaveLength(1);
    expect(sink.recent()[0]!.msg).toBe("kept");
  });
});
