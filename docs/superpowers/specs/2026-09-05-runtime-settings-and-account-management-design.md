# 运行时设置与账号管理增强

- 状态:已批准(方案 A)
- 日期:2026-09-05
- 范围:第一期 = 运行时配置层 + 账号增强(含全局与 per-account 代理)
- 不在本期:客户端密钥多租户、请求日志/统计、管理端登录鉴权

## 背景

当前网关的每一项配置都是容器环境变量,改任何一项都要改 compose 并重建容器。控制台仅有 9 个管理操作(`web/src/api.ts`),而参照实现 kiro-rust 的 admin 面有 48 个。账号记录只有 5 个字段(`src/account/file-store.ts:26`),没有优先级、启用/禁用、备注,也没有代理。

代理目前是进程级全局:`src/index.ts:12` 启动时读一次 env,装成 Node 全局 agent(`src/sdk/proxy.ts:112-120`)。池中所有账号共用一个出口 IP。

## 可行性验证(已实测)

1. **per-account 代理不需要修改 SDK。** `AsyncLocalStorage` + `https.globalAgent` 上的 getter,三个并发上下文各自拿到自己的 agent,无上下文时回落全局默认。
2. **SDK 有两条网络路径,必须分别处理。** Agent 运行流量走 `https.globalAgent`;`models.list` 与 Dashboard 额度查询走 undici 全局 dispatcher。只做前者,Cursor 仍能从额度查询看到服务器真实 IP。
3. **socket 连接池天然隔离。** 每个 `https.Agent` 有独立 `sockets`/`freeSockets`,不会跨账号复用连接。
4. **SOCKS5 零新增依赖。** `proxy-agent` 已支持 `socks/socks4/socks5/socks5h`(`socks-proxy-agent` 已装),undici 8.10 自带 `Socks5ProxyAgent`。当前的 SOCKS 拒绝是项目自加限制(`src/sdk/proxy.ts:73`)。
5. **官方 transport 接缝不可用。** SDK 内部有 `setConnectTransportFactory`,但未在 `exports` 映射中暴露,深度导入报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。故采用 Node 层方案。

## 方案 A:配置文件 + ALS 代理隔离

### 为何不选其他方案

- **仅配置文件、代理保持全局**:工作量减半但不满足需求,且日后补 per-account 要重复改同一条运行路径。
- **一账号一容器**:隔离性更强且无需改码,但放弃共享账号池(跨账号轮询与故障转移是本网关核心功能),且需手工管理 N 个容器。

## 一、配置层

### 存储

`$STATE_DIR/config.json`,`version: 2` 版本头(沿用账号文件版本化惯例)。

- 首次启动从 env 播种一次,写入 `seeded_from_env: true`,**之后文件为唯一真相**。env 变更不再覆盖已落盘的值。
- 写入用临时文件 + `rename` 原子替换,权限 0600,失败保留原文件。
- 每次成功写入前备份为 `config.json.bak-<epoch>`,保留最近 10 份。
- 校验失败(类型/范围)整笔拒绝并回 422,不做部分写入。

### 生效语义(本设计核心)

配置按能否热改分三类,界面必须诚实标注。kiro-rust 无此约束,因为它每个请求自建 HTTP client;我们有 live Agent 绑定语义。

**热生效** — 写入即生效:`log_level`、`hosted_search_mode`、`global_active_runs`、`per_credential_active_runs`、`session_ttl_ms`、`replay_ttl_ms`、`first_event_timeout_ms`、`tool_batch_settle_ms`、`catalog_cache_ms`、`proxy.per_account_enabled`。

并发上限调小仅影响新请求准入,不掐断进行中的 run。

**仅新会话生效** — live Agent 已绑定:`default_runtime_profile`、`allow_request_runtime_profile`、`global_proxy`。沿用 `/v1/account` 已有的 `applies_to_new_sessions` 语义。全局代理变更不回收既有连接池。

**需重启** — `runtime_ledger_v2`(启动时开库建表)、`host`、`port`、`state_dir`。设置页**只读展示 + 明确标注**,不提供可写输入框,避免"改了却没生效"的错觉。

### 安全边界

- `gateway_access_key` 与账号 `apiKey` **不进 config.json**。网关密钥轮换走独立端点与独立存储。
- `BFLABS.md` 规定的产品不变量(禁用 Cursor ambient shell/read/edit/task)**不做成开关**。安全边界不交给界面。
- 配置读接口永不回显任何密钥或代理凭据明文,代理密码以 `has_password: true` 形式表示。

## 二、代理隔离

### 三级优先

1. 账号显式配置的代理(`proxy.per_account_enabled` 为 true 时)
2. 全局代理(`global_proxy`)
3. 直连

### 机制

`ProxyContext` 模块持有 `AsyncLocalStorage<ProxyBinding>`,并在 `https.globalAgent` / `http.globalAgent` 上安装 getter:有上下文取上下文的 agent,无则取全局默认。undici 侧同法提供 per-context dispatcher。

agent 实例按"代理 URL"缓存复用,避免每请求新建连接池。

