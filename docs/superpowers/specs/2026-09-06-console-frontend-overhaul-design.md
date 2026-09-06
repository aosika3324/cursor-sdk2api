# 操作控制台前端改造 — 设计

- 状态：设计评审中
- 日期：2026-09-06
- 触发：现有控制台风格好但功能原始 —— 无登录、编辑简陋、额度无进度条(实为已有但弱)、无 SSE 实时日志、布局简陋且大量原生输入框
- 约束：**严格复用现有 bflabs 设计系统**(炭黑 #111417 / 暖白 #faf8f5 / 橙 #ff6a33，Space Grotesk + Inter，light/dark/orange 三 tone，2px/4px 工业小圆角)。不引入新视觉语言。

## 一句话结论

在保留 bflabs 视觉语言的前提下，补齐控制台的产品化能力：真正的登录鉴权(后端 session + 中间件)、模态框富编辑、统一强化的额度进度条、SSE 实时日志(运行日志流 + 结构化请求活动)、一套缺失的表单原语，并把 1100 行的 App.tsx 拆成 context + hooks。

## 现状(已调研确认)

- **无路由库**：hash 路由(`nav.ts`)，App.tsx 1100 行巨石组件持有全部状态/i18n/数据获取，页面是纯展示。
- **管理接口完全无认证**：`/v0/management/*` 不校验任何东西；仅数据面 `/v1/*` 用 `GATEWAY_ACCESS_KEY`(managed 模式)。无 session/cookie 原语。
- **额度已有进度条**：`QuotaMeters`(`bf-progress`)+ `QuotaDetail`(自己的 `quota-meter`)两套重复实现，需统一强化。
- **无日志端点、无 EventSource**：SSE 机制只存在于 LLM 推理响应(`protocols/*/sse.ts`)，日志是绿地。
- **设计系统缺表单原语**：有 Button/Card/Tabs/StatusTag/Notice/CountUp/Reveal，但**没有 Input/Select/Textarea/Checkbox/Modal**；Accounts/Settings/Playground 用原生 input，账号编辑用 `window.prompt`/`confirm`。

## 架构：分五块 + 两块地基

### 地基 A：表单原语(bflabs 扩展)
新建 `web/src/bflabs/` 组件，全部套现有 tokens：
- `Input`(text/password/number)、`Textarea`、`Select`、`Checkbox`、`Switch`、`Field`(label+error+hint 包装)、`Modal`(焦点陷阱、Esc 关闭、`role=dialog`)。
- 配套 `components.css` 里加 `bf-input`/`bf-select`/`bf-checkbox`/`bf-modal` 类，用 `--bf-control-*`/`--bf-radius-control`/`--bf-focus`。
- 用它们替换所有原生 input 和 `window.prompt`/`confirm`。

### 地基 B：App.tsx 拆分
- 抽 `AppStateContext`(roster/health/settings + 刷新方法)、`I18nContext`(COPY + lang)、`AuthContext`(登录态)。
- 数据获取抽成 hooks：`useRoster`、`useHealth`、`useSettings`、`useAuth`、`useLogStream`。
- App.tsx 只留 shell + 路由 switch。页面从 context 取数据，不再深层 prop-drill。

### 块 1：登录 + 锁接口(后端 + 前端)
**后端**(`src/server/`)：
- 新增 session 机制：登录端点 `POST /v0/management/auth/login`，body `{ access_key }`，校验等于 `config.gatewayAccessKey`(managed 模式)→ 发一个 httpOnly、SameSite=Strict、Secure(经代理时)的 session cookie(签名或随机 token 存内存 session store，带 TTL)。`POST /v0/management/auth/logout` 清除。`GET /v0/management/auth/session` 返回登录态。
- 新增认证中间件：所有 `/v0/management/*`(除 auth/login 本身)校验 session cookie；无效返回 401。`/console/*` 静态资源仍可公开(SPA 外壳)，但所有 API 401 时前端跳登录页。
- BYOK 模式(无 gatewayAccessKey)下的行为：需明确 —— 见"待定"。
**前端**：登录页(bflabs 风格，居中卡片、access key 输入、错误提示);`useAuth` 管理登录态;api.ts 所有管理请求带 credentials(cookie 自动),遇 401 跳登录。

### 块 2：SSE 实时日志(后端 + 前端)
**后端**：
- 新增内存环形缓冲日志 sink(容量上限，如最近 2000 条)，捕获现有结构化 log 行。
- **原始运行日志流**：`GET /v0/management/logs/stream`(`text/event-stream`)推送新日志行；支持初始回放最近 N 条；认证同管理接口。复用 `http-util` 的 SSE 写法。
- **结构化请求活动**：从 `RuntimeLedger`(已存在但未暴露 HTTP)派生高层事件(账号、模型、耗时、成功/失败)，推一个更聚焦的活动流。
- 断线重连：SSE `Last-Event-ID`，端点支持从游标续传。
**前端**：
- `useLogStream` hook 用 `EventSource`(同源，CSP `connect-src 'self'` 已允许)。
- 实时日志面板(等宽、自动滚动、level 过滤、暂停/继续、清屏)+ 请求活动面板(账号 hint、模型、状态 tag、耗时)。状态用 `StatusTag`。

### 块 3：额度进度条统一强化
- 合并 `QuotaMeters` 和 `QuotaDetail` 两套实现为一个 bflabs 级 `Meter`/`MeterGroup`(tone 传达压力、始终打印数值)。
- 强化：分段(included/on-demand)、接近上限的橙→红警示、重置倒计时、CountUp。
- 用在 QuotaPage、AccountDetailPage、QuotaDetail modal。

### 块 4：编辑资料模态框富编辑
- 账号编辑 Modal：label / note / priority / disabled / 默认 profile / proxy 一站式，用地基 A 表单原语。
- 从 AccountTable 行操作和 AccountDetailPage 打开。替换所有 `window.prompt`/`confirm`。
- 复用现有 `/v0/management/accounts/update` 和 `/proxy` 端点。

### 块 5：布局重构
- 用 bflabs tokens 重排页面栅格(`--bf-content-max`、`--bf-space-*`)，统一卡片间距、页面头。
- 替换所有原生 input/select/textarea/checkbox 为地基 A 组件。
- 保持三 tone 与语言切换。

## 前端设计质量
新组件和布局用 `frontend-design` 技能保证产品级质量，但**必须**在 bflabs tokens 约束内(不生成脱离该系统的通用 AI 风格)。

## 安全考量
- 登录后 `/v0/management/*` 全锁 —— 本次最重要的安全提升(当前公网无保护)。
- session cookie：httpOnly + SameSite=Strict + Secure(生产经 Caddy TLS)。CSRF：SameSite=Strict 基本够，状态变更端点可加 Origin 校验(同 onboarding 现有处理)。
- 日志 sink 沿用现有脱敏(不打印 key/token/prompt body)，SSE 端点认证同管理接口。
- access key 只在登录时提交一次，之后靠 cookie，不存前端。

## 验证策略
- 前端：组件单测(表单原语、Meter 百分比/tone、Modal 焦点陷阱)、页面契约测试(登录跳转、401)。vitest。
- 后端：认证中间件测试(无 cookie→401、有效→通过、login/logout/session)、SSE 端点测试(连接、回放、认证)。fake/注入 fetch。
- 端到端冒烟：登录→roster→日志滚动→编辑账号→额度条→登出。手动，部署前一次。

## 分期
1. 地基 A(表单原语)+ 地基 B(App 拆分)。
2. 块 1(登录+锁接口)—— 安全最高优先。
3. 块 5(布局+替换原生输入)+ 块 4(编辑模态框)。
4. 块 3(额度统一强化)。
5. 块 2(SSE 日志)—— 最独立、最大。

## 已定决策(评审确认)
1. **登录凭证**：复用现有 `GATEWAY_ACCESS_KEY`(216 跑 managed 模式，已必填此 key)。登录页提交它 → 后端校验等于 `config.gatewayAccessKey` → 发 session cookie。BYOK 模式(无 key)不在本次范围;若将来需要，再加 `CONSOLE_ACCESS_KEY`。
2. **日志页**：新增独立"日志"页(左侧导航加一项 `logs`)，含实时日志流 + 请求活动面板两个区。
3. **session 存储**：内存 session store(216 单实例，重启需重登，可接受)。
4. **日志 sink**：捕获现有结构化 log 行(app 已用 `{level,msg,...}` JSON)。若日志有分散的 `console.log`，先归拢到统一 logger 再接 sink。
5. **前端设计质量**：用 `frontend-design` 技能做新组件/布局，但严格约束在 bflabs tokens 内。

## 待定(需你拍板)
（已全部拍板，见上"已定决策"。）
