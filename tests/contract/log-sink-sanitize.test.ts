import { expect, test } from "vitest";
import { createTeeLogger } from "../../src/server/app.js";
import { LogSink, type LogEntry } from "../../src/core/log-sink.js";
import type { Logger } from "../../src/log.js";

function spyLogger(): { logger: Logger; calls: Array<{ fields: Record<string, unknown>; message: string }> } {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const record = (fields: Record<string, unknown>, message: string) => {
    calls.push({ fields, message });
  };
  return {
    logger: {
      info: record,
      warn: record,
      error: record,
    },
    calls,
  };
}

test("tee logger redacts blocked-key fields before pushing to the log sink", () => {
  const captured: LogEntry[] = [];
  const sink = new LogSink();
  sink.subscribe((entry) => captured.push(entry));

  const { logger: base } = spyLogger();
  const tee = createTeeLogger(base, sink, { now: () => 1000 });

  tee.info(
    {
      request_id: "req-1",
      authorization: "Bearer sk-super-secret-token",
      api_key: "sk-abcdef123456789",
    },
    "request received",
  );

  expect(captured).toHaveLength(1);
  const entry = captured[0]!;
  // BLOCKED_KEYS fields must be redacted, not passed through verbatim.
  expect(entry.authorization).toBe("[redacted]");
  expect(entry.api_key).toBe("[redacted]");
  // Non-sensitive fields survive.
  expect(entry.request_id).toBe("req-1");
  expect(entry.level).toBe("info");
  expect(entry.at).toBe(1000);
  // The raw secret value must never appear anywhere in the pushed entry.
  expect(JSON.stringify(entry)).not.toContain("sk-super-secret-token");
  expect(JSON.stringify(entry)).not.toContain("sk-abcdef123456789");
});

test("tee logger redacts secret-like values in the message and field values", () => {
  const captured: LogEntry[] = [];
  const sink = new LogSink();
  sink.subscribe((entry) => captured.push(entry));

  const { logger: base } = spyLogger();
  const tee = createTeeLogger(base, sink, { now: () => 2000 });

  tee.warn(
    { detail: "connect failed for sk-leakyvalue0000 upstream" },
    "auth failed with Bearer sk-messagesecret999",
  );

  const entry = captured[0]!;
  expect(entry.msg).toContain("[redacted]");
  expect(entry.msg).not.toContain("sk-messagesecret999");
  expect(String(entry.detail)).toContain("[redacted]");
  expect(String(entry.detail)).not.toContain("sk-leakyvalue0000");
});

test("tee logger still delegates the original fields to the base logger", () => {
  const sink = new LogSink();
  const { logger: base, calls } = spyLogger();
  const tee = createTeeLogger(base, sink, { now: () => 3000 });

  tee.error({ request_id: "req-2", api_key: "sk-delegated12345" }, "boom");

  expect(calls).toHaveLength(1);
  expect(calls[0]!.message).toBe("boom");
  expect(calls[0]!.fields.request_id).toBe("req-2");
  // baseLogger sanitizes internally, so it receives the raw fields and redacts on write.
  expect(calls[0]!.fields.api_key).toBe("sk-delegated12345");
});
