# 抓取真实 Sand (InferenceService) 流量 — 指引

目的：拿到 Cursor 客户端跑通 Sand 时的真实请求，让网关绕过 SDK、直接用 HTTP + 已写好的 transcoder 打到 InferenceService。当前 npm `@cursor/sdk` 1.0.30 没有 InferenceService 服务定义，无法从 SDK 侧挂载，只能靠真实样本复刻。

## 为什么需要你抓

`_backendTransport` 的真实 host、InferenceService 的鉴权头、请求/响应体的确切结构，都是 SDK 内部/客户端内嵌的，1.0.30 npm 包里不存在。SandClaimer 能跑是因为它补的是 Cursor 桌面客户端的内嵌 SDK（1.1/1.2 线，内置 InferenceService）。

## 怎么抓（用 SandClaimer + 一个能跑 sand 的账户）

1. 用 SandClaimer 对一个账户把 sand 跑通（它自己的界面里 sand 能出文本，不是 `[sand] error`）。
2. 抓那次 sand 请求的 HTTPS 流量。两种方式任选：
   - **mitmproxy / Charles / Fiddler**：让 SandClaimer 走代理，抓 `InferenceService/Stream` 那条请求，导出为 .har 或原始 request/response。
   - **在 sand_rpc.js 里加日志**：它有 `SAND_RPC_TEST` 钩子（`globalThis.__sandTest`）。在 `doRewrite` 的 `streamFn` 调用前后 `console.error` 出：目标 URL、请求头、`encStreamReq` 产生的 body bytes（hex）、以及响应的前几帧 bytes。

## 我需要的确切字段

抓到后，把下面这些给我（可脱敏 token 本身，但保留结构）：

1. **完整请求 URL**：`https://<host>/aiserver.v1.InferenceService/Stream` — 我要那个 `<host>`（是 api2.cursor.sh 还是别的）。
2. **请求头全集**：特别是
   - `authorization` / `x-api-key`（值可脱敏成 `<crsr key>`，但告诉我用的是哪种、什么前缀）
   - `x-cursor-client-type`、`x-cursor-client-version`、`x-sand-box-namespace`
   - `content-type`（connect/grpc-web? application/connect+proto? application/grpc?）
   - 任何 `x-cursor-*` / `x-amzn-*` / `connect-*` 头
3. **请求体**：原始 bytes 的 hex dump（前 200 字节够）。用来核对我 transcoder 的 `encodeInferenceRequest` 字段号对不对。
4. **响应**：状态码 + 响应头 + 响应体前几帧的 hex。用来核对我的 `decodeInferenceFrame`（text=field1 / thinking=field9 / error=field8）对不对。
5. **framing**：是 connect 的 length-prefixed（5 字节前缀：1 flag + 4 大端长度）还是别的。

## 我这边准备好的接收端

网关里会加一个实验通道 `POST /v0/management/sand/probe`（管理端点，仅本地/basic-auth）：给它一个 crsr key + 一段文本，它用你抓到的 host/headers/framing + 已写好的 transcoder，直接 HTTP 打 InferenceService，回显原始响应。这样你抓包回来，我填几个常量就能实测，不动 SDK。

## 探针实测结论（2026-09-06，用可跑 sand 的 session token）

用 `sand-probe.ts` 直连 `api2.cursor.sh/aiserver.v1.InferenceService/Stream`，鉴权用 session token 抽出的 JWT 做 `Bearer`，逐步实测直到**跑通**：

| 步骤 | 结果 | 结论 |
|---|---|---|
| host + Bearer(JWT) + content-type + 路由 | HTTP 200 | host/鉴权/content-type/路由对 |
| connect framing（5 字节前缀 flag+大端长度）| 正确解析 | framing 对，transcoder envelope 无误 |
| 空 conversationId | `invalid_argument: conversation_id is required` | field 8 必填，发一个 UUID |
| `x-cursor-client-version: 0.18.0` | `permission_denied: ERROR_OUTDATED_CLIENT` | 版本头格式不对 |
| **`x-cursor-client-version: cli-1.0.30`** | **HTTP 200，返回真实 Bot 文本** ✅ | **跑通** |

**唯一卡点是版本头前缀。** 实测 `cli-<任意版本>` 都放行（`cli-1.0.30`、`cli-2025.09.02-abc123` 均成功），裸版本号 `0.18.0`/`1.0.30` 被拒。原因：`@cursor/sdk` 的 `x-cursor-client-version` 由函数生成，格式恒为 `cli-<v>`/`agentkit-<v>`/`python-<v>`（bundle 里的 `Sh()`），服务端只校验前缀。SandClaimer 的 `sand_rpc.js` 写死 `0.18.0` 也能过，是因为它寄生在真实客户端里、客户端另外发了合法版本头。

**成功样本**：prompt `"hi"` → `"Hello! How can I help you today? 😊"`，8 帧，trailer `{}` 干净收尾，出自 sand-granted Team 账号（`grokPlanLabel: "Grok Bot Plan"`）。

**checksum 是虚惊**：`@cursor/sdk` 1.0.30 bundle 根本不发 `x-cursor-checksum`，普通 agent 流量照跑；SandClaimer 全程也不碰任何 checksum。之前"卡在 checksum"的判断是错的。

### 已确认的完整请求配方

- `POST https://api2.cursor.sh/aiserver.v1.InferenceService/Stream`
- `authorization: Bearer <JWT>`（JWT = session token `user_...::<jwt>` 的后半段，不是 crsr_ key）
- `content-type: application/connect+proto`、`connect-protocol-version: 1`
- `x-cursor-client-type: sand`、`x-cursor-client-version: cli-1.0.30`、`x-sand-box-namespace: prod`
- body：connect envelope（5 字节前缀）包 `InferenceStreamRequest`；`conversation_id`（field 8）必填
- 编解码用 `src/sdk/sand-transcode.ts`（`encodeInferenceRequest`/`decodeInferenceFrame`），字段号已验证正确

### 下一步（接线到网关数据面）

SDK（ESM、npm 1.0.30）无 InferenceService 绑定，无法从 SDK 驱动。落地形态待定：可用本地转码代理 + `CURSOR_BACKEND_URL`（SDK 认这个环境变量、无证书固定）把 `AgentService/Run` 重定向到 `InferenceService/Stream`；鉴权需要 session-token 的 JWT，不是 crsr_ key。资格领取（`claimSand`）已落地。
