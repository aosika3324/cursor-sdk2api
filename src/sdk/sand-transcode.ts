/**
 * Sand inference transcoder.
 *
 * Sand traffic does not go to `agent.v1.AgentService/Run`; it goes to
 * `aiserver.v1.InferenceService/Stream`, which uses a different protobuf
 * message on the wire. This module encodes an agent run request into the
 * InferenceStreamRequest wire format and decodes the inference response stream
 * back into agent-shaped deltas.
 *
 * Field layout captured from the reference implementation:
 *   Request  (InferenceStreamRequest):
 *     1 repeated message  msg { 1 varint role; 2 string text }   role 1=user 2=assistant 4=system
 *     7 message           model { 1 string id; 2 bool maxMode; 3 repeated {1 string id; 2 string value} }
 *     8 string            conversationId (optional)
 *   Response (stream frames):
 *     1 message  { 1 string text; 2 varint final }
 *     9 message  { 1 string text }   thinking
 *     8 string   error
 *
 * This is pure wire-format code with no SDK dependency, so it is verifiable by
 * encode/decode round-trip in tests. Whether Cursor accepts the resulting
 * traffic can only be confirmed with a sand-capable account.
 */

const ROLE_USER = 1;
const ROLE_ASSISTANT = 2;
const ROLE_SYSTEM = 4;

export interface InferenceMessage {
  role: number;
  text: string;
}

export interface InferenceModelParam {
  id: string;
  value: string;
}

export interface InferenceSpec {
  conversationId: string;
  modelId: string;
  maxMode: boolean;
  params: InferenceModelParam[];
  msgs: InferenceMessage[];
}

export interface InferenceDelta {
  text?: string;
  thinking?: string;
  error?: string;
  final?: boolean;
}

// --- varint / wire primitives ---

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function tag(field: number, wire: number): number[] {
  return encodeVarint((field << 3) | wire);
}

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function cat(chunks: Array<Uint8Array | number[]>): Uint8Array {
  const parts = chunks.map((c) => (c instanceof Uint8Array ? c : Uint8Array.from(c)));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function fieldString(field: number, text: string): Uint8Array {
  const bytes = u8(text);
  return cat([tag(field, 2), encodeVarint(bytes.length), bytes]);
}

function fieldMessage(field: number, inner: Uint8Array): Uint8Array {
  return cat([tag(field, 2), encodeVarint(inner.length), inner]);
}

function fieldVarint(field: number, value: number): Uint8Array {
  if (!value) return new Uint8Array(0);
  return cat([tag(field, 0), encodeVarint(value)]);
}

function fieldBool(field: number, value: boolean): Uint8Array {
  return value ? cat([tag(field, 0), Uint8Array.from([1])]) : new Uint8Array(0);
}

export { ROLE_USER, ROLE_ASSISTANT, ROLE_SYSTEM };

// --- encode: InferenceSpec -> wire bytes ---

export function encodeInferenceRequest(spec: InferenceSpec): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const m of spec.msgs) {
    parts.push(fieldMessage(1, cat([fieldVarint(1, m.role), fieldString(2, m.text)])));
  }
  const model: Uint8Array[] = [fieldString(1, spec.modelId), fieldBool(2, spec.maxMode)];
  for (const param of spec.params) {
    if (!param.id) continue;
    model.push(fieldMessage(3, cat([fieldString(1, param.id), fieldString(2, String(param.value ?? ""))])));
  }
  parts.push(fieldMessage(7, cat(model)));
  if (spec.conversationId) parts.push(fieldString(8, spec.conversationId));
  return cat(parts);
}

// --- decode: wire bytes -> reader helpers ---

interface Cursor {
  buf: Uint8Array;
  i: number;
}

function readVarint(c: Cursor): number {
  let n = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = c.buf[c.i++]!;
    n |= (byte & 127) << shift;
    shift += 7;
  } while (byte & 128 && c.i < c.buf.length);
  return n >>> 0;
}

function skip(c: Cursor, wire: number): void {
  if (wire === 0) readVarint(c);
  else if (wire === 1) c.i += 8;
  else if (wire === 5) c.i += 4;
  else if (wire === 2) {
    const len = readVarint(c);
    c.i += len;
  } else c.i = c.buf.length;
}

function decodeString1(buf: Uint8Array): string {
  const c: Cursor = { buf, i: 0 };
  while (c.i < buf.length) {
    const t = readVarint(c);
    const field = t >>> 3;
    const wire = t & 7;
    if (wire === 2) {
      const len = readVarint(c);
      if (field === 1) return new TextDecoder().decode(buf.subarray(c.i, c.i + len));
      c.i += len;
    } else skip(c, wire);
  }
  return "";
}

function decodePart(buf: Uint8Array): { text?: string; final?: boolean } {
  const c: Cursor = { buf, i: 0 };
  const out: { text?: string; final?: boolean } = {};
  while (c.i < buf.length) {
    const t = readVarint(c);
    const field = t >>> 3;
    const wire = t & 7;
    if (wire === 0) {
      const v = readVarint(c);
      if (field === 2) out.final = Boolean(v);
    } else if (wire === 2) {
      const len = readVarint(c);
      if (field === 1) out.text = new TextDecoder().decode(buf.subarray(c.i, c.i + len));
      c.i += len;
    } else skip(c, wire);
  }
  return out;
}

/** Decode one length-delimited inference frame into an agent-shaped delta. */
export function decodeInferenceFrame(buf: Uint8Array): InferenceDelta {
  const c: Cursor = { buf, i: 0 };
  const out: InferenceDelta = {};
  while (c.i < buf.length) {
    const t = readVarint(c);
    const field = t >>> 3;
    const wire = t & 7;
    if (wire === 2) {
      const len = readVarint(c);
      const slice = buf.subarray(c.i, c.i + len);
      c.i += len;
      if (field === 1) {
        const part = decodePart(slice);
        if (part.text) out.text = part.text;
        if (part.final) out.final = true;
      } else if (field === 9) {
        const part = decodePart(slice);
        if (part.text) out.thinking = part.text;
      } else if (field === 8) {
        out.error = decodeString1(slice);
      }
    } else skip(c, wire);
  }
  return out;
}
