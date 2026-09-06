import { describe, expect, it } from "vitest";
import { createSandAgent } from "../../src/sdk/sand-runtime.js";
import { encodeConnectEnvelope } from "../../src/sdk/sand-transcode.js";

function textFrame(s: string): Uint8Array {
  const t = new TextEncoder().encode(s);
  const inner = Uint8Array.from([0x0a, t.length, ...t]);        // field1 LEN: text
  const outer = Uint8Array.from([0x0a, inner.length, ...inner]); // field1 LEN: part
  return encodeConnectEnvelope(outer, 0);
}
function endFrame(): Uint8Array {
  return encodeConnectEnvelope(new TextEncoder().encode("{}"), 2);
}
// A data frame carrying an inference error: field 8 (LEN) wraps a message
// whose field 1 (LEN) is the error string (decodeInferenceFrame reads field 8
// via decodeString1, which extracts nested field 1).
function errorDataFrame(s: string): Uint8Array {
  const t = new TextEncoder().encode(s);
  const inner = Uint8Array.from([0x0a, t.length, ...t]); // field 1 LEN: string
  const payload = Uint8Array.from([0x42, inner.length, ...inner]); // field 8 LEN: message
  return encodeConnectEnvelope(payload, 0);
}
function streamOf(frames: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(c) { frames.forEach((f) => c.enqueue(f)); c.close(); } });
}
function fakeFetch(frames: Uint8Array[]) {
  return async () => new Response(streamOf(frames), { status: 200, headers: { "content-type": "application/connect+proto" } });
}

describe("sand runtime", () => {
  it("streams text deltas and resolves wait() with accumulated text", async () => {
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: fakeFetch([textFrame("Hel"), textFrame("lo"), endFrame()]) as never });
    const seen: string[] = [];
    const run = await agent.send({ text: "hi", onDelta: (u) => { if (u.type === "text-delta") seen.push(u.text); } });
    const result = await run.wait();
    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.status).toBe("finished");
    expect(result.result).toBe("Hello");
  });

  it("accumulates history across turns", async () => {
    const captured: string[] = [];
    const rec = (frames: Uint8Array[]) => (async (_u: string, init: RequestInit) => {
      captured.push(Buffer.from(init!.body as Uint8Array).toString("latin1"));
      return new Response(streamOf(frames), { status: 200 });
    });
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: rec([textFrame("A"), endFrame()]) as never });
    await (await agent.send({ text: "first" })).wait();
    await (await agent.send({ text: "second" })).wait();
    expect(captured[1]).toContain("second");
    expect(captured[1]).toContain("first");
    expect(captured[1]).toContain("A");
  });

  it("maps an error trailer to an error result", async () => {
    const errFrame = encodeConnectEnvelope(new TextEncoder().encode('{"error":{"message":"boom"}}'), 2);
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: fakeFetch([errFrame]) as never });
    const run = await agent.send({ text: "hi" });
    const result = await run.wait();
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("boom");
  });

  it("stream() yields assistant events", async () => {
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: fakeFetch([textFrame("Hi"), endFrame()]) as never });
    const run = await agent.send({ text: "yo" });
    const kinds: string[] = [];
    for await (const e of run.stream()) kinds.push(e.type);
    expect(kinds).toContain("assistant");
  });

  it("maps a DATA-frame error field to an error result", async () => {
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: fakeFetch([errorDataFrame("upstream exploded"), endFrame()]) as never });
    const run = await agent.send({ text: "hi" });
    const result = await run.wait();
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("upstream exploded");
  });

  it("resolves (does not throw) with an error result on mid-stream read failure", async () => {
    const request = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(textFrame("partial"));
            c.error(new Error("net down"));
          },
        }),
        { status: 200 },
      );
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: request as never });
    const run = await agent.send({ text: "hi" });
    const result = await run.wait();
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("net down");
  });
});
