# Sand 推理路径改造：参考 SandClaimer 策略

- 状态：设计评审中（未实现）
- 日期：2026-09-05
- 触发：Team 账号切 sand profile 实跑返回 `403 "Sand traffic is not supported"`
- 参考实现：SandClaimer 1.3.0（`sand_rpc.js`、`sand_api.py`）

## 一句话结论

我们当前的 sand 补丁只改了 `x-cursor-client-type: sdk→sand` 一个标签，**没有改 RPC 端点、没有协议转码、没有资格领取**。SandClaimer 揭示 sand 是一条**完全不同的 RPC 通道**，需要端点重定向 + 双向 protobuf 转码，且团队/免费账号还需主动领取资格。本文分两块独立方案，供决定做哪块。

## 根因：我们的 sand 和真实 sand 的差距

<!-- SECTION-GAP -->

Sand 不是"SDK 的一个参数"，而是一条独立的 RPC 通道。真实 sand 流量（`sand_rpc.js:3-5`, `33`）在传输层做了四件事：

| # | 动作 | SandClaimer | 我们现状（`sand-patch-contract.ts`）|
|---|---|---|---|
| 1 | RPC 端点重定向 `agent.v1.AgentService/Run` → `aiserver.v1.InferenceService/Stream` | ✅ | ❌ 仍打 AgentService/Run |
| 2 | `x-cursor-client-type: sand` | ✅ | ✅ 唯一做了的一项 |
| 3 | `x-cursor-client-version: 0.18.0` | ✅ | ❌ |
| 4 | `x-sand-box-namespace: prod` | ✅ | ❌ |
| 5 | 请求体 protobuf 转码 agent→inference（`specFromAgent`+`encStreamReq`）| ✅ 手写 wire format | ❌ 直接发 agent 消息体 |
| 6 | 响应流转码 inference→agent（`decLen`+`decPart`+`infToAgent`）| ✅ | ❌ |

因为我们只做了第 2 项（贴了 sand 标签却仍打 agent 端点、发 agent 消息体），Cursor 服务端识别出这是"伪装成 sand 的 agent 流量"，直接 `403 "Sand traffic is not supported"`。这解释了那个 403 不是账号问题，是**我们的 sand 实现根本不完整**。

### 关键事实：两种 RPC 是不同的 protobuf 消息

`AgentService/Run` 的输入是 `agent.v1.AgentClientMessage`（含 `runRequest`），输出是 `interactionUpdate` 流。
`InferenceService/Stream` 的输入是 `InferenceStreamRequest`（`msgs[]`+`model`+`params`），输出是自定义的 length-delimited 流（field 1=text、field 9=thinking、field 8=err）。

SandClaimer 用手写的 protobuf 编解码（`bmsg/bstr/bvar` 编码、`rv/decPart` 解码）在两者之间双向翻译，并在流末尾补一个 `turnEnded`（`wrapTurnEnd`）让上层 agent 逻辑正常收尾。**这是这块改造的真正成本所在，不是加两个 header。**

## 方案 A：修推理路径（让 sand 流量真正能跑）

<!-- SECTION-A -->

目标：让 `sand` profile 的推理请求真正被 Cursor 接受，而不是 403。

### 实现要点

SandClaimer 的做法是运行时 monkey-patch（`sand_rpc.js` 劫持 `fetch`/`http2`/`@connectrpc/connect-node`）。我们已有一条更干净的路子：`sand-loader.ts` 已经在做**磁盘补丁**（hash-guarded 改写 `@cursor/sdk` 的 dist 文件）。方案是把补丁从"只改 1 个标签"扩展到"改端点 + 加 2 个头 + 转码"。

两种落地形态：

1. **静态补丁扩展**（延续现有 `sand-patch-contract.ts`）：把端点字符串、version/namespace 头一并纳入 hash-guarded 替换。问题：protobuf 转码（第 5、6 项）无法用简单字符串替换实现，必须注入一段转码逻辑。
2. **传输层注入**（对齐 SandClaimer）：在 sand runtime 下，于 `@connectrpc/connect-node` 的 transport 外包一层，命中 `AgentService/Run` 时改写端点+头、对请求/响应做 protobuf 转码。比字符串补丁健壮（不依赖精确的 minified 片段），但要把 `sand_rpc.js` 的编解码逻辑用 TS 重写进 `src/sdk/`。

推荐形态 2：SandClaimer 自己也是从字符串补丁演进到传输层劫持的（`sand_rpc.js` 就是证据），因为 SDK minified 内容每版都变，字符串补丁脆弱。

### 需要移植的核心逻辑（来自 sand_rpc.js）

- `specFromAgent`：从 agent runRequest 抽取 `{msgs[], model, params, maxMode}`
- `encStreamReq`：编码成 `InferenceStreamRequest` 的 protobuf wire bytes
- `decLen`/`decPart`：解码 inference 响应流
- `infToAgent`：inference delta → agent `interactionUpdate`（textDelta/thinkingDelta）
- `wrapTurnEnd`：流末补 `turnEnded`

### 验证难点（必须诚实标注）

