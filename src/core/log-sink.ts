export const LOG_CAPACITY_STEPS = [20, 30, 50, 100, 200, 300] as const;
export type LogCapacity = (typeof LOG_CAPACITY_STEPS)[number];

export interface LogEntry {
  level: string;
  msg: string;
  at: number;
  [key: string]: unknown;
}

type Subscriber = (entry: LogEntry) => void;

export class LogSink {
  private buf: LogEntry[] = [];
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
      throw new Error(`invalid log capacity ${capacity}`);
    }
    this.cap = capacity;
    if (this.buf.length > this.cap) this.buf = this.buf.slice(this.buf.length - this.cap);
  }

  push(entry: LogEntry): void {
    this.buf.push(entry);
    if (this.buf.length > this.cap) this.buf.shift();
    for (const sub of this.subs) {
      try {
        sub(entry);
      } catch {
        // A failing subscriber must not affect logging or the producer.
      }
    }
  }

  recent(): LogEntry[] {
    return [...this.buf];
  }

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}
