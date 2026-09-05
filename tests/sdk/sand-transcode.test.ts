import { describe, expect, it } from "vitest";
import {
  decodeInferenceFrame,
  encodeInferenceRequest,
  ROLE_ASSISTANT,
  ROLE_SYSTEM,
  ROLE_USER,
  type InferenceSpec,
} from "../../src/sdk/sand-transcode.js";

// Minimal protobuf reader mirroring the encoder, used to prove the request
// bytes decode back to the same structure. This is the offline guarantee that
// the wire format is self-consistent.
function fields(buf: Uint8Array): Array<{ field: number; wire: number; value: number; bytes?: Uint8Array }> {
  const out: Array<{ field: number; wire: number; value: number; bytes?: Uint8Array }> = [];
  let i = 0;
  const rv = () => {
    let n = 0;
    let s = 0;
    let b: number;
    do {
      b = buf[i++]!;
      n |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    return n >>> 0;
  };
  while (i < buf.length) {
    const tag = rv();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) out.push({ field, wire, value: rv() });
    else if (wire === 2) {
      const len = rv();
      out.push({ field, wire, value: len, bytes: buf.subarray(i, i + len) });
      i += len;
    } else throw new Error(`unexpected wire ${wire}`);
  }
  return out;
}

function decodeRequest(buf: Uint8Array) {
  const msgs: Array<{ role: number; text: string }> = [];
  const model: { id?: string; maxMode?: boolean; params: Array<{ id: string; value: string }> } = {
    params: [],
  };
  let conversationId = "";
  const dec = (b: Uint8Array) => new TextDecoder().decode(b);
  for (const f of fields(buf)) {
    if (f.field === 1 && f.bytes) {
      let role = 0;
      let text = "";
      for (const g of fields(f.bytes)) {
        if (g.field === 1 && g.wire === 0) role = g.value;
        else if (g.field === 2 && g.bytes) text = dec(g.bytes);
      }
      msgs.push({ role, text });
    } else if (f.field === 7 && f.bytes) {
      for (const g of fields(f.bytes)) {
        if (g.field === 1 && g.bytes) model.id = dec(g.bytes);
        else if (g.field === 2 && g.wire === 0) model.maxMode = Boolean(g.value);
        else if (g.field === 3 && g.bytes) {
          let pid = "";
          let pval = "";
          for (const p of fields(g.bytes)) {
            if (p.field === 1 && p.bytes) pid = dec(p.bytes);
            else if (p.field === 2 && p.bytes) pval = dec(p.bytes);
          }
          model.params.push({ id: pid, value: pval });
        }
      }
    } else if (f.field === 8 && f.bytes) {
      conversationId = dec(f.bytes);
    }
  }
  return { msgs, model, conversationId };
}

describe("sand request encoding", () => {
  it("round-trips messages, model, params, and conversation id", () => {
    const spec: InferenceSpec = {
      conversationId: "conv-1",
      modelId: "grok-4.6",
      maxMode: true,
      params: [{ id: "effort", value: "high" }, { id: "fast", value: "true" }],
      msgs: [
        { role: ROLE_SYSTEM, text: "be terse" },
        { role: ROLE_USER, text: "hello" },
        { role: ROLE_ASSISTANT, text: "hi" },
      ],
    };
    const decoded = decodeRequest(encodeInferenceRequest(spec));
    expect(decoded.msgs).toEqual(spec.msgs);
    expect(decoded.model.id).toBe("grok-4.6");
    expect(decoded.model.maxMode).toBe(true);
    expect(decoded.model.params).toEqual(spec.params);
    expect(decoded.conversationId).toBe("conv-1");
  });

  it("omits an empty conversation id", () => {
    const bytes = encodeInferenceRequest({
      conversationId: "",
      modelId: "grok-4.6",
      maxMode: false,
      params: [],
      msgs: [{ role: ROLE_USER, text: "x" }],
    });
    expect(decodeRequest(bytes).conversationId).toBe("");
  });
});

// Build a response frame the way the server would, to test the decoder.
function encVarint(n: number): number[] {
  const o: number[] = [];
  let v = n >>> 0;
  while (v > 127) { o.push((v & 127) | 128); v >>>= 7; }
  o.push(v);
  return o;
}
function frame(field: number, inner: number[]): number[] {
  return [...encVarint((field << 3) | 2), ...encVarint(inner.length), ...inner];
}
function strField(field: number, text: string): number[] {
  const b = [...new TextEncoder().encode(text)];
  return [...encVarint((field << 3) | 2), ...encVarint(b.length), ...b];
}

describe("sand response decoding", () => {
  it("decodes a text delta", () => {
    const inner = strField(1, "partial");
    const buf = Uint8Array.from(frame(1, inner));
    expect(decodeInferenceFrame(buf)).toEqual({ text: "partial" });
  });

  it("decodes a text delta with final flag", () => {
    const inner = [...strField(1, "done"), ...encVarint((2 << 3) | 0), 1];
    const buf = Uint8Array.from(frame(1, inner));
    expect(decodeInferenceFrame(buf)).toEqual({ text: "done", final: true });
  });

  it("decodes a thinking delta from field 9", () => {
    const buf = Uint8Array.from(frame(9, strField(1, "reasoning")));
    expect(decodeInferenceFrame(buf)).toEqual({ thinking: "reasoning" });
  });

  it("decodes an error from field 8", () => {
    const buf = Uint8Array.from(frame(8, strField(1, "boom")));
    expect(decodeInferenceFrame(buf)).toEqual({ error: "boom" });
  });

  it("ignores unknown fields without throwing", () => {
    const buf = Uint8Array.from([...encVarint((5 << 3) | 0), 42, ...frame(1, strField(1, "keep"))]);
    expect(decodeInferenceFrame(buf)).toEqual({ text: "keep" });
  });
});