- **无法离线验证**：这条路对不对，只有拿一个**真正有 sand 执行权的账号**实跑才知道。当前手上账号（Team、已确认 403）验不了正例，只能验"改造后仍能正确处理 403"。
- 契约测试只能覆盖：编解码往返（用固定字节向量）、端点/头改写、非 sand 流量不受影响。
- **不满足 BFLABS 边界的部分**：现有规则要求 sand 走"hash-guarded 1.0.30 loader"。传输层注入偏离了这个字面约束，需要更新 BFLABS.md 或保留两种 sand 实现，属于要你拍板的治理决策。

## 方案 B：加资格领取（让账号自动开通 sand）

<!-- SECTION-B -->

目标：导入账号时自动为其领取/激活 Sand 资格，而不是假设它已有。

这块与方案 A **完全独立**，且**低风险**——纯 dashboard 网页 API，和我们已经上线的 onboarding（session token 换 crsr_ key）同源，复用同一把 session token 顺手做。

### 领取决策树（来自 sand_api.py:706 `claim`）

```
1. 查 Sand 用量：若 401/403 → 账号票失效，直接 dead，不再打领取
2. get-me 取 teamId + email
3. 若已 unlocked 或 access.granted → already（Pro/Pro+/Ultra 套餐自带，无需领取）
4. 若有 teamId（团队号）→ POST request-sand-team-access {teamId}
                          → 幂等 POST update-team-sand-onboarding-completed {teamId}
5. 否则（个人号）→ POST start-sand-trial
     - 返回含 cardVerificationRequired → card_required（免费号需绑卡，附 stripe url）
     - 否则 → activated
```

### 端点（均 cursor.com，POST，cookie 认证 + Origin 过 CSRF）

| 用途 | 端点 | body |
|---|---|---|
| 查资格（权威）| `/api/dashboard/get-sand-access-status` | `{}` |
| 取 teamId | `/api/dashboard/get-me` | `{}` |
| 个人试用 | `/api/dashboard/start-sand-trial` | `{}` |
| 团队申请 | `/api/dashboard/request-sand-team-access` | `{"teamId":N}` |
| 团队 onboarding | `/api/dashboard/update-team-sand-onboarding-completed` | `{"teamId":N}` |

响应 `proAndSuperGrokPlansGrantAccess: true` = 套餐自带资格。

### 落地

在 `src/account/cursor-onboarding.ts` 加 `claimSand(sessionToken)`，复用现有 `dashboardCall`。onboard 端点加可选 `claim_sand: true`，控制台账号导入区加勾选项（和现有 "grant_fable5" 并列）。返回 outcome：`already` / `team_ok` / `activated` / `card_required` / `dead` / `failed`。

### 可离线验证

编解码不涉及，纯 HTTP。可用注入 fake fetch 覆盖全部 5 条决策分支（already/团队/个人/绑卡/失效），和现有 onboarding 测试同法。真实账号只需一次冒烟。

### 对那个 Team 账号意味着什么

它现在 `access_state: GRANTED` 但实跑 403。方案 B 的 `request-sand-team-access` 可能就是它缺的那一步（团队号资格要显式申请 + onboarding 标记）。**但这只是推测**——领取成功后能否真跑，仍取决于方案 A 是否也做了、以及 Cursor 服务端最终是否放行。两者都做才有完整闭环。

## 风险与建议

<!-- SECTION-RISK -->

### 两块对比

| | 方案 A（修推理路径）| 方案 B（加资格领取）|
|---|---|---|
| 解决 | sand 流量能真正跑 | 账号自动开通 sand |
| 工作量 | 大（双向 protobuf 转码，移植 sand_rpc.js）| 小（5 个 HTTP 端点，复用 onboarding）|
| 风险 | 高（改传输层，可能触碰 BFLABS 边界）| 低（纯 dashboard API，与现有同源）|
| 离线可验 | 部分（编解码可测，能否真跑不可测）| 是（决策分支全可测，仅需一次真实冒烟）|
| 前置依赖 | 无 | 无 |
| 单独有用吗 | 有（账号已有资格时直接可跑）| 有（先把资格开出来）| 

**注意：只做 A 不做 B，那些需要领取的账号仍会 403；只做 B 不做 A，资格领到了但我们的 sand 端点仍不对、照样 403。真正跑通 sand 需要 A+B 都做。** 但 B 可以先落地、独立验证、且顺带修 onboarding；A 需要真实可跑账号才能确认，建议后做。

### 推荐路线

1. **先做 B**（低风险、可离线验证、复用 onboarding、顺手把 Team 号资格申请补上）。
2. B 上线后，用一个领取成功的账号观察 `get-sand-access-status` 和实跑结果，据此判断 A 是否是最后一块拼图。
3. **再决定 A**：确认 B 之后 sand 仍 403，才投入 A 的重构；A 落地形态（静态补丁 vs 传输层注入）和 BFLABS 边界更新一并评审。

### 待你决定

- 先做 B，还是 A+B 一起做，还是继续只出文档？
- A 若做，是否接受偏离 "hash-guarded loader" 的传输层注入形态（需更新 BFLABS.md）？
- 领取涉及给账号申请资格/试用，属于对上游账号的写操作，确认授权我方对这些账号执行。
