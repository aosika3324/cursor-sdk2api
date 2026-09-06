# Sand 推理接入数据面 — 设计

- 状态：设计评审中
- 日期：2026-09-06
- 前置：sand 直连已实测跑通（见 `2026-09-06-capture-real-sand-traffic.md`）；资格领取 `claimSand` 已上线
- 目标：让 `sand` profile 的推理请求真正走 Bot 额度，而不是打补丁 SDK clone（当前 clone 只改 client-type 标签，实跑 403）

## 一句话结论

在 `cursor-runtime.ts` 的 profile fork 处，为 `sand` 返回一个**直连 HTTP 实现的 `SdkRun`**（复用已验证的 `sand-probe`/`sand-transcode` 逻辑），而不是加载打补丁的 SDK clone。下游（EventPump、writers、ledger）不变。前提是把 sand 鉴权用的 **session-token JWT** 从账号存储送到运行时。

## 已实测确认的事实（不再是假设）

- sand 推理 = `POST https://api2.cursor.sh/aiserver.v1.InferenceService/Stream`，`Bearer <JWT>`（session token 的后半段），`x-cursor-client-version: cli-1.0.30`（必须带 `cli-` 前缀），`x-cursor-client-type: sand`，`x-sand-box-namespace: prod`，connect+proto framing，`conversation_id` 必填。
- crsr_ key 打 sand → `ERROR_NOT_LOGGED_IN`。**只有 JWT 能用。**
- 响应是 `{text, thinking, error, final}` deltas（`sand-transcode.decodeInferenceFrame`）。
- session token 带 `offline_access` scope，样本 exp ~43 天，可当长期凭证。

## 核心缺口：JWT 送不到运行时

当前认证链只把 crsr_ key（`AuthContext.cursorApiKey`）送到 `cursor-runtime`。账号存储（`StoredCursorAccount`）**不存 session token / JWT**。要接线必须补这条链。

## 架构：三段改动

### 段 1：账号存储增加 session token 字段

- `AccountFile`（`file-store.ts`）加可选 `session_token?: string`。
- `StoredCursorAccount` 加 `sessionToken?: string`（`toPublic` 映射）。
- `add()` 或新增 `setSessionToken(id, token)` 写入；onboarding 成功后顺手存（onboarding 已持有 session token，当前是用完丢弃，改为可选持久化）。
- 安全：session token 是高价值凭证。存储沿用现有账号文件的 `0o600` 私有权限；`toPublic` 对外暴露时给 hint（如 `keyHint`），不回显全量。控制台/日志不打印。

### 段 2：JWT 流经认证链到运行时

- `AuthContext`（`credentials.ts`）加可选 `sandJwt?: string`。
- `managedAccountAuth(apiKey, defaultProfile, sessionToken?)`：若账号有 session token，抽出 JWT 放进 `sandJwt`。
- BYOK 模式：用户直接把 session token 当 key 传（`presentedSecret` 若形如 `user_...::jwt` 则识别为 session，抽 JWT 进 `sandJwt`，`cursorApiKey` 留空或同值）。
- `CreateAgentInput`/`ResumeAgentInput`（`port.ts`）加可选 `sandJwt?: string`。
- `run-coordinator.startTurn` 构造 agent input 时，把 `auth.sandJwt` 传下去。

### 段 3：sand 直连 SdkRun

- 新文件 `src/sdk/sand-runtime.ts`：实现 `SdkAgent`/`SdkRun` 接口的直连版本。
  - `createAgent`：sand profile 下，用 `sandJwt` 构造一个 sand agent。conversationId 用 agentId（稳定复用，支持多轮）。
  - `send`：调用 sand-transcode 编码 → 直连 HTTP POST（流式读取）→ 把 `{text,thinking,error,final}` 逐帧映射成 `SdkDeltaUpdate`（`text-delta`/`thinking-delta`/`turn-ended`）喂 `onDelta`；`stream()` 产出等价 `SdkStreamEvent`；`wait()` 返回 `{status, result:<累计text>, usage}`；`error` 帧 → 抛 `SdkFailure`。
  - `resumeAgent`：sand 多轮——把历史消息编进 `InferenceStreamRequest`（transcode 的 `specFromAgent` 已支持 conversationHistory）。
- `cursor-runtime.ts:264` fork：`profile === "sand"` 且有 `sandJwt` → 用 sand-runtime；否则回落现有行为（打补丁 clone 或报错）。
- 流式：`sand-probe` 现在是一次性读全响应；数据面要真流式（边读边发 delta）。sand-runtime 用 `response.body` 的 reader 增量解 connect 帧。

## 落地形态与 BFLABS 边界

- 这是**直连 HTTP**，不碰 SDK 传输层、不打补丁、不动 hash-guarded loader。比之前设想的 transport 注入更干净。
- 现有的打补丁 SDK clone（`sand-loader`/`sand-patch-contract`）在此方案下**不再用于推理**——sand 推理走直连。clone 可保留（改标签）或后续清理，属独立决策。
- 需在 BFLABS.md 记：sand 推理走直连 InferenceService，非 SDK。

## 验证策略

- **可离线**：transcode 往返（已有）、delta 映射、流式帧增量解析、JWT 抽取、认证链传递——全用 fake fetch / 固定字节向量测。
- **需真实账号冒烟**：一次端到端 `/v1/messages` with sand profile，确认出 Bot 文本、计到 Bot 额度。已有可跑账号。

## 分期

1. 段 1（存储）+ 段 2（认证链）：纯管道，可离线全测。
2. 段 3（sand-runtime）：核心，可离线测编解码/映射/流式；真实冒烟收尾。
3. 接线 fork + 端到端冒烟。

## 待你决定（已定）

- session token 持久化：**接受**在账号文件存 session token（`0o600`，不外泄）。
- 多轮对话：**首版就做多轮**。sand-runtime 把会话历史（user/assistant 消息）编进 `InferenceStreamRequest` 的 `msgs[]`（role 1=user, 2=assistant, 4=system）。
- 打补丁 clone：**本次不动**。它不再用于推理，但保留不管。
