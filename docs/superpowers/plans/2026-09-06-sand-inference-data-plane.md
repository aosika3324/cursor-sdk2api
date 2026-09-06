# Sand 推理接入数据面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `sand` runtime profile 的推理请求通过直连 HTTP 打到 Cursor InferenceService（用 Bot 额度），替代当前实跑 403 的打补丁 SDK clone。

**Architecture:** 在 `cursor-runtime.ts` 的 profile fork 处，为 sand 返回一个直连 HTTP 实现的 `SdkRun`（复用已验证的 `sand-transcode`），下游 EventPump/writers/ledger 不变。sand 鉴权用 session-token JWT，经账号存储 → AuthContext → agent input 送到运行时。首版支持多轮（历史编进 `msgs[]`）。

**Tech Stack:** TypeScript (ESM), Node fetch streaming, vitest, connect+proto wire format。

**参考 spec:** `docs/superpowers/specs/2026-09-06-sand-inference-data-plane-design.md` 及 `2026-09-06-capture-real-sand-traffic.md`（已验证的请求配方）。

---

## 文件结构

- `src/account/file-store.ts` — 加 `session_token` 持久字段 + `setSessionToken` + `toPublic` 映射
- `src/account/cursor-onboarding.ts` — onboarding 成功后返回 session token 供持久化（可选）
- `src/auth/credentials.ts` — `AuthContext.sandJwt`；`managedAccountAuth` 接受 session token；BYOK 识别 session token
- `src/sdk/port.ts` — `CreateAgentInput.sandJwt` / `ResumeAgentInput.sandJwt`
- `src/core/sdk-run-driver.ts` — `SdkAgentSource` 加 `sandJwt`；透传到 createAgent/resumeAgent
- `src/core/run-coordinator.ts` — 4 处 agent input 构造带上 `auth.sandJwt`
- `src/sdk/sand-runtime.ts` — **新建**：直连 HTTP 的 `SdkAgent`/`SdkRun`
- `src/sdk/sand-transcode.ts` — 加流式增量帧解析器 `createFrameDecoder`
- `src/sdk/cursor-runtime.ts` — fork：sand + 有 sandJwt → sand-runtime
- 各 `tests/**` — 对应单测

---

## 段 1：账号存储持久化 session token

### Task 1: `AccountFile` / `StoredCursorAccount` 增加 session token

**Files:**
- Modify: `src/account/file-store.ts:24-37` (AccountFile), `:42-54` (StoredCursorAccount), `:225-242` (toPublic)
- Test: `tests/account/file-store.test.ts` (若不存在则创建)

- [ ] **Step 1: 写失败测试** — 在 `tests/account/file-store.test.ts` 加：

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorAccountFileStore } from "../../src/account/file-store.js";

