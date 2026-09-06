import {
  decodeConnectEnvelopes,
  decodeInferenceFrame,
  encodeConnectEnvelope,
  encodeInferenceRequest,
  ROLE_USER,
  type InferenceDelta,
} from "./sand-transcode.js";

/**
 * Direct-HTTP probe to Cursor's Sand (Grok Bot) InferenceService.
 *
 * The npm `@cursor/sdk` 1.0.30 has no InferenceService binding, so sand cannot
 * be driven through the SDK. This bypasses the SDK entirely: it builds the
 * InferenceStreamRequest with the transcoder, wraps it in Connect framing, and
 * POSTs it directly.
 *
 * All constants below were CONFIRMED against live api2 on 2026-09-06 with a
 * sand-granted account (returned real Bot inference text). Key findings:
 *   - Auth is `Bearer <JWT>` where the JWT is the accessToken half of a session
 *     token (`user_...::<jwt>`), NOT a crsr_ key.
 *   - `x-cursor-client-version` MUST carry a source prefix (`cli-<v>`). A bare
 *     `0.18.0` is rejected with `permission_denied: ERROR_OUTDATED_CLIENT`.
 *   - `conversation_id` is required; an empty one yields `invalid_argument`.
 */

const SAND_HOST = "https://api2.cursor.sh";
const SAND_PATH = "/aiserver.v1.InferenceService/Stream";
const SAND_CONTENT_TYPE = "application/connect+proto";
// Must be prefixed (cli-/agentkit-/python-); a bare version triggers ERROR_OUTDATED_CLIENT.
const SAND_CLIENT_VERSION = "cli-1.0.30";
const SAND_BOX_NAMESPACE = "prod";

export interface SandProbeInput {
  /** Bearer token: the JWT accessToken (session-token half), not a crsr_ key. */
  apiKey: string;
  prompt: string;
  conversationId?: string;
  modelId?: string;
  params?: Array<{ id: string; value: string }>;
  request?: typeof globalThis.fetch;
}

export interface SandProbeResult {
  httpStatus: number;
  ok: boolean;
  text: string;
  thinking: string;
  error?: string;
  frameCount: number;
  contentType?: string;
  rawHeadHex?: string;
}

export async function probeSandInference(input: SandProbeInput): Promise<SandProbeResult> {
  const request = input.request ?? globalThis.fetch;
  const body = encodeConnectEnvelope(
    encodeInferenceRequest({
      // conversation_id is required by sand; default to a fresh UUID.
      conversationId: input.conversationId ?? globalThis.crypto.randomUUID(),
      modelId: input.modelId ?? "grok-4.6",
      maxMode: true,
      // requested_model params: sand rejects an empty model, so these are set.
      params: input.params ?? [{ id: "effort", value: "high" }, { id: "fast", value: "true" }],
      msgs: [{ role: ROLE_USER, text: input.prompt }],
    }),
  );

  const response = await request(`${SAND_HOST}${SAND_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": SAND_CONTENT_TYPE,
      "connect-protocol-version": "1",
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": SAND_CLIENT_VERSION,
      "x-sand-box-namespace": SAND_BOX_NAMESPACE,
    },
    body,
  });

  const raw = new Uint8Array(await response.arrayBuffer());
  const frames = decodeConnectEnvelopes(raw);
  let text = "";
  let thinking = "";
  let error: string | undefined;
  for (const frame of frames) {
    // flag bit 1 (value 2) marks the trailing end-of-stream frame (JSON), which
    // carries a connect error object when the request was rejected.
    if (frame.flag & 2) {
      const trailer = new TextDecoder().decode(frame.payload).trim();
      if (trailer && trailer !== "{}") {
        try {
          const parsed = JSON.parse(trailer) as { error?: { message?: string } };
          if (parsed.error) error = parsed.error.message || trailer;
        } catch {
          error = trailer;
        }
      }
      continue;
    }
    const delta: InferenceDelta = decodeInferenceFrame(frame.payload);
    if (delta.text) text += delta.text;
    if (delta.thinking) thinking += delta.thinking;
    if (delta.error) error = delta.error;
  }
  return {
    httpStatus: response.status,
    ok: response.ok && !error,
    text,
    thinking,
    error,
    frameCount: frames.length,
    contentType: response.headers.get("content-type") ?? undefined,
    // First bytes help diagnose framing/error mismatches.
    rawHeadHex: Buffer.from(raw.subarray(0, 256)).toString("hex"),
  };
}
