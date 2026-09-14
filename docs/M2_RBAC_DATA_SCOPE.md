# M2-3 RBAC + Data Scope
# M2-3 RBAC + Data Scope

## 范围
## Scope

M2-3 在 M2-2 已建立的可信 Staff Identity 基础上增加统一的服务端授权基础：Staff Identity → Role → Permission → Data Scope。当前阶段只建立可复用的数据模型、服务端解析/判断、最小验证接口和测试，不提供角色、权限、Data Scope 或 Staff Account 的正式管理 UI/API，也不开始 M3 或任何商城、库存、订单、支付、租借、佣金、AI、CMS 等业务功能。

M2-3 adds a unified server-side authorization foundation on top of the trusted Staff Identity established in M2-2: Staff Identity → Role → Permission → Data Scope. This phase only establishes the reusable data model, server-side resolution/enforcement, minimal verification endpoints, and tests. It does not provide production management UI/APIs for roles, permissions, Data Scope, or Staff Accounts, and it does not start M3 or any commerce, inventory, order, payment, rental, commission, AI, CMS, or other business functionality.

## RBAC 数据模型
## RBAC data model

`roles` 和 `permissions` 使用稳定、机器可读的 `key` 作为授权依据，展示名称仅用于说明。`staff_roles` 支持一个 Staff Account 绑定多个角色，`role_permissions` 支持一个角色绑定多个权限；两个关联表使用复合主键避免重复分配。角色、权限 key 均有唯一约束，关联表带外键和必要索引。

`roles` and `permissions` use stable machine-readable `key` values as the authorization authority; display names are descriptive only. `staff_roles` allows one Staff Account to have multiple roles, while `role_permissions` allows one role to have multiple permissions. Both join tables use composite primary keys to prevent duplicate assignments. Role and permission keys are unique, and assignment tables have foreign keys and supporting indexes.

权限 key 采用可扩展的 `resource.action` 风格，例如测试使用的 `staff.profile.read`、`catalog.read`、`scope.probe`。M2-3 不枚举未来所有业务权限。

Permission keys use an extensible `resource.action` style, for example the test permissions `staff.profile.read`, `catalog.read`, and `scope.probe`. M2-3 does not enumerate all future business permissions.

## Data Scope 模型
## Data Scope model

`staff_data_scopes` 当前支持四种 `scope_type`：`GLOBAL`、`REGION`、`FRANCHISEE`、`STORE`。`GLOBAL` 必须使用空 `scope_id`；其他类型必须提供 UUID `scope_id`。数据库 CHECK 约束保证这一形状，唯一索引避免同一 Staff 重复写入相同非空范围，另有 Staff 和目标范围查询索引。

`staff_data_scopes` currently supports four `scope_type` values: `GLOBAL`, `REGION`, `FRANCHISEE`, and `STORE`. `GLOBAL` must use a null `scope_id`; all other types require a UUID `scope_id`. A database CHECK constraint enforces this shape, a unique index prevents duplicate identical non-null assignments for the same Staff account, and supporting indexes cover Staff and target-scope lookups.

当前数据库尚未建立正式 `regions` / `franchisees` / `stores` 组织实体，因此 `scope_id` 本阶段不能建立到这些未来表的 FK。后续组织模型落地时，应通过正式组织实体和服务端关系解析补充 FK/一致性约束，并在授权层安全展开 REGION/FRANCHISEE 到下级范围。

The database does not yet contain the production `regions` / `franchisees` / `stores` organization entities, so `scope_id` cannot reference those future tables with foreign keys in this phase. When the organization model is introduced, production entities and server-side relationship resolution must add the appropriate FK/integrity constraints and safely expand REGION/FRANCHISEE scopes to subordinate resources.

在组织关系尚不可证明时，授权层只接受 `GLOBAL` 或完全相同的 `scope_type + scope_id`。例如 REGION scope 不会自行推断某个 STORE 属于该 Region；无法证明时默认拒绝。

Until organization relationships can be proven, the authorization layer only accepts `GLOBAL` or an exact `scope_type + scope_id` match. For example, a REGION scope does not guess that a STORE belongs to that Region; unprovable relationships are denied by default.

## 服务端认证与授权流程
## Server-side authentication and authorization flow

受保护 Staff 请求通过 `StaffAuthorizationService.authenticate()` 从 `Authorization: Bearer <token>` 验证 M2-2 Staff Session，并只从已签名 token 中获取可信 `staffAccountId`。随后服务端重新查询 `staff_accounts.enabled`、`staff_roles`、`roles`、`role_permissions`、`permissions` 和 `staff_data_scopes`，生成当前授权上下文。

Protected Staff requests use `StaffAuthorizationService.authenticate()` to verify the M2-2 Staff Session from `Authorization: Bearer <token>` and obtain only the trusted `staffAccountId` from the signed token. The server then re-queries `staff_accounts.enabled`, `staff_roles`, `roles`, `role_permissions`, `permissions`, and `staff_data_scopes` to build the current authorization context.

Staff token 不新增 role、permission、store_id、region_id 或 franchisee_id 等长期授权声明。角色/权限或 Data Scope 分配被移除后，下一次请求会直接反映数据库最新状态；本阶段不引入授权缓存。

The Staff token does not gain long-lived role, permission, store_id, region_id, franchisee_id, or similar authorization claims. Removing a role/permission or Data Scope assignment is reflected on the next request because authorization is resolved from the database each time; M2-3 introduces no authorization cache.

客户端提交的 `role`、`permission`、`staffAccountId`、`store_id`、`region_id`、`franchisee_id` 等字段从不成为授权来源。客户端可以提交一个目标范围供服务器检查，但它不能通过改变该值获得未被服务端授予的访问权。

