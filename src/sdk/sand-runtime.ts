import {
  ROLE_USER,
  ROLE_ASSISTANT,
  encodeInferenceRequest,
  encodeConnectEnvelope,
  createFrameDecoder,
  decodeInferenceFrame,
  type InferenceMessage,
} from "./sand-transcode.js";
import type {
  SdkAgent,
  SdkRun,
  SdkRunResult,
  SdkSendInput,
  SdkStreamEvent,
} from "./port.js";

const SAND_URL = "https://api2.cursor.sh/aiserver.v1.InferenceService/Stream";

/** Connect stream envelope flag bit signalling the end-of-stream trailer frame. */
const CONNECT_END_STREAM_FLAG = 2;

const DEFAULT_PARAMS: Array<{ id: string; value: string }> = [
  { id: "effort", value: "high" },
  { id: "fast", value: "true" },
];

export interface SandAgentInit {
  jwt: string;
  modelId: string;
  conversationId: string;
  modelParams?: Array<{ id: string; value: string }>;
  request?: typeof globalThis.fetch;
}

export function createSandAgent(init: SandAgentInit): SdkAgent {
  const request = init.request ?? globalThis.fetch;
  const history: InferenceMessage[] = [];
  const agentId = init.conversationId;
  return {
    agentId,
    async send(input: SdkSendInput): Promise<SdkRun> {
      // The user message is appended before the request. On a failed turn it
      // intentionally stays in history while no assistant reply is appended
      // (see the `if (!errorMsg)` gate in makeRun) — this asymmetry is
      // spec-compliant so a retry resends the same user turn.
      history.push({ role: ROLE_USER, text: input.text });
      const body = encodeConnectEnvelope(
        encodeInferenceRequest({
          conversationId: init.conversationId,
          modelId: init.modelId,
          maxMode: true,
          params: init.modelParams ?? DEFAULT_PARAMS,
          msgs: [...history],
        }),
      );
      const response = await request(SAND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${init.jwt}`,
          "content-type": "application/connect+proto",
          "connect-protocol-version": "1",
          "x-cursor-client-type": "sand",
          "x-cursor-client-version": "cli-1.0.30",
          "x-sand-box-namespace": "prod",
        },
        body,
      });
      return makeRun(agentId, response, history, input);
    },
    close() {},
  };
}

function makeRun(
  id: string,
  response: Response,
  history: InferenceMessage[],
  input: SdkSendInput,
): SdkRun {
  const events: SdkStreamEvent[] = [];
  let assembled = "";
  let errorMsg: string | undefined;

  const consume = (async () => {
    const decoder = createFrameDecoder();
    const handleFrame = (flag: number, payload: Uint8Array) => {
      if (flag & CONNECT_END_STREAM_FLAG) {
        const trailer = new TextDecoder().decode(payload).trim();
        if (trailer && trailer !== "{}") {
          try {
            const parsed = JSON.parse(trailer) as { error?: { message?: string } };
            if (parsed.error) errorMsg = parsed.error.message || trailer;
          } catch {
            errorMsg = trailer;
          }
        }
        return;
      }
      const delta = decodeInferenceFrame(payload);
      if (delta.error) errorMsg = delta.error;
      if (delta.text) {
        assembled += delta.text;
        events.push({ type: "assistant", text: delta.text });
        void input.onDelta?.({ type: "text-delta", text: delta.text });
      }
      if (delta.thinking) {
        events.push({ type: "thinking", text: delta.thinking });
        void input.onDelta?.({ type: "thinking-delta", text: delta.thinking });
      }
    };

    const reader = response.body?.getReader();
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) for (const f of decoder.push(value)) handleFrame(f.flag, f.payload);
        }
      } else {
        const buf = new Uint8Array(await response.arrayBuffer());
        for (const f of decoder.push(buf)) handleFrame(f.flag, f.payload);
      }
    } catch (err) {
      // A mid-stream read or network failure resolves to a clean error result
      // (consistent with the trailer/DATA error path) rather than rejecting
      // the eagerly-created consume promise.
      errorMsg = (err as { message?: string })?.message ?? String(err);
    }

    if (!errorMsg) {
      // Only on success is the assistant reply appended; on failure history
      // retains just the user turn (intentional asymmetry, see send()).
      history.push({ role: ROLE_ASSISTANT, text: assembled });
      void input.onDelta?.({ type: "turn-ended" });
    }
  })();

  return {
    id,
    async *stream(): AsyncIterable<SdkStreamEvent> {
      await consume;
      for (const e of events) yield e;
    },
    async wait(): Promise<SdkRunResult> {
      await consume;
      if (errorMsg) return { id, status: "error", error: { message: errorMsg } };
      return { id, status: "finished", result: assembled };
    },
    async cancel() {},
  };
}
