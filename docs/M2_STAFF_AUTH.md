# M2-2 员工身份认证
# M2-2 Staff Authentication

## 范围
## Scope

本阶段建立独立于消费者身份的员工账号、密码登录、Staff Session、最小 API 以及 Admin Web 和 Store Web 登录入口。角色、权限、员工角色关联、Data Scope、权限菜单和业务授权均属于 M2-3，不在本阶段实现。

This phase establishes staff accounts, password login, Staff Sessions, a minimal API, and sign-in entry points for Admin Web and Store Web, all separate from consumer identity. Roles, permissions, staff-role assignments, Data Scope, permission menus, and business authorization belong to M2-3 and are not implemented here.

## 数据模型
## Data model

`staff_accounts` 包含 UUID 主键、规范化且唯一的 `login_identifier`、`password_hash`、`enabled`、`created_at`、`updated_at` 和可空的 `last_login_at`。本阶段不创建 roles、permissions、staff_roles 或 staff_data_scopes。

`staff_accounts` contains a UUID primary key, a normalized unique `login_identifier`, `password_hash`, `enabled`, `created_at`, `updated_at`, and nullable `last_login_at`. This phase creates no roles, permissions, staff_roles, or staff_data_scopes.

## API
## API

`POST /api/v1/staff/auth/login` 严格接受 `loginIdentifier` 和 `password`。成功响应仅返回员工账号 ID、规范化登录标识、会话 token 和 `expiresAt`。客户端提交 role、permissions、store_id 或其他额外字段会被拒绝。错误响应沿用统一的 code、message 和 requestId 格式。

`POST /api/v1/staff/auth/login` strictly accepts `loginIdentifier` and `password`. A successful response returns only the staff account ID, normalized login identifier, session token, and `expiresAt`. Client-supplied role, permissions, store_id, or other extra fields are rejected. Errors retain the shared code, message, and requestId format.

## 会话设计
## Session design

Staff Session 使用独立的服务端 `STAFF_SESSION_SECRET` 进行 HMAC-SHA256 签名，默认八小时过期。payload 仅包含版本、固定 `staff` realm、专用员工账号 ID 字段、签发时间和过期时间，不包含角色、权限或门店范围。Consumer Session 保持现有格式不变；Staff Session 使用不同 realm 和字段结构，因此即使错误地配置为相同密钥，两类 token 也不能交叉验证。

Staff Sessions are HMAC-SHA256 signed with an independent server-side `STAFF_SESSION_SECRET` and expire after eight hours by default. The payload contains only a version, fixed `staff` realm, dedicated staff-account ID field, issue time, and expiry—never roles, permissions, or store scope. Consumer Sessions retain their existing format; Staff Sessions use a different realm and field structure, so the two token types cannot validate across realms even if their secrets are mistakenly configured identically.

## 密码安全
## Password security

密码使用 Node.js 标准加密库提供的 scrypt 进行单向哈希，每个账号使用随机 16 字节 salt，并保存算法与参数用于验证。API 和数据库不保存或返回明文密码。账号不存在、密码错误和账号停用均返回相同的公开认证失败错误；不存在账号仍执行一次固定 dummy hash 验证，以减少时间差异。

Passwords are one-way hashed with scrypt from the Node.js standard cryptography library. Each account uses a random 16-byte salt, and the encoded hash records the algorithm and parameters needed for verification. Neither the API nor database stores or returns plaintext passwords. Missing accounts, wrong passwords, and disabled accounts return the same public authentication failure; a missing account still verifies against a fixed dummy hash to reduce timing differences.

## 测试
## Tests

单元测试覆盖密码哈希与验证、正确和错误凭据、未知账号、停用账号、登录标识规范化、last-login 更新调用、Staff Session 有效与过期验证、Consumer/Staff token 双向隔离、严格 API schema 和敏感日志。PostgreSQL integration tests 在 migration 后验证真实账号持久化、非明文 hash、登录、`last_login_at` 和失败路径。

Unit tests cover password hashing and verification, correct and incorrect credentials, missing and disabled accounts, login-identifier normalization, last-login update calls, valid and expired Staff Sessions, bidirectional Consumer/Staff token isolation, strict API schemas, and sensitive logging. PostgreSQL integration tests run after migration and verify real account persistence, non-plaintext hashes, login, `last_login_at`, and failure paths.

## 已知限制
## Known limitations

本阶段不提供员工账号管理 API、密码重置、MFA、refresh token、单会话撤销或集中式登录限流。首批账号必须通过受控的运维流程创建并使用同一 scrypt hasher，禁止直接写入明文。部署层应在 API/WAF 接入基础登录限流；更细粒度的账号管理和审计需后续明确范围。

This phase does not provide staff account management APIs, password reset, MFA, refresh tokens, per-session revocation, or centralized login rate limiting. Initial accounts must be provisioned through a controlled operational process using the same scrypt hasher; plaintext must never be written directly. Deployment should apply baseline login throttling at the API/WAF, while finer account management and audit behavior require later scoped work.

Admin Web 和 Store Web 当前仅提供最小登录表单，并把 session token 保存在标签页级 `sessionStorage`。正式后台路由保护、登出/撤销、CSRF/CSP 加固和权限菜单不在 M2-2；RBAC 与 Data Scope 必须在 M2-3 由服务端实现，不能信任客户端 token 中的授权声明。

Admin Web and Store Web currently provide only minimal sign-in forms and keep the session token in tab-scoped `sessionStorage`. Production route protection, logout/revocation, CSRF/CSP hardening, and permission menus are outside M2-2. RBAC and Data Scope must be implemented server-side in M2-3 and must not trust authorization claims from client tokens.
