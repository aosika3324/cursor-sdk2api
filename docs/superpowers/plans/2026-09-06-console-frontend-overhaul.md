# 操作控制台前端改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 bflabs 视觉语言的前提下，为操作控制台补齐登录鉴权、模态框富编辑、统一强化的额度进度条、SSE 实时日志(运行日志流 + 请求活动面板，容量运行时可调)、一套表单原语，并把 1100 行 App.tsx 拆成 context + hooks。

**Architecture:** 后端在现有 flat `if (path===...)` 路由链前插入 session 认证中间件(复用 `GATEWAY_ACCESS_KEY`)；新增内存环形缓冲的日志 sink 与请求遥测采集器 + SSE 端点。前端扩展 bflabs 设计系统加表单原语与 Modal，App.tsx 状态拆成 context/hooks，5 个 UI 块复用这些地基。全程严格用 bflabs tokens。

**Tech Stack:** TypeScript (ESM), Node http, vitest, React 18 (hash 路由，无 router 库), Vite, EventSource/SSE, connect+proto 无关。

**参考 spec:** `docs/superpowers/specs/2026-09-06-console-frontend-overhaul-design.md`

**设计质量:** 新前端组件/布局用 `frontend-design` 技能，但严格约束在 `web/src/bflabs/styles/tokens.css` 的 tokens 内。

---

## 关键现状锚点(实现前必读)

- 后端请求处理：`src/server/app.ts` `handler`(~427)。`serveConsole`(~433)先处理 `/console/*` 静态。管理路由是从 ~495 开始的 flat `if (path === "/v0/management/..." && method===...)` 链，**目前全部无认证**。
- HTTP 工具：`src/server/http-util.ts` 已有 `writeSse(res,event,data)`、`writeDataFrame`、`headerValue`、`requestPath`、`sendJson`、`clientAborted`、`abortSignalFromRequest`。
- 认证：`src/auth/credentials.ts` `authorizeClient` 仅用于 `/v1/*`；managed 模式校验 Bearer===`config.gatewayAccessKey`(`config.ts:129`)。
- 前端 API：`web/src/api.ts` `managementJson`/`settingsJson` 同源 fetch，无 auth 头。
- 前端 shell：`web/src/App.tsx`(1100 行，全部状态/i18n COPY/数据获取)；hash 路由 `web/src/nav.ts`(`Page` 联合类型)；侧栏 `web/src/RailNav.tsx`。
- 设计系统：`web/src/bflabs/`(Button/Card/Tabs/StatusTag/Notice/CountUp/Reveal/BFTheme/icons)，CSS `web/src/bflabs/styles/{tokens,base,components,index}.css`。**无表单原语、无 Modal**。
- 额度：`web/src/pages/QuotaMeters.tsx`(`bf-progress`)+ `web/src/pages/QuotaDetail.tsx`(自有 `quota-meter`)两套；百分比 `web/src/quota.ts`。
- 测试：`vitest run`。契约测试在 `tests/contract/`，用注入 fetch / `tests/helpers/app.ts` 起测试服务器。

## 文件结构(新建/修改)

**后端**
- `src/server/console-auth.ts`(新)：session store(内存，TTL)、`createSession`/`validateSession`/`destroySession`、cookie 读写、`requireConsoleSession` 中间件判定。
- `src/server/app.ts`(改)：注册 `/v0/management/auth/{login,logout,session}`；在管理路由链前插入 session 校验；新增日志/活动/容量端点；HTTP 入口采集客户端 IP + 请求遥测收尾。
- `src/core/log-sink.ts`(新)：内存环形缓冲 + 订阅者广播 + 运行时容量档位。
- `src/core/request-telemetry.ts`(新)：请求活动环形缓冲(账号/时间/IP/模型/状态/凭据/耗时)、RPM 计算、订阅者广播、容量档位。
- `src/server/log-routes.ts`(新)：`/v0/management/logs/stream`、`/logs/capacity`(GET/PUT)、`/activity/stream`、`/activity/stats` 的处理函数(用 `writeSse`)。

**前端**
- `web/src/bflabs/Input.tsx`/`Select.tsx`/`Textarea.tsx`/`Checkbox.tsx`/`Switch.tsx`/`Field.tsx`/`Modal.tsx`(新)+ `bflabs/styles/components.css` 加 `bf-input`/`bf-select`/`bf-checkbox`/`bf-switch`/`bf-modal`。
- `web/src/state/`(新)：`AuthContext.tsx`、`I18nContext.tsx`、`AppStateContext.tsx`、hooks `useRoster.ts`/`useHealth.ts`/`useSettings.ts`/`useAuth.ts`/`useLogStream.ts`/`useActivityStream.ts`。
- `web/src/pages/LoginPage.tsx`(新)、`web/src/pages/LogsPage.tsx`(新)、`web/src/pages/AccountEditModal.tsx`(新)。
- `web/src/bflabs/Meter.tsx`(新，统一 QuotaMeters+QuotaDetail)。
- `web/src/api.ts`(改：credentials、401 处理、新端点)、`web/src/nav.ts`(改：加 `login`/`logs`)、`web/src/App.tsx`(拆分)、`web/src/RailNav.tsx`(加 logs 项)。

