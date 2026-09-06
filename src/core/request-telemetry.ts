import { LOG_CAPACITY_STEPS, type LogCapacity } from "./log-sink.js";

export interface ActivityEntry {
  account: string;
  at: number;
  clientIp: string;
  model: string;
  status: number;
  credentialId: string;
  durationMs: number;
}

type Subscriber = (entry: ActivityEntry) => void;

export class RequestTelemetry {
  private buf: ActivityEntry[] = [];
  private cap: number;
  private subs = new Set<Subscriber>();

  constructor(capacity: LogCapacity = 50) {
    this.cap = capacity;
  }

  get capacity(): number {
    return this.cap;
  }

  setCapacity(capacity: number): void {
    if (!LOG_CAPACITY_STEPS.includes(capacity as LogCapacity)) {
      throw new Error(`invalid activity capacity ${capacity}`);
    }
    this.cap = capacity;
    if (this.buf.length > this.cap) this.buf = this.buf.slice(this.buf.length - this.cap);
  }

  record(entry: ActivityEntry): void {
    this.buf.push(entry);
    if (this.buf.length > this.cap) this.buf.shift();
    for (const sub of this.subs) {
      try {
        sub(entry);
      } catch {
        // A failing subscriber must not affect telemetry or request handling.
      }
    }
  }

  recent(): ActivityEntry[] {
    return [...this.buf];
  }

  rpm(now: number): number {
    const cutoff = now - 60_000;
    return this.buf.filter((e) => e.at >= cutoff).length;
  }

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}