Client-supplied `role`, `permission`, `staffAccountId`, `store_id`, `region_id`, `franchisee_id`, or similar fields are never authorization sources. A client may submit a target scope for the server to evaluate, but changing that target cannot grant access that was not assigned server-side.

## 统一判断
## Unified checks

`hasPermission()` / `requirePermission()` 统一检查服务端解析出的 permission keys。`canAccessScope()` / `requireDataScope()` 统一检查服务端保存的 Data Scope。所有判断遵循 default deny / fail closed：未找到明确授予即拒绝。

`hasPermission()` / `requirePermission()` centrally check server-resolved permission keys. `canAccessScope()` / `requireDataScope()` centrally check server-stored Data Scope. All checks follow default deny / fail closed: absence of a provable grant means denial.

## 401 与 403
## 401 vs 403

401 用于缺少 Staff authentication、无效/过期 Staff Session、Consumer token 误用于 Staff endpoint，以及 token 指向不存在或已 disabled 的 Staff Account。403 用于已成功认证的 Staff 缺少要求的 permission 或 Data Scope。

401 is used for missing Staff authentication, invalid/expired Staff Sessions, Consumer tokens presented to Staff endpoints, and tokens whose Staff Account no longer exists or is disabled. 403 is used when an authenticated Staff member lacks the required permission or Data Scope.

## 最小验证接口
## Minimal verification endpoints

`GET /api/v1/staff/me` 返回服务端解析的 Staff 基本身份、permission keys 和 Data Scopes。`GET /api/v1/staff/authorization/probe` 是 M2-3 的最小授权验证接口：它接受目标 permission 和 scope，但最终 allow/deny 只由服务端数据库授权数据决定。该 probe 不是正式业务 API。

`GET /api/v1/staff/me` returns server-resolved Staff identity, permission keys, and Data Scopes. `GET /api/v1/staff/authorization/probe` is the minimal M2-3 authorization verification endpoint: it accepts a target permission and scope, but the final allow/deny result is determined solely by server-side database authorization data. The probe is not a production business API.

## 测试
## Tests

单元测试覆盖有效 Staff token、missing/invalid/expired token、Consumer token 隔离、disabled/missing Staff、permission default deny、GLOBAL、正确 STORE、其他 STORE、无 scope 和无法证明的层级关系。PostgreSQL integration tests 覆盖多角色权限合并、401/403 区分、角色分配移除、permission 分配移除、disabled Staff、GLOBAL/STORE/no-scope 行为、客户端伪造目标 store 不能绕过，以及 RBAC/Data Scope 的唯一约束、FK 和 CHECK 约束。

Unit tests cover valid Staff tokens, missing/invalid/expired tokens, Consumer-token isolation, disabled/missing Staff, permission default deny, GLOBAL, correct STORE, other STORE, no scope, and unprovable hierarchy relationships. PostgreSQL integration tests cover multi-role permission union, 401/403 distinction, role-assignment removal, permission-assignment removal, disabled Staff, GLOBAL/STORE/no-scope behavior, inability to bypass authorization by forging a target store, and RBAC/Data Scope uniqueness, foreign-key, and CHECK constraints.

原有 Consumer WeChat Auth 和 M2-2 Staff Authentication 路径保持不变，只在 API 组装处共享同一个 `StaffSessionService` 给登录签发和受保护请求验证。

Existing Consumer WeChat Auth and M2-2 Staff Authentication behavior remains unchanged. The only integration adjustment is that API composition shares the same `StaffSessionService` between Staff login issuance and protected-request verification.

## 安全考虑
## Security considerations

授权信息只从服务端数据库读取；Web 菜单可见性不是安全边界。日志只记录 requestId、公开错误码和安全的上下文，不记录 session token、password、hash 或 secret。权限/Data Scope 不做 Redis 或进程缓存，以避免本阶段出现失效延迟。所有未明确证明的范围关系 fail closed。

Authorization data is read only from the server-side database; Web menu visibility is not a security boundary. Logs contain requestId, public error codes, and safe context only, never session tokens, passwords, hashes, or secrets. Permission/Data Scope data is not cached in Redis or process memory, avoiding invalidation delay in this phase. Any scope relationship that cannot be explicitly proven fails closed.

## 已知限制
## Known limitations

M2-3 不提供 Staff Account、Role、Permission 或 Data Scope 的正式 provisioning/management API 或 UI。测试分配通过 integration fixtures 创建。M2-2 的 Staff Account provisioning 规则仍然有效：任何真实 Staff Account 写入必须先使用与登录相同的 `normalizeStaffLoginIdentifier`（trim → NFKC → lowercase），不得直接写入未经规范化的 `login_identifier`。

M2-3 provides no production provisioning/management API or UI for Staff Accounts, Roles, Permissions, or Data Scope. Test assignments are created through integration fixtures. The M2-2 Staff Account provisioning rule remains in force: every real Staff Account write must first use the same `normalizeStaffLoginIdentifier` as login (trim → NFKC → lowercase), and unnormalized `login_identifier` values must not be written directly.

正式组织表尚未存在，因此 REGION/FRANCHISEE 的下级展开暂未实现；当前精确匹配 + GLOBAL 是有意的安全限制。未来正式角色/权限/组织管理 API、组织树解析、完整 Audit 系统、动态权限菜单均不属于 M2-3。

Production organization tables do not yet exist, so descendant expansion for REGION/FRANCHISEE is intentionally not implemented; exact matching plus GLOBAL is the current safe boundary. Future production role/permission/organization management APIs, organization-tree resolution, a complete Audit system, and dynamic permission menus are outside M2-3.