## 阶段与任务

阶段 F(地基) → 阶段 A(登录) → 阶段 B(布局/表单) → 阶段 C(编辑) → 阶段 D(额度) → 阶段 E(SSE 日志)。每阶段结束应可独立构建通过。

## 阶段 F：后端地基单元(纯逻辑，易 TDD)

### Task F1: 内存环形日志 sink，容量运行时可调

**Files:**
- Create: `src/core/log-sink.ts`
- Test: `tests/core/log-sink.test.ts`

档位白名单 `[20,30,50,100,200,300]`，默认 50。存 `LogEntry`。改小容量时立即裁剪最旧。支持订阅广播(SSE 用)。

- [ ] **Step 1: 写失败测试** `tests/core/log-sink.test.ts`

```typescript
import { describe, expect, it, vi } from "vitest";
import { LogSink, LOG_CAPACITY_STEPS } from "../../src/core/log-sink.js";

describe("LogSink", () => {
  it("defaults to capacity 50 and exposes the step whitelist", () => {
    const sink = new LogSink();
    expect(sink.capacity).toBe(50);
    expect(LOG_CAPACITY_STEPS).toEqual([20, 30, 50, 100, 200, 300]);
  });

  it("keeps only the most recent N entries at capacity", () => {
    const sink = new LogSink(20);
    for (let i = 0; i < 25; i++) sink.push({ level: "info", msg: `m${i}`, at: i });
    const recent = sink.recent();
    expect(recent).toHaveLength(20);
    expect(recent[0]!.msg).toBe("m5");
    expect(recent[19]!.msg).toBe("m24");
  });

  it("trims oldest immediately when capacity is lowered", () => {
    const sink = new LogSink(100);
    for (let i = 0; i < 80; i++) sink.push({ level: "info", msg: `m${i}`, at: i });
    sink.setCapacity(30);
    expect(sink.capacity).toBe(30);
    expect(sink.recent()).toHaveLength(30);
    expect(sink.recent()[0]!.msg).toBe("m50");
  });

  it("rejects a capacity not in the whitelist", () => {
    const sink = new LogSink();
    expect(() => sink.setCapacity(999)).toThrow();
    expect(sink.capacity).toBe(50);
  });

  it("broadcasts pushed entries to subscribers and supports unsubscribe", () => {
    const sink = new LogSink();
    const seen: string[] = [];
    const unsub = sink.subscribe((e) => seen.push(e.msg));
    sink.push({ level: "info", msg: "a", at: 1 });
    unsub();
    sink.push({ level: "info", msg: "b", at: 2 });
    expect(seen).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/log-sink.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现** `src/core/log-sink.ts`

```typescript
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
    for (const sub of this.subs) sub(entry);
  }

  recent(): LogEntry[] {
    return [...this.buf];
  }

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/log-sink.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/log-sink.ts tests/core/log-sink.test.ts
git commit -m "feat: in-memory ring log sink with runtime-adjustable capacity"
```

### Task F2: 请求遥测采集器(活动缓冲 + RPM)

**Files:**
- Create: `src/core/request-telemetry.ts`
- Test: `tests/core/request-telemetry.test.ts`

存 `ActivityEntry`(account hint、at、clientIp、model、status、credentialId hint、durationMs)。同样容量档位(复用 `LOG_CAPACITY_STEPS`)。RPM = 最近 60s 记录数(注入 `now` 便于测试)。订阅广播。

- [ ] **Step 1: 写失败测试** `tests/core/request-telemetry.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { RequestTelemetry, type ActivityEntry } from "../../src/core/request-telemetry.js";

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  account: "acct_x", at: 1000, clientIp: "1.2.3.4", model: "grok-4.6",
  status: 200, credentialId: "••••abcd", durationMs: 12, ...over,
});

