# M2-1 消费者微信身份认证
# M2-1 Consumer WeChat Authentication

## 范围
## Scope

本阶段仅提供消费者微信登录、消费者身份数据模型和最小消费者会话。Staff 身份认证、RBAC、Data Scope 以及所有业务功能均不在本阶段范围内。

This phase provides only consumer WeChat login, the consumer identity data model, and a minimal consumer session. Staff authentication, RBAC, Data Scope, and all business features are out of scope.

## 登录流程
## Login flow

1. 小程序通过 `wx.login()` 获取一次性临时 `code`，并仅向 `POST /api/v1/auth/wechat/login` 发送该值。
2. API 通过集中式 WeChat provider 调用 `code2Session`，使用服务端注入的 AppID 与 AppSecret。
3. API 只接受微信服务端响应中的 `openid`，并通过 `app_id + openid` 查找身份。
4. 首次登录在同一事务中创建 `consumer_users` 与 `wechat_identities`；重复登录复用现有消费者身份。
5. API 签发有过期时间的消费者会话凭证，仅返回消费者公开 ID、凭证和过期时间。

1. The Mini Program obtains a one-time temporary `code` through `wx.login()` and sends only that value to `POST /api/v1/auth/wechat/login`.
2. The API calls `code2Session` through the centralized WeChat provider, using the server-injected AppID and AppSecret.
3. The API accepts `openid` only from the WeChat server response and looks up identity by `app_id + openid`.
4. A first login creates `consumer_users` and `wechat_identities` in one transaction; repeat logins reuse the existing consumer identity.
5. The API issues an expiring consumer session credential and returns only the public consumer ID, credential, and expiry.

## 安全模型
## Security model

请求契约是严格模式，客户端附带 `openid` 等额外字段会被拒绝。AppSecret、临时 `code`、`openid`、`session_key` 与会话密钥不会写入应用日志；`session_key` 不会保存或返回客户端。配置示例只包含占位符，预发布和生产真实值必须由密钥管理系统注入。

The request contract is strict, so extra fields such as a client-supplied `openid` are rejected. AppSecret, temporary `code`, `openid`, `session_key`, and the session signing secret are not written to application logs; `session_key` is neither stored nor returned to the client. Configuration examples contain placeholders only, and real staging and production values must be injected by a secret manager.

## 数据模型
## DB model

`consumer_users` 保存最小消费者主体。`wechat_identities` 通过外键关联消费者，`app_id + openid` 具有数据库唯一约束；`unionid` 可为空。删除消费者时其微信身份级联删除。本阶段不创建 Staff、权限、业务或支付相关表。

`consumer_users` stores the minimal consumer principal. `wechat_identities` references the consumer through a foreign key, enforces database uniqueness on `app_id + openid`, and permits a null `unionid`. Deleting a consumer cascades to its WeChat identity. This phase creates no Staff, permission, business, or payment tables.

## API 契约
## API contract

`POST /api/v1/auth/wechat/login` 接受 `{ "code": "..." }`。成功响应包含 `consumer.id` 以及 `session.token` 和 `session.expiresAt`。错误响应统一为 `error.code`、`error.message` 和 `error.requestId`，响应头同时包含 `x-request-id`。

`POST /api/v1/auth/wechat/login` accepts `{ "code": "..." }`. A successful response contains `consumer.id` plus `session.token` and `session.expiresAt`. Error responses consistently include `error.code`, `error.message`, and `error.requestId`, and the response header also includes `x-request-id`.

## 会话策略
## Session strategy

API 使用服务端密钥生成 HMAC-SHA256 签名的消费者会话。负载仅包含版本、消费者 ID、签发时间和过期时间，默认有效期为七天，可通过 `CONSUMER_SESSION_TTL_SECONDS` 调整。校验采用恒定时间签名比较，并拒绝损坏、伪造或已过期凭证。

The API creates an HMAC-SHA256-signed consumer session using a server-side secret. Its payload contains only a version, consumer ID, issue time, and expiry. The default lifetime is seven days and can be adjusted with `CONSUMER_SESSION_TTL_SECONDS`. Validation uses constant-time signature comparison and rejects malformed, forged, or expired credentials.

## 测试
## Testing

单元测试覆盖请求和响应校验、成功登录、无效 code、provider 失败、缺失 `openid`、敏感数据不泄露，以及有效、过期和无效会话。PostgreSQL 集成测试覆盖唯一约束、首次创建与重复登录复用；CI 在 migration 后运行该测试套件。

Unit tests cover request and response validation, successful login, invalid codes, provider failure, missing `openid`, sensitive-data non-disclosure, and valid, expired, and invalid sessions. PostgreSQL integration tests cover uniqueness, first-time creation, and repeat-login reuse; CI runs this suite after migration.

## 手动验证
## Manual verification

1. 启动本地 PostgreSQL，执行 `pnpm --filter @xiaohai/db db:migrate` 并启动 API。
2. 在未提交的本地 `.env` 中设置真实测试 AppID、AppSecret 与至少 32 字符的随机会话密钥。
3. 在微信开发者工具的私有配置中选择对应 AppID，并确保合法域名或本地调试设置允许访问 API。
4. 点击最小页面的“微信登录”，确认显示消费者 ID，且网络响应不含 `openid` 或 `session_key`。

1. Start local PostgreSQL, run `pnpm --filter @xiaohai/db db:migrate`, and start the API.
2. Set a real test AppID, AppSecret, and a random session secret of at least 32 characters in the uncommitted local `.env`.
3. Select the matching AppID in the private WeChat DevTools configuration and ensure domain allowlisting or local debug settings permit API access.
4. Select “微信登录” on the minimal page, confirm that a consumer ID appears, and verify that the network response contains neither `openid` nor `session_key`.

## 已知限制
## Known limitations

游客 AppID 无法完成真实 `code2Session`，最终集成验证需要真实测试 AppID 和微信授权环境。当前最小签名会话在到期前不可单独撤销；密钥轮换会使现有会话全部失效。正式撤销、刷新与多设备策略留待后续明确范围决定，本任务不扩展到 Staff Auth 或 RBAC。

The tourist AppID cannot complete a real `code2Session`; final integration verification requires a real test AppID and authorized WeChat environment. The current minimal signed session cannot be individually revoked before expiry, and rotating its key invalidates all existing sessions. Formal revocation, refresh, and multi-device policies remain later scoped decisions; this task does not expand into Staff Auth or RBAC.
