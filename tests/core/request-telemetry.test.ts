import { describe, expect, it } from "vitest";
import { RequestTelemetry, type ActivityEntry } from "../../src/core/request-telemetry.js";

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  account: "acct_x", at: 1000, clientIp: "1.2.3.4", model: "grok-4.6",
  status: 200, credentialId: "••••abcd", durationMs: 12, ...over,
});

describe("RequestTelemetry", () => {
  it("defaults capacity 50 and rings the buffer", () => {
    const t = new RequestTelemetry(20);
    for (let i = 0; i < 25; i++) t.record(entry({ at: i }));
    expect(t.recent()).toHaveLength(20);
    expect(t.recent()[0]!.at).toBe(5);
  });

  it("setCapacity trims oldest and rejects non-whitelist", () => {
    const t = new RequestTelemetry(100);
    for (let i = 0; i < 60; i++) t.record(entry({ at: i }));
    t.setCapacity(30);
    expect(t.recent()).toHaveLength(30);
    expect(() => t.setCapacity(7)).toThrow();
  });

  it("computes RPM as records within the last 60s", () => {
    const t = new RequestTelemetry(300);
    const now = 1_000_000;
    t.record(entry({ at: now - 70_000 }));
    t.record(entry({ at: now - 30_000 }));
    t.record(entry({ at: now - 1_000 }));
    expect(t.rpm(now)).toBe(2);
  });

  it("broadcasts recorded entries", () => {
    const t = new RequestTelemetry();
    const seen: number[] = [];
    const unsub = t.subscribe((e) => seen.push(e.status));
    t.record(entry({ status: 429 }));
    unsub();
    t.record(entry({ status: 200 }));
    expect(seen).toEqual([429]);
  });
});
