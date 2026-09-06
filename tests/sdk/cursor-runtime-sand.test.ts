import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCursorRuntime } from "../../src/sdk/cursor-runtime.js";
import { encodeConnectEnvelope } from "../../src/sdk/sand-transcode.js";

function textFrame(s: string): Uint8Array {
  const t = new TextEncoder().encode(s);
  const inner = Uint8Array.from([0x0a, t.length, ...t]);
  const outer = Uint8Array.from([0x0a, inner.length, ...inner]);
  return encodeConnectEnvelope(outer, 0);
}
function endFrame(): Uint8Array {
  return encodeConnectEnvelope(new TextEncoder().encode("{}"), 2);
}

describe("cursor-runtime sand fork", () => {
  it("uses direct-connect sand agent when profile=sand and sandJwt present", async () => {
    const frames = [textFrame("ok"), endFrame()];
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { frames.forEach((f) => c.enqueue(f)); c.close(); },
    }), { status: 200 })) as never;
    try {
      const rt = createCursorRuntime({ stateDir: mkdtempSync(join(tmpdir(), "rt-")) });
      const agent = await rt.createAgent({
        apiKey: "crsr_x", modelId: "grok-4.6", workspaceDir: mkdtempSync(join(tmpdir(), "ws-")),
        clientToolNames: [], customTools: {}, runtimeProfile: "sand", sandJwt: "j.w.t",
      });
      const run = await agent.send({ text: "hi" });
      const result = await run.wait();
      expect(result.status).toBe("finished");
      expect(result.result).toBe("ok");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