`AuthContext`(`src/auth/credentials.ts:8`)已贯穿整条运行路径,是代理绑定的挂载点:管理层选定账号后,把该账号的代理绑定随 `AuthContext` 带下去,`RunCoordinator` 在进入 SDK 调用前用 `als.run()` 包裹。

### 风险与门禁

getter 改写 Node 内建属性,是伸入全局对象的接缝。因此:

- `proxy.per_account_enabled` **默认 false**。关闭时完全不安装 getter,行为与今日逐字节一致。
- 开启时仍对未配置代理的账号回落全局默认,不改变其行为。
- `/health` 报告 `per_account_proxy: enabled|disabled` 与已绑定代理的账号数(不含 URL)。

### SOCKS5

放开 `socks5://` / `socks5h://` / `socks4://`。PAC 继续拒绝(`pac+*` 需要动态求值,与失败关闭原则冲突)。

保留原有的失败关闭初衷:若某账号配置了代理但该协议在任一路径不可用,该账号**整体拒绝服务**并在界面标红,绝不静默降级为直连。这是原 SOCKS 限制真正想防的问题,用显式校验解决,而非禁掉协议。

## 三、账号模型

`StoredCursorAccount` 从 v1 升至 v2,新增字段(全部可选,缺省即当前行为):

| 字段 | 类型 | 说明 |
|---|---|---|
| `label` | string | 备注名,便于识别 |
| `disabled` | boolean | 禁用后不参与轮询,已有会话不受影响 |
| `priority` | number | 越小越优先,同级内轮询;缺省 100 |
| `proxy` | object \| null | `{ url, username?, password? }` |
| `note` | string | 自由备注 |
| `lastError` | object \| null | `{ reason, status, at }`,只读诊断 |

### 迁移

`version: 1` 文件读取时按缺省值补齐并原地升级为 v2。v2 文件被 v1 代码读到会因严格校验被拒 —— 故升级不可回滚,`CHANGELOG` 需注明。

### 选择逻辑

`CursorAccountPool.select` 现为纯轮询(`src/auth/account-pool.ts:10`)。改为:排除 `disabled`;按 `priority` 升序分组;在最高优先级且模型兼容的组内轮询;该组全部不可用才降级到下一组。

保留既有约束:继续中的会话仍钉在原账号;语义输出前的故障转移仍只尝试一个备选账号。

## 四、API 与界面

### 新增端点(均在现有 `/v0/management` 前缀下,继续依赖边缘鉴权)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v0/management/settings` | 读全部配置 + 每项的生效类别 |
| PUT | `/v0/management/settings` | 整体写入,原子校验 |
| GET | `/v0/management/settings/schema` | 字段元数据(类型/范围/生效类别),供界面渲染 |
| PUT | `/v0/management/accounts/update` | 改 `label`/`priority`/`disabled`/`note` |
| PUT | `/v0/management/accounts/proxy` | 设置或清除账号代理 |
| POST | `/v0/management/accounts/batch` | 批量禁用/启用/删除/改优先级 |
| POST | `/v0/management/accounts/verify` | 逐账号真实探测(复用现有 probe 逻辑)|
| GET | `/v0/management/accounts/export` | 导出账号(密钥脱敏,可选含密钥) |
| POST | `/v0/management/accounts/import` | 批量导入,支持 `key【proxy】` 行格式 |

`/v0/management/settings/schema` 让界面由后端元数据驱动,新增配置项不必同步改前端。

### 界面

控制台新增「系统设置」页(`web/src/pages/SettingsPage.tsx`),沿用现有 BF Labs 组件与 `nav.ts` 的 `Page` 联合类型。按上述三类分区,每类一个 `Card`,标注生效方式。

账号页(`AccountTable.tsx`)增加:多选框、批量操作条、行内编辑(备注/优先级/代理)、启用禁用开关、真实探测按钮、导入导出。

现有「测通」按钮语义偏弱(仅测连通性),改为展示真实凭据探测结果,与「额度未返回 / FABLE 5 未开」的诊断口径统一。

## 错误处理

- 配置校验失败:422 + 具体字段原因(沿用现有 `invalid_request` 具名理由的日志惯例)。
- 配置文件损坏:启动时不静默重置,改为失败关闭并在日志指明,保留原文件待人工处理。
- 账号代理不可达:该账号标记 `lastError` 并从轮询中剔除,不影响其他账号。
- 批量操作:逐项独立结果,部分失败返回每项状态而非整笔回滚。

## 测试

新增契约测试:配置读写往返、env 播种仅一次、热生效项即时生效、需重启项标注正确、校验拒绝越界值、原子写入在失败时保留原文件。

代理测试:三级优先解析、ALS 并发隔离(已有探针可转为测试)、开关关闭时不安装 getter、SOCKS5 URL 接受与 PAC 拒绝、代理不可用时账号失败关闭。

账号测试:v1→v2 迁移、优先级分组选择、禁用账号不参与轮询、批量操作部分失败、导入格式解析。

日志断言:配置与代理端点不泄露密钥、代理 URL、密码。