describe("session token persistence", () => {
  it("stores and returns a session token, exposes only a hint publicly", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    const updated = store.setSessionToken(acct.id, "user_X::jwt.body.sig");
    expect(updated?.hasSessionToken).toBe(true);
    expect(store.getSessionToken(acct.id)).toBe("user_X::jwt.body.sig");
  });

  it("returns undefined session token when none stored", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    expect(acct.hasSessionToken).toBe(false);
    expect(store.getSessionToken(acct.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/account/file-store.test.ts`
Expected: FAIL（`setSessionToken`/`getSessionToken`/`hasSessionToken` 不存在）

- [ ] **Step 3: 实现** — `AccountFile` 加字段（`:36` 后）：

```typescript
  last_error?: AccountFailure | null;
  session_token?: string;
```

`StoredCursorAccount`（`:53` 后，`lastError` 前后皆可）加：

```typescript
  /** True when a session token (for sand JWT auth) is stored. */
  hasSessionToken: boolean;
```

`toPublic`（`:240` `lastError` 行后）加：

```typescript
      hasSessionToken: typeof account.session_token === "string" && account.session_token.length > 0,
```

新增方法（放在 `setLastError` 后，`:167` 附近）：

```typescript
  /** Persist (or clear) the account's session token used for sand JWT auth. */
  setSessionToken(id: string, token: string | null): StoredCursorAccount | undefined {
    return this.mutate(id, (account) => ({
      ...account,
      session_token: token ?? undefined,
    }));
  }

  /** Read the raw session token. Not exposed via toPublic. */
  getSessionToken(id: string): string | undefined {
    const name = `${id}.json`;
    if (!FILE_RE.test(name)) return undefined;
    const account = this.read(join(this.dir, name));
    return account?.session_token;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/account/file-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/account/file-store.ts tests/account/file-store.test.ts
git commit -m "feat: persist account session token for sand JWT auth"
```

## 段 1b：onboarding 顺手持久化 session token

### Task 2: onboard 端点在勾选时存 session token

**Files:**
- Modify: `src/server/app.ts:650-677` (onboard handler)
- Test: `tests/contract/console-operator.test.ts`（若已有 onboard 测试则加用例；否则新建最小测试）

- [ ] **Step 1: 写失败测试** — 在既有 onboard 测试文件加（用 fake fetch 注入 onboarding，断言 store 里存了 token）。测试要点：POST onboard with `store_session_token: true`，之后 `store.getSessionToken(accountId)` 非空。若现有测试用真实 `onboardCursorAccount`，改用其 `request` 注入。示例断言：

```typescript
it("persists the session token when store_session_token is set", async () => {
  // ...build app with a fake fetch that mints a crsr_ key...
  const res = await postJson(app, "/v0/management/accounts/onboard", {
    session_token: "user_X::eyJ.body.sig",
    store_session_token: true,
  });
  expect(res.status).toBe(201);
  const id = res.body.account.id as string;
  expect(store.getSessionToken(id)).toBe("user_X::eyJ.body.sig");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/contract/console-operator.test.ts`
Expected: FAIL（token 未持久化）

- [ ] **Step 3: 实现** — 改 onboard handler（`:668-669`）：

```typescript
        const storeSessionToken = body?.store_session_token === true;
        // Persist the minted crsr_ key. Optionally also persist the session
        // token — required for sand (Bot) inference, which authenticates with
        // the session-token JWT, not the crsr_ key.
        const account = accounts.add(result.apiKey);
        if (storeSessionToken) accounts.setSessionToken(account.id, sessionToken);
```

（`publicAccount(account)` 返回值不含 token，仅 `hasSessionToken` 布尔，无需额外脱敏。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/contract/console-operator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/contract/console-operator.test.ts
git commit -m "feat: optionally persist session token on onboarding for sand"
```

## 段 2：JWT 流经认证链

### Task 3: `AuthContext.sandJwt` + `managedAccountAuth` 携带 JWT

**Files:**
- Modify: `src/auth/credentials.ts:8-13` (AuthContext), `:45-52` (managedAccountAuth), `:35-43` (BYOK branch), `:54-61` (presentedSecret)
- Test: `tests/auth/credentials.test.ts`（若不存在则创建）

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from "vitest";
import { managedAccountAuth, extractSandJwt } from "../../src/auth/credentials.js";

describe("sand JWT in auth context", () => {
  it("extracts the JWT half from a session token", () => {
    expect(extractSandJwt("user_X::jwt.body.sig")).toBe("jwt.body.sig");
    expect(extractSandJwt("user_X%3A%3Ajwt.body.sig")).toBe("jwt.body.sig");
    expect(extractSandJwt("crsr_notasession")).toBeUndefined();
  });

  it("managedAccountAuth carries sandJwt when a session token is given", () => {
    const auth = managedAccountAuth("crsr_key", undefined, "user_X::jwt.body.sig");
    expect(auth.cursorApiKey).toBe("crsr_key");
    expect(auth.sandJwt).toBe("jwt.body.sig");
  });

  it("managedAccountAuth omits sandJwt when no session token", () => {
    const auth = managedAccountAuth("crsr_key");
    expect(auth.sandJwt).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/auth/credentials.test.ts`
Expected: FAIL（`extractSandJwt` / `sandJwt` 参数不存在）

- [ ] **Step 3: 实现** — `credentials.ts`：

`AuthContext`（`:13` `defaultProfile` 后）加：
```typescript
  /** JWT for sand (Bot) inference, extracted from a session token. */
  sandJwt?: string;
```

新增导出（放 `presentedSecret` 前）：
```typescript
/** A session token looks like `user_...::<jwt>` (possibly URL-encoded `::`). */
export function extractSandJwt(value: string): string | undefined {
  const normalized = /%3a%3a/i.test(value) ? decodeURIComponent(value) : value;
  if (!normalized.includes("::")) return undefined;
  const jwt = normalized.split("::", 2)[1] ?? "";
  return jwt.split(".").length === 3 ? jwt : undefined;
}
```

`managedAccountAuth` 改签名：
```typescript
export function managedAccountAuth(
  apiKey: string,
  defaultProfile?: RuntimeProfile,
  sessionToken?: string,
): AuthContext {
  const sandJwt = sessionToken ? extractSandJwt(sessionToken) : undefined;
  return {
    mode: "managed",
    cursorApiKey: apiKey,
    fingerprint: credentialFingerprint(apiKey),
    ...(defaultProfile ? { defaultProfile } : {}),
    ...(sandJwt ? { sandJwt } : {}),
  };
}
```

BYOK 分支（`:35-42`）：若 presented 本身是 session token，抽 JWT：
```typescript
  const sandJwt = extractSandJwt(presented);
  return {
    mode: "byok",
    auth: {
      mode: "byok",
      cursorApiKey: presented,
      fingerprint: credentialFingerprint(presented),
      ...(sandJwt ? { sandJwt } : {}),
    },
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/auth/credentials.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/credentials.ts tests/auth/credentials.test.ts
git commit -m "feat: carry sand JWT in auth context"
```

### Task 4: `resolveManagedAuth` 从账号存储取 session token

**Files:**
- Modify: `src/server/app.ts:280`, `:328`（两处返回 auth 的 `managedAccountAuth` 调用）

- [ ] **Step 1: 实现（无独立单测，覆盖在端到端）** — 两处返回 auth 的调用带上账号的 session token：

`:280`：
```typescript
      if (bound) return managedAccountAuth(bound.apiKey, bound.defaultProfile, accounts.getSessionToken(bound.id));
```

`:328`：
```typescript
    return managedAccountAuth(selected.apiKey, selected.defaultProfile, accounts.getSessionToken(selected.id));
```

（`:298`/`:314`/`:315` 只取 fingerprint，不改。）

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: Commit**

```bash
git add src/server/app.ts
git commit -m "feat: resolve stored session token into managed auth"
```

### Task 5: 把 sandJwt 透传到 CreateAgentInput

**Files:**
- Modify: `src/sdk/port.ts:123-136` (CreateAgentInput/ResumeAgentInput)
- Modify: `src/core/sdk-run-driver.ts:14-16` (SdkAgentSource), `:106-127` (resolveAgent)
- Modify: `src/core/run-coordinator.ts:467-470,598,878,981-984`（4 处 agent input 构造）

- [ ] **Step 1: 实现（管道透传，端到端覆盖）** — 依次改：

`port.ts` `CreateAgentInput`（`:131` `hostedSearch` 后）加：
```typescript
  /** Session-token JWT for sand direct-connect inference. */
  sandJwt?: string;
```

`sdk-run-driver.ts` `SdkAgentSource`（`:14-15`）加字段：
```typescript
  | { type: "create"; apiKey: string; workspaceDir: string; sandJwt?: string }
  | { type: "resume"; agentId: string; apiKey: string; workspaceDir: string; sandJwt?: string }
```

`resolveAgent`（`:116-127`）两处传 `sandJwt: input.agent.sandJwt`：
```typescript
    if (input.agent.type === "resume") {
      return this.deps.sdk.resumeAgent({
        ...common,
        agentId: input.agent.agentId,
        apiKey: input.agent.apiKey,
        workspaceDir: input.agent.workspaceDir,
        sandJwt: input.agent.sandJwt,
      });
    }
    return this.deps.sdk.createAgent({
      ...common,
      apiKey: input.agent.apiKey,
      workspaceDir: input.agent.workspaceDir,
      sandJwt: input.agent.sandJwt,
    });
```

`run-coordinator.ts` 4 处 agent 构造，每处加 `sandJwt: auth.sandJwt`。例：
`:598`：
```typescript
          agent: { type: "create", apiKey: auth.cursorApiKey, workspaceDir: this.workspaceFor(profile), sandJwt: auth.sandJwt },
```
`:878` 同上。`:467-470` 与 `:981-984` 的 resume 各加 `sandJwt: auth.sandJwt,`。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: 全量测试确认无回归**

Run: `npx vitest run`
Expected: 全绿（管道字段可选，不改变现有行为）

- [ ] **Step 4: Commit**

```bash
git add src/sdk/port.ts src/core/sdk-run-driver.ts src/core/run-coordinator.ts
git commit -m "feat: plumb sand JWT to agent creation input"
```

## 段 3：sand 直连运行时

### Task 6: 流式增量 connect 帧解码器

**Files:**
- Modify: `src/sdk/sand-transcode.ts`（在文件末尾加 `createFrameDecoder`）
- Test: `tests/sdk/sand-transcode.test.ts`

现有 `decodeConnectEnvelopes` 一次性解全 buffer。流式需要"喂入字节块 → 吐出完整帧、保留半截"。

- [ ] **Step 1: 写失败测试** — 加：

```typescript
import { createFrameDecoder } from "../../src/sdk/sand-transcode.js";

describe("streaming frame decoder", () => {
  it("emits frames as bytes arrive across chunk boundaries", () => {
    const f1 = encodeConnectEnvelope(Uint8Array.from([1, 2, 3]), 0);
    const f2 = encodeConnectEnvelope(Uint8Array.from([4, 5]), 2);
    const whole = Uint8Array.from([...f1, ...f2]);
    const dec = createFrameDecoder();
    // feed first 4 bytes (partial header/payload) -> nothing complete yet
    const a = dec.push(whole.subarray(0, 4));
    expect(a).toEqual([]);
    // feed the rest -> both frames emerge in order
    const b = dec.push(whole.subarray(4));
    expect(b.map((f) => f.flag)).toEqual([0, 2]);
    expect([...b[0]!.payload]).toEqual([1, 2, 3]);
    expect([...b[1]!.payload]).toEqual([4, 5]);
  });

  it("holds an incomplete trailing frame until completed", () => {
    const f = encodeConnectEnvelope(Uint8Array.from([7, 7, 7]));
    const dec = createFrameDecoder();
    expect(dec.push(f.subarray(0, 6))).toEqual([]); // header + 1 byte
    const out = dec.push(f.subarray(6));
    expect(out).toHaveLength(1);
    expect([...out[0]!.payload]).toEqual([7, 7, 7]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sdk/sand-transcode.test.ts`
Expected: FAIL（`createFrameDecoder` 未定义）

- [ ] **Step 3: 实现** — 在 `sand-transcode.ts` 末尾加：

```typescript
export interface ConnectFrame { flag: number; payload: Uint8Array; }

/** Stateful decoder: push byte chunks, get back completed connect frames. */
export function createFrameDecoder(): { push(chunk: Uint8Array): ConnectFrame[] } {
  let buf = new Uint8Array(0);
  return {
    push(chunk: Uint8Array): ConnectFrame[] {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf, 0);
      merged.set(chunk, buf.length);
      buf = merged;
      const frames: ConnectFrame[] = [];
      let i = 0;
      while (i + 5 <= buf.length) {
        const flag = buf[i]!;
        const len = (buf[i + 1]! << 24) | (buf[i + 2]! << 16) | (buf[i + 3]! << 8) | buf[i + 4]!;
        const start = i + 5;
        const end = start + len;
        if (end > buf.length) break; // incomplete; wait for more
        frames.push({ flag, payload: buf.slice(start, end) });
        i = end;
      }
      buf = buf.slice(i);
      return frames;
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/sdk/sand-transcode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sdk/sand-transcode.ts tests/sdk/sand-transcode.test.ts
git commit -m "feat: streaming connect frame decoder for sand"
```

### Task 7: sand 直连 SdkAgent/SdkRun（多轮，内存累积历史）

**Files:**
- Create: `src/sdk/sand-runtime.ts`
- Test: `tests/sdk/sand-runtime.test.ts`

**多轮设计**：sand 无服务端 agent 状态，历史必须客户端累积。sand agent 持一个内存 `history: InferenceMessage[]`；每次 `send`：追加新 user 消息 → 编码全量 `msgs[]` 直连 POST → 流式解帧 → 完成后把 assistant 回复追加进 history（供下一轮）。`conversationId` 在 agent 生命周期内固定。

- [ ] **Step 1: 写失败测试**（用注入 fetch 返回预置 connect 帧，断言 delta 序列 + 历史累积）：

```typescript
import { describe, expect, it } from "vitest";
import { createSandAgent } from "../../src/sdk/sand-runtime.js";
import { encodeConnectEnvelope } from "../../src/sdk/sand-transcode.js";

function textFrame(s: string): Uint8Array {
  // field 1 { field 1 = text }
  const t = new TextEncoder().encode(s);
  const inner = Uint8Array.from([0x0a, t.length, ...t]);        // 1:LEN text
  const outer = Uint8Array.from([0x0a, inner.length, ...inner]); // 1:LEN part
  return encodeConnectEnvelope(outer, 0);
}
function endFrame(): Uint8Array {
  return encodeConnectEnvelope(new TextEncoder().encode("{}"), 2);
}
function fakeFetch(frames: Uint8Array[]) {
  const body = new ReadableStream<Uint8Array>({
    start(c) { frames.forEach((f) => c.enqueue(f)); c.close(); },
  });
  return async () => new Response(body, { status: 200, headers: { "content-type": "application/connect+proto" } });
}

describe("sand runtime", () => {
  it("streams text deltas and resolves wait() with accumulated text", async () => {
    const agent = createSandAgent({
      jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1",
      request: fakeFetch([textFrame("Hel"), textFrame("lo"), endFrame()]) as never,
    });
    const seen: string[] = [];
    const run = await agent.send({ text: "hi", onDelta: (u) => { if (u.type === "text-delta") seen.push(u.text); } });
    const result = await run.wait();
    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.status).toBe("finished");
    expect(result.result).toBe("Hello");
  });

  it("accumulates history across turns", async () => {
    const captured: string[] = [];
    const rec = (frames: Uint8Array[]) => async (_u: string, init: RequestInit) => {
      captured.push(Buffer.from(init!.body as Uint8Array).toString("latin1"));
      const body = new ReadableStream<Uint8Array>({ start(c){ frames.forEach(f=>c.enqueue(f)); c.close(); } });
      return new Response(body, { status: 200 });
    };
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: rec([textFrame("A"), endFrame()]) as never });
    await (await agent.send({ text: "first" })).wait();
    await (await agent.send({ text: "second" })).wait();
    // second request body must contain both "first" and the assistant reply "A" and "second"
    expect(captured[1]).toContain("second");
    expect(captured[1]).toContain("first");
    expect(captured[1]).toContain("A");
  });

  it("maps an error frame to an error result", async () => {
    const errFrame = encodeConnectEnvelope(new TextEncoder().encode('{"error":{"message":"boom"}}'), 2);
    const agent = createSandAgent({ jwt: "j.w.t", modelId: "grok-4.6", conversationId: "c1", request: fakeFetch([errFrame]) as never });
    const run = await agent.send({ text: "hi" });
    const result = await run.wait();
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("boom");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sdk/sand-runtime.test.ts`
Expected: FAIL（`createSandAgent` 未定义）

- [ ] **Step 3: 实现** — 创建 `src/sdk/sand-runtime.ts`（第一部分：编码 + 发起请求）：

```typescript
import {
  ROLE_USER, ROLE_ASSISTANT,
  encodeInferenceRequest, encodeConnectEnvelope,
  createFrameDecoder, decodeInferenceFrame,
  type InferenceMessage,
} from "./sand-transcode.js";
import type { SdkAgent, SdkRun, SdkRunResult, SdkSendInput, SdkStreamEvent, SdkDeltaUpdate } from "./port.js";

const SAND_URL = "https://api2.cursor.sh/aiserver.v1.InferenceService/Stream";

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
      history.push({ role: ROLE_USER, text: input.text });
      const body = encodeConnectEnvelope(encodeInferenceRequest({
        conversationId: init.conversationId,
        modelId: init.modelId,
        maxMode: true,
        params: init.modelParams ?? [{ id: "effort", value: "high" }, { id: "fast", value: "true" }],
        msgs: [...history],
      }));
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
    close() { /* no persistent resource */ },
  };
}
```

- [ ] **Step 4: 实现（第二部分：makeRun — 流式消费 + wait/stream）** — 追加到同文件：

```typescript
function makeRun(
  id: string,
  response: Response,
  history: InferenceMessage[],
  input: SdkSendInput,
): SdkRun {
  const events: SdkStreamEvent[] = [];
  let assembled = "";
  let thinking = "";
  let errorMsg: string | undefined;

  const consume = (async () => {
    const decoder = createFrameDecoder();
    const reader = response.body?.getReader();
    const handleFrame = (flag: number, payload: Uint8Array) => {
      if (flag & 2) {
        const trailer = new TextDecoder().decode(payload).trim();
        if (trailer && trailer !== "{}") {
          try {
            const parsed = JSON.parse(trailer) as { error?: { message?: string } };
            if (parsed.error) errorMsg = parsed.error.message || trailer;
          } catch { errorMsg = trailer; }
        }
        return;
      }
      const delta = decodeInferenceFrame(payload);
      if (delta.error) errorMsg = delta.error;
      if (delta.text) {
        assembled += delta.text;
        events.push({ type: "assistant", text: delta.text });
        void input.onDelta?.({ type: "text-delta", text: delta.text } as SdkDeltaUpdate);
      }
      if (delta.thinking) {
        thinking += delta.thinking;
        events.push({ type: "thinking", text: delta.thinking });
        void input.onDelta?.({ type: "thinking-delta", text: delta.thinking } as SdkDeltaUpdate);
      }
    };
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
    if (!errorMsg) {
      history.push({ role: ROLE_ASSISTANT, text: assembled });
      void input.onDelta?.({ type: "turn-ended" } as SdkDeltaUpdate);
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
    async cancel() { /* stream is buffered; nothing to abort post-hoc */ },
  };
}
```

注：usage 首版留空（sand 响应暂未解析 token 计数；ledger 会记 provisional）。可作后续增强。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/sdk/sand-runtime.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sdk/sand-runtime.ts tests/sdk/sand-runtime.test.ts
git commit -m "feat: direct-connect sand runtime agent with multi-turn history"
```

### Task 8: fork — sand + sandJwt → 直连运行时

**Files:**
- Modify: `src/sdk/cursor-runtime.ts:259-290` (bindAgent)
- Test: `tests/sdk/cursor-runtime-sand.test.ts`（新建，注入 fetch 验证 sand 分支）

- [ ] **Step 1: 写失败测试** — 验证 `createCursorRuntime` 在 sand profile + sandJwt 时走直连（不加载 clone）：

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCursorRuntime } from "../../src/sdk/cursor-runtime.js";
import { encodeConnectEnvelope } from "../../src/sdk/sand-transcode.js";

describe("cursor-runtime sand fork", () => {
  it("uses direct-connect sand agent when profile=sand and sandJwt present", async () => {
    // Note: this exercises the fork; the sand agent uses globalThis.fetch, so
    // stub it for the duration.
    const t = new TextEncoder().encode("ok");
    const inner = Uint8Array.from([0x0a, t.length, ...t]);
    const outer = Uint8Array.from([0x0a, inner.length, ...inner]);
    const frames = [encodeConnectEnvelope(outer, 0), encodeConnectEnvelope(new TextEncoder().encode("{}"), 2)];
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sdk/cursor-runtime-sand.test.ts`
Expected: FAIL（当前 sand 走 clone，会尝试打补丁真实 SDK 或行为不符）

- [ ] **Step 3: 实现** — 在 `bindAgent` 开头（`:260` 后、`:263` 前）加直连分支：

```typescript
    const profile = input.runtimeProfile ?? DEFAULT_RUNTIME_PROFILE;
    // Sand inference cannot go through the SDK (no InferenceService binding);
    // when a session-token JWT is available, drive it via direct connect.
    if (profile === "sand" && input.sandJwt) {
      const conversationId = "agentId" in input ? input.agentId : globalThis.crypto.randomUUID();
      return createSandAgent({
        jwt: input.sandJwt,
        modelId: input.modelId,
        conversationId,
        modelParams: input.modelParams,
      });
    }
```

文件顶部 import：
```typescript
import { createSandAgent } from "./sand-runtime.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/sdk/cursor-runtime-sand.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试**

Run: `npx vitest run`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/sdk/cursor-runtime.ts tests/sdk/cursor-runtime-sand.test.ts
git commit -m "feat: route sand inference through direct-connect runtime"
```

## 段 4：收尾

### Task 9: BFLABS 文档 + 真实账号冒烟

**Files:**
- Modify: `BFLABS.md`（记录 sand 推理走直连 InferenceService，非 SDK）
- 冒烟：手动，无代码

- [ ] **Step 1: 更新 BFLABS.md** — 在 sand 相关章节加一段：

```markdown
## Sand (Grok Bot) 推理路径

sand profile 的推理不走 `@cursor/sdk`（1.0.30 无 InferenceService 绑定），而是
直连 `api2.cursor.sh/aiserver.v1.InferenceService/Stream`（`src/sdk/sand-runtime.ts`）。
鉴权用 session-token 的 JWT（非 crsr_ key）；client-version 头须带 `cli-` 前缀。
打补丁的 hash-guarded SDK clone（`sand-loader`）保留但不再用于推理。
```

- [ ] **Step 2: Commit 文档**

```bash
git add BFLABS.md
git commit -m "docs: record sand direct-connect inference path"
```

- [ ] **Step 3: 真实账号端到端冒烟**（需一个 sand-granted 账号的 session token）

1. 起网关：`npm run dev`
2. onboard 一个 sand 账号并存 token：
   ```bash
   curl -sX POST localhost:PORT/v0/management/accounts/onboard \
     -H 'authorization: Bearer <gateway-key>' -H 'content-type: application/json' \
     -d '{"session_token":"user_...::<jwt>","store_session_token":true,"claim_sand":true}'
   ```
3. 用 sand profile 发一条 `/v1/messages`（managed 模式会用该账号），确认返回 Bot 文本：
   ```bash
   curl -sX POST localhost:PORT/v1/messages \
     -H 'authorization: Bearer <gateway-key>' \
     -H 'x-cursor-runtime-profile: sand' -H 'content-type: application/json' \
     -d '{"model":"grok-4.6","max_tokens":256,"messages":[{"role":"user","content":"say hello"}]}'
   ```
   Expected: 200 + 助手文本；网关日志显示 sand 直连、无 403/ERROR_OUTDATED_CLIENT。
4. （可选）dashboard 查 Bot 用量 `usagePercent` 从 0 上升，确认计到 Bot 额度。

- [ ] **Step 4: 冒烟通过后，最终确认全量测试 + 类型**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿 + EXIT 0

---

## 备注

- **usage 计数**：首版 sand 响应不解析 token usage，ledger 记 provisional receipt。后续可从 sand 响应尾帧解析真实 usage。
- **JWT 过期**：session token 带 `offline_access`，样本 ~43 天。到期后 sand 请求会返回鉴权错误 → 走现有 `mapSdkFailure` 报错。自动刷新（session token 换新 JWT）是后续增强，不在本计划。
- **多账号轮转**：managed 模式下 sand 账号需存了 session token 才能被 sand 请求选中；没存 token 的账号遇 sand profile 会因 `sandJwt` 缺失回落到 clone 分支（当前 403）。account pick 逻辑是否要按"有无 sand token"过滤，属后续优化。

## 实现后 follow-up（最终整体评审提出，非阻塞）

实现已完成并全绿（416 测试 / tsc 干净），以下为集成缝处的观察，建议开后续 ticket：

- **resume 丢历史**：`createSandAgent` 的多轮历史存在内存闭包里；resume/recovery 路径（`cursor-runtime.ts` 用 `input.agentId` 当 conversationId，但建的是空历史的新 agent）会丢掉此前轮次。需确认 InferenceService 是否按 conversationId 服务端 rehydrate；若否，resumed sand 会话会静默丢上下文。首版单会话（同一 agent 实例内多轮）不受影响。
- **静默 403 回落**：managed sand 账号若没存 session token，会回落到 clone 分支（实跑 403），操作者只看到通用上游错误、看不出根因是缺 session token。建议：sand profile 且 `sandJwt` 缺失时给一个明确错误，或在 `publicAccount` 暴露 `hasSessionToken` 让操作者能识别哪些账号 sand-ready。
- **真实账号端到端冒烟**：Task 9 的手动冒烟仍需用一个 sand-granted 账号跑一次（见 Task 9 Step 3），确认线上真出 Bot 文本、计到 Bot 额度。









