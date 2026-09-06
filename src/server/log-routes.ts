import type { IncomingMessage, ServerResponse } from "node:http";
import { LOG_CAPACITY_STEPS, type LogSink } from "../core/log-sink.js";
import type { RequestTelemetry } from "../core/request-telemetry.js";
import { readJsonBody, sendJson, writeSse } from "./http-util.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

function streamSse<T>(
  req: IncomingMessage,
  res: ServerResponse,
  event: string,
  source: { recent(): T[]; subscribe(fn: (entry: T) => void): () => void },
): void {
  res.writeHead(200, SSE_HEADERS);
  res.flushHeaders();
  for (const entry of source.recent()) writeSse(res, event, entry);
  const unsub = source.subscribe((entry) => writeSse(res, event, entry));
  req.on("close", unsub);
}

export async function handleLogRoutes(input: {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  method: string;
  requestId: string;
  logSink: LogSink;
  telemetry: RequestTelemetry;
  clock: { now(): number };
  maxBodyBytes: number;
}): Promise<boolean> {
  const { req, res, path, method, requestId, logSink, telemetry, clock, maxBodyBytes } = input;

  if (path === "/v0/management/logs/capacity" && method === "GET") {
    sendJson(res, 200, { capacity: logSink.capacity, steps: LOG_CAPACITY_STEPS }, requestId);
    return true;
  }

  if (path === "/v0/management/logs/capacity" && method === "PUT") {
    const body = (await readJsonBody(req, maxBodyBytes)) as { capacity?: unknown } | undefined;
    const capacity = body?.capacity;
    if (
      typeof capacity !== "number" ||
      !(LOG_CAPACITY_STEPS as readonly number[]).includes(capacity)
    ) {
      sendJson(res, 400, { error: "invalid capacity" }, requestId);
      return true;
    }
    logSink.setCapacity(capacity);
    telemetry.setCapacity(capacity);
    sendJson(res, 200, { capacity }, requestId);
    return true;
  }

  if (path === "/v0/management/logs/stream" && method === "GET") {
    streamSse(req, res, "log", logSink);
    return true;
  }

  if (path === "/v0/management/activity/stream" && method === "GET") {
    streamSse(req, res, "activity", telemetry);
    return true;
  }

  if (path === "/v0/management/activity/stats" && method === "GET") {
    sendJson(res, 200, { rpm: telemetry.rpm(clock.now()) }, requestId);
    return true;
  }

  return false;
}