describe("RequestTelemetry", () => {
  it("defaults capacity 50 and rings the buffer", () => {
    const t = new RequestTelemetry(20);
    for (let i = 0; i < 25; i++) t.record(entry({ at: i }));
    expect(t.recent()).toHaveLength(20);
    expect(t.recent()[0]!.at).toBe(5);
  });

  it("setCapacity trims oldest and rejects non-whitelist", () => {
    const t = new RequestTelemetry(100);
    for (let i = 0; i < 60; i++) t.record(entry({ at: i }));
    t.setCapacity(30);
    expect(t.recent()).toHaveLength(30);
    expect(() => t.setCapacity(7)).toThrow();
  });

  it("computes RPM as records within the last 60s", () => {
    const t = new RequestTelemetry(300);
    const now = 1_000_000;
    t.record(entry({ at: now - 70_000 })); // outside window
    t.record(entry({ at: now - 30_000 }));
    t.record(entry({ at: now - 1_000 }));
    expect(t.rpm(now)).toBe(2);
  });

  it("broadcasts recorded entries", () => {
    const t = new RequestTelemetry();
    const seen: number[] = [];
    const unsub = t.subscribe((e) => seen.push(e.status));
    t.record(entry({ status: 429 }));
    unsub();
    t.record(entry({ status: 200 }));
    expect(seen).toEqual([429]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/request-telemetry.test.ts`

- [ ] **Step 3: 实现** `src/core/request-telemetry.ts`

```typescript
import { LOG_CAPACITY_STEPS, type LogCapacity } from "./log-sink.js";

export interface ActivityEntry {
  account: string;
  at: number;
  clientIp: string;
  model: string;
  status: number;
  credentialId: string;
  durationMs: number;
}

type Subscriber = (entry: ActivityEntry) => void;

export class RequestTelemetry {
  private buf: ActivityEntry[] = [];
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
      throw new Error(`invalid activity capacity ${capacity}`);
    }
    this.cap = capacity;
    if (this.buf.length > this.cap) this.buf = this.buf.slice(this.buf.length - this.cap);
  }

  record(entry: ActivityEntry): void {
    this.buf.push(entry);
    if (this.buf.length > this.cap) this.buf.shift();
    for (const sub of this.subs) sub(entry);
  }

  recent(): ActivityEntry[] {
    return [...this.buf];
  }

  rpm(now: number): number {
    const cutoff = now - 60_000;
    return this.buf.filter((e) => e.at >= cutoff).length;
  }

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/request-telemetry.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/core/request-telemetry.ts tests/core/request-telemetry.test.ts
git commit -m "feat: request telemetry buffer with RPM and adjustable capacity"
```

### Task F3: 控制台 session store + cookie 工具(纯单元)

**Files:**
- Create: `src/server/console-auth.ts`
- Test: `tests/server/console-auth.test.ts`

内存 session store：`create(now)` 生成随机 token(`crypto.randomBytes` hex)、记 `expiresAt = now + TTL`(默认 12h)；`validate(token, now)` 有效返回 true 并滑动续期(可选，先不续期，保持简单)；`destroy(token)`；过期自动失效。cookie 名 `bf_console_session`。`parseCookie(header, name)` 与 `serializeSessionCookie(token, {secure})`(httpOnly、SameSite=Strict、Path=/)。

- [ ] **Step 1: 写失败测试** `tests/server/console-auth.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import {
  ConsoleSessionStore, CONSOLE_COOKIE, parseCookie, serializeSessionCookie,
} from "../../src/server/console-auth.js";

describe("ConsoleSessionStore", () => {
  it("creates a token that validates before expiry and fails after", () => {
    const store = new ConsoleSessionStore(1000); // ttlMs = 1000
    const now = 10_000;
    const token = store.create(now);
    expect(token).toMatch(/^[0-9a-f]{32,}$/);
    expect(store.validate(token, now + 500)).toBe(true);
    expect(store.validate(token, now + 2000)).toBe(false);
  });

  it("rejects unknown or destroyed tokens", () => {
    const store = new ConsoleSessionStore();
    const now = 0;
    const token = store.create(now);
    expect(store.validate("nope", now)).toBe(false);
    store.destroy(token);
    expect(store.validate(token, now)).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("parses a named cookie from a header", () => {
    expect(parseCookie("a=1; bf_console_session=abc; b=2", CONSOLE_COOKIE)).toBe("abc");
    expect(parseCookie("", CONSOLE_COOKIE)).toBeUndefined();
    expect(parseCookie("other=x", CONSOLE_COOKIE)).toBeUndefined();
  });

  it("serializes a hardened session cookie", () => {
    const c = serializeSessionCookie("tok", { secure: true });
    expect(c).toContain(`${CONSOLE_COOKIE}=tok`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).toContain("Secure");
    const insecure = serializeSessionCookie("tok", { secure: false });
    expect(insecure).not.toContain("Secure");
  });

  it("serializes an expiring clear cookie", () => {
    const c = serializeSessionCookie("", { secure: false, maxAge: 0 });
    expect(c).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/console-auth.test.ts`

- [ ] **Step 3: 实现** `src/server/console-auth.ts`

```typescript
import { randomBytes } from "node:crypto";

export const CONSOLE_COOKIE = "bf_console_session";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export class ConsoleSessionStore {
  private sessions = new Map<string, number>(); // token -> expiresAt
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(now: number = Date.now()): string {
    const token = randomBytes(24).toString("hex");
    this.sessions.set(token, now + this.ttlMs);
    return token;
  }

  validate(token: string, now: number = Date.now()): boolean {
    const expiresAt = this.sessions.get(token);
    if (expiresAt === undefined) return false;
    if (now >= expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function serializeSessionCookie(
  token: string,
  opts: { secure: boolean; maxAge?: number },
): string {
  const parts = [`${CONSOLE_COOKIE}=${token}`, "HttpOnly", "SameSite=Strict", "Path=/"];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/console-auth.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/server/console-auth.ts tests/server/console-auth.test.ts
git commit -m "feat: console session store and cookie helpers"
```

## 阶段 A：登录 + 锁管理接口

### Task A1: auth 端点 + 管理路由认证中间件

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/contract/console-auth-routes.test.ts`

在 `createApp` 内实例化 `const consoleSessions = new ConsoleSessionStore();`。在 handler 里、**管理路由链(~495)之前**加：
1. `POST /v0/management/auth/login`：读 body `{ access_key }`；managed 模式校验 `access_key === config.gatewayAccessKey`；成功 `consoleSessions.create()` → `Set-Cookie` session cookie(secure 取决于 `x-forwarded-proto === "https"` 或 config)→ 200 `{ ok: true }`；失败 401。BYOK 模式(无 `gatewayAccessKey`)：登录端点返回 501 `{ error: "console auth unavailable in byok mode" }`(本次不支持，spec 已定)。
2. `POST /v0/management/auth/logout`：读 cookie token → `destroy` → 清 cookie(maxAge 0)→ 200。
3. `GET /v0/management/auth/session`：cookie 有效 → 200 `{ authenticated: true }`，否则 200 `{ authenticated: false }`(不 401，供前端判断是否跳登录)。
4. **中间件**：对所有其它 `/v0/management/*`(不含上述 3 个 auth 端点)：若 managed 模式，校验 cookie session；无效 → 401 `{ error: "unauthorized" }`。BYOK 模式不锁(无凭证可校验)。

用 `parseCookie(headerValue(req,"cookie"), CONSOLE_COOKIE)` 取 token。secure 判定：`headerValue(req,"x-forwarded-proto")==="https" || config.??`(简单起见用 x-forwarded-proto，回落 false)。

- [ ] **Step 1: 写失败测试** `tests/contract/console-auth-routes.test.ts`

用 `tests/helpers/app.ts` 的 `startTestApp` 起 managed 模式服务器(`config: { authMode: "managed", gatewayAccessKey: "secret-key" }`)。测试(读现有 contract 测试确认 startTestApp 的确切用法与返回：base URL / fetch)：

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp } from "../helpers/app.js";

describe("console auth routes (managed)", () => {
  let app: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    app = await startTestApp({ config: { authMode: "managed", gatewayAccessKey: "secret-key" } });
  });
  afterAll(async () => { await app.close(); });

  const url = (p: string) => `${app.baseUrl}${p}`;

  it("rejects management calls without a session (401)", async () => {
    const res = await fetch(url("/v0/management/accounts"), { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("login with wrong key is 401", async () => {
    const res = await fetch(url("/v0/management/auth/login"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("login sets a session cookie that unlocks management", async () => {
    const login = await fetch(url("/v0/management/auth/login"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "secret-key" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("bf_console_session=");
    const token = /bf_console_session=([^;]+)/.exec(cookie)![1];
    const list = await fetch(url("/v0/management/accounts"), {
      headers: { cookie: `bf_console_session=${token}` },
    });
    expect(list.status).toBe(200);
    const session = await fetch(url("/v0/management/auth/session"), {
      headers: { cookie: `bf_console_session=${token}` },
    });
    expect((await session.json()).authenticated).toBe(true);
  });

  it("session endpoint reports false without a cookie", async () => {
    const res = await fetch(url("/v0/management/auth/session"));
    expect((await res.json()).authenticated).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/contract/console-auth-routes.test.ts`
Expected: FAIL(未锁，`/accounts` 返回 200 而非 401；auth 端点 404)

- [ ] **Step 3: 实现** 按上文在 `src/server/app.ts` 加端点 + 中间件。import `ConsoleSessionStore, CONSOLE_COOKIE, parseCookie, serializeSessionCookie` from `./console-auth.js`。中间件放在 auth 端点之后、其余管理路由之前，形如：

```typescript
      // Console auth endpoints (always reachable).
      if (path === "/v0/management/auth/login" && method === "POST") { /* ... */ }
      if (path === "/v0/management/auth/logout" && method === "POST") { /* ... */ }
      if (path === "/v0/management/auth/session" && method === "GET") { /* ... */ }
      // Gate the rest of the management surface in managed mode.
      if (path.startsWith("/v0/management/") && config.authMode === "managed") {
        const token = parseCookie(headerValue(req, "cookie"), CONSOLE_COOKIE);
        if (!token || !consoleSessions.validate(token)) {
          sendJson(res, 401, { error: "unauthorized" }, requestId);
          return;
        }
      }
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `npx vitest run tests/contract/console-auth-routes.test.ts`
Run: `npx vitest run`(注意：现有管理契约测试若跑在 managed 模式会因为新中间件 401 —— 若有，需给它们注入登录 cookie 或让它们用 byok 模式。排查并修，报告改了哪些测试。)

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/contract/console-auth-routes.test.ts
git commit -m "feat: console login/logout/session endpoints and management auth gate"
```

### Task A2: 让 logger 喂 LogSink，HTTP 入口采集遥测

**Files:**
- Modify: `src/server/app.ts`（实例化 sink/telemetry；在响应收尾记录遥测），`src/index.ts` 或 logger 构造处（tee 日志到 sink）
- Test: `tests/contract/telemetry-capture.test.ts`

在 `createApp` 内 `const logSink = new LogSink(); const telemetry = new RequestTelemetry();`。两点接线：
1. **日志 tee**：找到 `logger`（`createApp` 入参）产生结构化行的地方。最小侵入做法：包一层 logger，使每次 `logger.info/warn/error` 除原输出外也 `logSink.push({level,msg,at:clock.now(),...fields})`。若 logger 是简单对象，在 `createApp` 里用一个 wrapping logger 传给下游。
2. **遥测采集**：在数据面请求（`/v1/*`）收尾处（成功或错误发送响应后），`telemetry.record({ account: fingerprintHint, at: clock.now(), clientIp, model, status, credentialId, durationMs })`。`clientIp` = `headerValue(req,"x-forwarded-for")?.split(",")[0]?.trim() || req.socket.remoteAddress || ""`。`durationMs` 用请求开始时间戳。model/status 从已解析请求与响应状态取。

先只对 `/v1/messages`、`/v1/chat/completions`、`/v1/responses` 采集（主推理路径）。

- [ ] **Step 1: 写失败测试** `tests/contract/telemetry-capture.test.ts`：起测试 app（注入 fake sdk 让一次 `/v1/messages` 成功），登录取 cookie，调一次推理，再 `GET /v0/management/activity/stats`（Task A3 加）——**因 stats 端点尚未存在，本测试依赖 A3**。为避免跨任务耦合，本任务改为直接单元验证遥测采集器被调用：注入一个 spy telemetry 到 createApp（把 `logSink`/`telemetry` 提为可选入参 `input.logSink?`/`input.telemetry?`，默认内部 new）。测试注入 spy，跑一次 `/v1/messages`，断言 `telemetry.recent()` 有一条含正确 clientIp/status/model。

```typescript
// 关键断言（构造细节参照现有 tests/contract 里 /v1/messages 的跑法）：
const t = new RequestTelemetry();
app = await startTestApp({ config: { authMode: "byok" }, telemetry: t }); // byok 免登录，聚焦遥测
// ...发一次 /v1/messages（带 x-forwarded-for: 9.9.9.9）...
const rec = t.recent();
expect(rec).toHaveLength(1);
expect(rec[0]!.clientIp).toBe("9.9.9.9");
expect(rec[0]!.status).toBe(200);
```

（需给 `createApp` 和 `startTestApp` 加可选 `logSink`/`telemetry` 注入入参。）

- [ ] **Step 2-4:** 跑失败 → 实现注入入参 + tee + 采集 → 跑通过 + 全量 `npx vitest run`。

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/contract/telemetry-capture.test.ts tests/helpers/app.ts
git commit -m "feat: tee logs to sink and capture request telemetry with client IP"
```

### Task A3: 日志/活动 SSE + 容量端点

**Files:**
- Create: `src/server/log-routes.ts`
- Modify: `src/server/app.ts`（挂载，位于管理认证中间件之后）
- Test: `tests/contract/log-routes.test.ts`

端点（均在管理认证之后，managed 模式需 cookie）：
- `GET /v0/management/logs/capacity` → `{ capacity, steps: LOG_CAPACITY_STEPS }`
- `PUT /v0/management/logs/capacity` body `{ capacity }` → 校验白名单，`logSink.setCapacity` + `telemetry.setCapacity`（两者同步），返回新值；非白名单 400。
- `GET /v0/management/logs/stream`（SSE）：先回放 `logSink.recent()`，再订阅推送；`clientAborted`/`res.on("close")` 时 unsubscribe。用 `writeSse(res,"log",entry)`。
- `GET /v0/management/activity/stream`（SSE）：回放 `telemetry.recent()` + 订阅，`writeSse(res,"activity",entry)`。
- `GET /v0/management/activity/stats` → `{ rpm: telemetry.rpm(clock.now()) }`。

SSE 响应头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`（参照现有推理 SSE 写法 `res.writeHead`）。

- [ ] **Step 1: 写失败测试** `tests/contract/log-routes.test.ts`（managed + 登录 cookie）：
  - `PUT /logs/capacity {capacity:100}` → 200 `{capacity:100}`；`{capacity:7}` → 400。
  - `GET /logs/capacity` → `{capacity:100, steps:[20,30,50,100,200,300]}`。
  - `GET /activity/stats` → `{rpm: <number>}`。
  - SSE：用 fetch 读 `/logs/stream` 的前几个字节确认 `content-type: text/event-stream`（不必解析完整流，读到 header 即断开）。

- [ ] **Step 2-4:** 跑失败 → 实现 `log-routes.ts` 导出 `handleLogRoutes(req,res,{path,method,logSink,telemetry,clock,requestId})` 返回 boolean（命中即处理），在 app.ts 认证后调用 → 跑通过 + 全量。

- [ ] **Step 5: Commit**

```bash
git add src/server/log-routes.ts src/server/app.ts tests/contract/log-routes.test.ts
git commit -m "feat: SSE log/activity streams and runtime capacity endpoints"
```

## 阶段 B：前端地基（表单原语 + App 拆分）

### Task B1: bflabs 表单原语 + Modal

**Files:**
- Create: `web/src/bflabs/Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Checkbox.tsx`, `Switch.tsx`, `Field.tsx`, `Modal.tsx`
- Modify: `web/src/bflabs/styles/components.css`（加 `bf-input`/`bf-select`/`bf-textarea`/`bf-checkbox`/`bf-switch`/`bf-field`/`bf-modal`，用 tokens：`--bf-control-md`、`--bf-radius-control`、`--bf-focus`、`--bf-divider`、`--bf-surface`、`--bf-space-*`）
- Test: `web/src/bflabs/__tests__/forms.test.tsx`

用 `frontend-design` 技能确保视觉贴合 bflabs（工业小圆角、橙色 focus 环、charcoal/warm-white）。组件用 `forwardRef`，转发原生属性，`cx` 合类名。`Field` 包 label + 可选 error/hint + `aria-describedby`/`aria-invalid`。`Modal`：`role=dialog aria-modal`、焦点陷阱、Esc 关闭、点遮罩关闭、打开时锁 body 滚动、关闭恢复焦点。

- [ ] **Step 1: 写失败测试**（用 @testing-library/react，若未装则 `npm i -D @testing-library/react @testing-library/user-event jsdom` 并在 vitest 配置 jsdom 环境；先确认 web 是否已有组件测试环境，没有则本步含环境搭建）。测试要点：
  - `Input` 渲染并转发 `value`/`onChange`/`placeholder`，带 `bf-input` 类。
  - `Field` 有 error 时渲染 error 文本且给子 input `aria-invalid`。
  - `Checkbox`/`Switch` 受控切换回调。
  - `Modal` open=false 不渲染内容；open=true 渲染，Esc 触发 `onClose`，聚焦首个可聚焦元素。

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../Input";
import { Field } from "../Field";
import { Modal } from "../Modal";

it("Input forwards value and onChange", () => {
  const onChange = vi.fn();
  render(<Input value="hi" onChange={onChange} placeholder="name" />);
  const el = screen.getByPlaceholderText("name") as HTMLInputElement;
  expect(el.value).toBe("hi");
  fireEvent.change(el, { target: { value: "yo" } });
  expect(onChange).toHaveBeenCalled();
});

it("Field shows error and marks the control invalid", () => {
  render(<Field label="Name" error="required"><Input aria-label="n" /></Field>);
  expect(screen.getByText("required")).toBeTruthy();
  expect(screen.getByLabelText("n").getAttribute("aria-invalid")).toBe("true");
});

it("Modal calls onClose on Escape and renders only when open", () => {
  const onClose = vi.fn();
  const { rerender } = render(<Modal open={false} onClose={onClose} title="T">body</Modal>);
  expect(screen.queryByText("body")).toBeNull();
  rerender(<Modal open onClose={onClose} title="T">body</Modal>);
  expect(screen.getByText("body")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑失败** `npx vitest run web/src/bflabs/__tests__/forms.test.tsx`
- [ ] **Step 3: 实现** 7 个组件 + CSS。每个组件用现有 bflabs 组件（如 Button）同款 data-slot/类名风格。
- [ ] **Step 4: 跑通过** + `npm run typecheck:web`
- [ ] **Step 5: Commit**

```bash
git add web/src/bflabs/*.tsx web/src/bflabs/styles/components.css web/src/bflabs/__tests__/ web/package.json web/vite.config.ts vitest.config.* 2>/dev/null
git commit -m "feat: bflabs form primitives and modal"
```

### Task B2: App.tsx 拆分为 context + hooks

**Files:**
- Create: `web/src/state/I18nContext.tsx`（迁移 App.tsx 的 COPY + lang + `t`）、`AppStateContext.tsx`（roster/health/settings + 刷新方法）、`AuthContext.tsx`（登录态 + login/logout）、hooks `useRoster.ts`/`useHealth.ts`/`useSettings.ts`/`useAuth.ts`
- Modify: `web/src/App.tsx`（瘦身为 shell + 路由 switch + Provider 包裹）、页面改从 context 取数据
- Test: `web/src/state/__tests__/context.test.tsx`

**这是重构，非新功能 —— 行为必须不变。** 先加 context/hooks，把 App.tsx 的状态逐步迁入，页面改用 `useContext` 而非 props。分小步：一次迁一块状态，每步 `npm run typecheck:web` + 现有测试绿。

- [ ] **Step 1:** 写 context 骨架 + 一个 hook 的测试（如 `useHealth` 在 provider 下返回 health、轮询）。
- [ ] **Step 2-4:** 逐块迁移（i18n → app-state → auth），每块迁完 typecheck + build。页面签名从 `(props: {t, roster, ...})` 改为无数据 props（从 context 取）。
- [ ] **Step 5: Commit**（可拆多个 commit：`refactor: extract i18n context`、`refactor: extract app-state context`、`refactor: extract auth context`）

```bash
git add web/src/state web/src/App.tsx web/src/pages
git commit -m "refactor: split App.tsx into context and hooks"
```

## 阶段 C：登录页 + api 认证处理

### Task C1: api.ts credentials + 401 处理，登录页

**Files:**
- Modify: `web/src/api.ts`（管理/设置 fetch 加 `credentials: "same-origin"`；封装 401 → 抛可识别的 `UnauthorizedError`；加 `login(accessKey)`/`logout()`/`getSession()`）、`web/src/nav.ts`（`Page` 加 `"login"`）
- Create: `web/src/pages/LoginPage.tsx`
- Modify: `web/src/App.tsx`（未登录时渲染 LoginPage；`AuthContext` 驱动）、`web/src/state/useAuth.ts`
- Test: `web/src/pages/__tests__/login.test.tsx` + `web/src/__tests__/api-auth.test.ts`

`LoginPage`：bflabs 居中卡片，`Field` + `Input type=password`（access key），提交调 `login`，错误显示 `Notice`（danger tone）。`useAuth` 启动查 `getSession()`；未登录 → 显示登录页；登录成功刷新 session 并进入应用；任何管理请求遇 `UnauthorizedError` → 置未登录（回登录页）。

- [ ] **Step 1: 写失败测试**：`api-auth.test.ts` 用 mock fetch 断言 `login` POST 到 `/v0/management/auth/login` 带 `{access_key}` 且 `credentials`；401 时 `getSettings()` 抛 `UnauthorizedError`。`login.test.tsx` 断言错误 key 显示错误、正确 key 调 `onAuthenticated`。
- [ ] **Step 2-4:** 跑失败 → 实现 → 跑通过 + `npm run typecheck:web`。
- [ ] **Step 5: Commit** `feat: console login page and authenticated api client`

## 阶段 D：编辑资料模态框

### Task D1: 账号编辑 Modal，替换 window.prompt/confirm

**Files:**
- Create: `web/src/pages/AccountEditModal.tsx`
- Modify: `web/src/pages/AccountTable.tsx`、`web/src/pages/AccountDetailPage.tsx`、`web/src/App.tsx`（移除 `window.prompt`/`confirm` 编辑逻辑，改为打开 Modal）
- Test: `web/src/pages/__tests__/account-edit.test.tsx`

Modal 用 B1 表单原语编辑：label(`Input`)、note(`Textarea`)、priority(`Input type=number`)、disabled(`Switch`)、默认 profile(`Select` sdk/sand)、proxy(url/user/password `Input`)。保存调现有 `updateAccount`/`setProxy` api。删除/危险操作用确认 Modal（不再 `window.confirm`）。

- [ ] **Step 1: 写失败测试**：打开 Modal 预填账号值；改 label + 保存 → 调 `updateAccount` 带新值；确认删除 Modal 需二次确认。
- [ ] **Step 2-4:** 跑失败 → 实现 → 通过 + typecheck。确认全仓 `grep -rn "window.prompt\|window.confirm" web/src` 归零。
- [ ] **Step 5: Commit** `feat: rich account edit modal replacing browser prompts`

## 阶段 E：额度进度条统一强化

### Task E1: 统一 Meter 组件

**Files:**
- Create: `web/src/bflabs/Meter.tsx`（+ `components.css` 加/迁移 `bf-meter`）
- Modify: `web/src/pages/QuotaMeters.tsx`、`web/src/pages/QuotaDetail.tsx`、`web/src/pages/QuotaPage.tsx`、`web/src/pages/AccountDetailPage.tsx`（改用 `Meter`）
- Test: `web/src/bflabs/__tests__/meter.test.tsx`

`Meter` props：`label`、`used`、`limit`、`unit?`、`tone?`（auto 从 usedPercent 推：<70 default、70-90 warn(橙)、>90 danger(红)）、`resetAt?`（倒计时）。始终打印数值 + 百分比（沿用无障碍原则），`role=progressbar` + aria 值。复用 `web/src/quota.ts` 百分比函数。CountUp 动画数值。

- [ ] **Step 1: 写失败测试**：`used=95,limit=100` → tone danger、`role=progressbar` 的 `aria-valuenow≈95`、打印 "95%"/"95 / 100"；`used=10` → default tone。
- [ ] **Step 2-4:** 跑失败 → 实现 + 迁移两处旧实现到 `Meter`（删除重复的 `QuotaMeter`/`Meter` 私有实现）→ 通过 + typecheck。
- [ ] **Step 5: Commit** `feat: unified quota meter with pressure tones and reset countdown`

## 阶段 G：日志页 + 布局

### Task G1: 日志页（实时日志流 + 请求活动面板）

**Files:**
- Create: `web/src/pages/LogsPage.tsx`、`web/src/state/useLogStream.ts`、`web/src/state/useActivityStream.ts`
- Modify: `web/src/nav.ts`（`Page` 加 `"logs"`）、`web/src/RailNav.tsx`（导航加"日志"项）、`web/src/App.tsx`（路由）、`web/src/api.ts`（`getLogCapacity`/`setLogCapacity`/`getActivityStats`）
- Test: `web/src/state/__tests__/log-stream.test.ts`、`web/src/pages/__tests__/logs-page.test.tsx`

`useLogStream`/`useActivityStream` 用 `EventSource("/v0/management/logs/stream")` / `.../activity/stream`，累积到状态数组（前端也按当前容量截断），组件卸载 `close()`。
`LogsPage` 两个区：
- **请求活动面板**（对齐设计图）：工具栏 —— 当前 RPM（`getActivityStats` 轮询或流内）、状态码筛选 `Input`、凭据 ID 筛选 `Input`、容量档位 `Select`(20/30/50/100/200/300，改动调 `setLogCapacity`)、刷新 `Button`、清空筛选 `Button`、导出所选(`Button`，CSV/JSON 下载勾选行)、清空全部(`Button` accent/danger)、自动刷新 `Switch`、"本页 N 条"。表格列：账号/时间/客户端 IP/模型/最终状态(`StatusTag`：2xx success、4xx/5xx danger、进行中 progress)。行 `Checkbox` 勾选。
- **原始运行日志面板**：等宽区、自动滚动、level `Select` 过滤、暂停/继续 `Switch`、清屏 `Button`。

- [ ] **Step 1: 写失败测试**：`log-stream.test.ts` mock EventSource，push 事件 → hook 状态增长、超容量截断、unmount 调 close。`logs-page.test.tsx`：改容量 Select 调 `setLogCapacity(100)`；状态码筛选过滤行；status→StatusTag tone 正确。
- [ ] **Step 2-4:** 跑失败 → 实现（用 `frontend-design` 保证工具栏/表格质感在 bflabs 内）→ 通过 + typecheck。
- [ ] **Step 5: Commit** `feat: logs page with live log stream and request activity panel`

### Task G2: 布局重构 + 替换剩余原生输入

**Files:**
- Modify: `web/src/pages/AccountsPage.tsx`、`AccountTable.tsx`、`SettingsPage.tsx`、`PlaygroundPage.tsx`（原生 input/select/textarea/checkbox → B1 组件）、各页栅格用 tokens 统一，`web/src/pages/shared.tsx`（PageFrame 强化）
- Test: 复用/更新现有页面测试；加 `web/src/pages/__tests__/no-raw-inputs.test.tsx` 静态断言（grep 源码无裸 `<input`/`<select`/`<textarea>` 在这些页面，白名单 bflabs 内部）

- [ ] **Step 1:** 写"无裸输入"守卫测试（读这些页面源码，断言不含 `<input`/`<select`/`<textarea` 裸标签）。
- [ ] **Step 2-4:** 跑失败 → 逐页替换为 `Input`/`Select`/`Textarea`/`Checkbox`/`Switch`，栅格用 `--bf-space-*`/`--bf-content-max` → 通过 + typecheck + `npm run build`。
- [ ] **Step 5: Commit** `feat: replace raw inputs and refine console layout`

## 阶段 H：收尾

### Task H1: 全量验证 + 部署文档

- [ ] `npm run build`（server + web）成功；`npx vitest run` 全绿；`npm run typecheck`。
- [ ] 更新 `docs/DEPLOYMENT.md`：控制台现需登录（managed 模式用 `GATEWAY_ACCESS_KEY`），新增 `/v0/management/auth/*`、`/logs/*`、`/activity/*` 端点，日志容量档位说明。
- [ ] 端到端冒烟（手动，部署前）：登录 → roster → 编辑账号 Modal → 额度条 → 日志页实时滚动 + 改容量档位 + 请求活动出现 IP/RPM → 登出。
- [ ] Commit `docs: document console auth and logs endpoints`

## 自查（写完计划后）

- 覆盖 spec 五块 + 两地基：地基 A(表单原语)=B1；地基 B(App 拆分)=B2；块1(登录)=F3/A1/C1；块2(SSE 日志容量可调 + 活动面板 IP/RPM)=F1/F2/A2/A3/G1；块3(额度)=E1；块4(编辑)=D1；块5(布局)=G2。✓
- 命名一致：`LOG_CAPACITY_STEPS`、`LogSink`、`RequestTelemetry`、`ConsoleSessionStore`、`CONSOLE_COOKIE`、`Meter`、`AccountEditModal`、`useLogStream`/`useActivityStream` 全程统一。✓
- 后端注入入参：`createApp` 加可选 `logSink`/`telemetry`（A2 引入，A3/log-routes 复用）。✓






