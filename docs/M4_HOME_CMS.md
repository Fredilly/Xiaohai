# M4 首页与 CMS / M4 Home and CMS

## 范围
M4 将 Frontend Sprint 的首页/CMS preview 升级为 PostgreSQL 驱动的正式首页运营配置。范围只包含固定 `HOME` 页面、首页 Section、Public Home API、Staff CMS API、Admin Web 管理页和微信小程序首页接入；不开始商城、订单、库存、支付、付费动画、AI、租借、配送、加盟或佣金正式后端。

## Scope
M4 upgrades the Frontend Sprint home/CMS preview into PostgreSQL-backed production-direction home configuration. Scope is limited to the fixed `HOME` page, home sections, Public Home API, Staff CMS API, Admin Web management, and Mini Program home integration; it does not start production commerce, orders, inventory, payment, paid animation, AI, rental, delivery, franchise, or commission backends.

## 数据模型
`cms_pages` 保存固定页面 identity、标题、publication state、version 和时间戳。`cms_sections` 保存 page FK、section type、标题/副标题、确定性 display order、enabled、结构化 config、可选 media URL、可选 action、publication state、version 和时间戳。数据库约束 publication/type/order/version，并用 `(page_id, display_order)` 唯一索引保证顺序确定性。M4 migration 初始化唯一 `HOME` page，并注册稳定 permission key `cms.home.manage`，但不会自动把权限授予任何角色。

## DB model
`cms_pages` stores fixed page identity, title, publication state, version, and timestamps. `cms_sections` stores page FK, section type, title/subtitle, deterministic display order, enabled flag, structured config, optional media URL, optional action, publication state, version, and timestamps. Database constraints protect publication/type/order/version and a unique `(page_id, display_order)` index makes ordering deterministic. The M4 migration seeds the single `HOME` page and stable permission key `cms.home.manage`, but does not automatically grant it to any role.

## Public Home API
`GET /api/v1/home` 不要求 Consumer 或 Staff token。只有当 HOME page 为 `PUBLISHED` 时才读取内容，并且只返回同时 `PUBLISHED + enabled` 的 Section，按 `display_order, id` 稳定排序。响应不包含 enabled、publication state、version、updatedAt 或 Staff/CMS 内部安全字段。数据库中无法通过共享 contract 的未知/损坏 Section 会 fail safely，不进入公开响应。

## Public Home API
`GET /api/v1/home` requires no Consumer or Staff token. Content is exposed only when the HOME page is `PUBLISHED`, and only sections that are both `PUBLISHED + enabled` are returned, ordered by `display_order, id`. The response excludes enabled, publication state, version, updatedAt, and Staff/CMS security metadata. Unknown or malformed stored sections that fail the shared contract fail safely and are omitted from the public response.

## Admin CMS API
Staff API 为 `GET /api/v1/staff/cms/home`、`POST /api/v1/staff/cms/home/sections`、`PATCH /api/v1/staff/cms/home/sections/:id`、`PUT /api/v1/staff/cms/home/sections/reorder` 和 `PATCH /api/v1/staff/cms/home/publication`。创建/修改输入通过共享 Zod contract 校验；Section config 按 `HERO / FEATURE_GRID / CONTENT_LIST / BANNER` 类型校验，不接受任意 JSON 作为可信输入。400=validation，401=Staff authentication，403=authorization，404=resource missing，409=optimistic concurrency/display-order conflict。

## Admin CMS API
Staff endpoints are `GET /api/v1/staff/cms/home`, `POST /api/v1/staff/cms/home/sections`, `PATCH /api/v1/staff/cms/home/sections/:id`, `PUT /api/v1/staff/cms/home/sections/reorder`, and `PATCH /api/v1/staff/cms/home/publication`. Create/update input is validated by shared Zod contracts; section config is validated by `HERO / FEATURE_GRID / CONTENT_LIST / BANNER` type instead of trusting arbitrary JSON. 400 means validation, 401 Staff authentication, 403 authorization, 404 missing resource, and 409 optimistic-concurrency/display-order conflict.

## 权限模型
所有 Admin CMS 访问都先使用现有 Staff Session，再由 `StaffAuthorizationService` 从数据库重新解析授权。M4 要求 `cms.home.manage` permission 和 `GLOBAL` Data Scope，因为首页是全局运营内容。客户端提交的 role、permission、scope 或 storeId 从不参与授权。Consumer token、disabled Staff、缺权限 Staff 均 fail closed。

## Permission model
All Admin CMS access first uses the existing Staff Session and then lets `StaffAuthorizationService` resolve current authorization from PostgreSQL. M4 requires the `cms.home.manage` permission plus `GLOBAL` Data Scope because home content is global. Client-supplied roles, permissions, scopes, or storeIds never authorize access. Consumer tokens, disabled Staff, and Staff without permission fail closed.

## 发布语义
HOME page 与每个 Section 都有独立 `DRAFT/PUBLISHED`。公开展示条件为：page=PUBLISHED 且 section=PUBLISHED 且 enabled=true。enabled 用于临时运营开关；DRAFT/PUBLISHED 表示发布生命周期。取消 page 发布会让公开首页返回空 sections，但不会删除草稿或 Section。

## Publication semantics
The HOME page and every section independently use `DRAFT/PUBLISHED`. Public visibility requires page=PUBLISHED, section=PUBLISHED, and enabled=true. `enabled` is an operational switch while DRAFT/PUBLISHED is the publication lifecycle. Unpublishing the page makes the public endpoint return no sections without deleting drafts or sections.

## 并发策略
Page 和 Section 都有单调递增 `version`。编辑请求必须提交读到的 version；更新使用 `id + version` 条件并原子递增。版本不匹配返回 409，不静默覆盖。排序请求携带每个 Section 的 version，并在事务中先验证所有版本，再使用临时顺序值避免唯一索引交换冲突，最后写入目标顺序并递增版本。

## Concurrency strategy
Pages and sections have monotonically increasing `version` values. Edit requests submit the version they read; updates use an `id + version` predicate and atomically increment the version. A mismatch returns 409 instead of silently overwriting. Reorder requests carry every section version and validate all versions inside one transaction, use temporary order values to avoid unique-index swap conflicts, then write final positions and increment versions.

## Mini Program 集成
固定 TabBar 仍为 `首页 | 胖竹全球 | 我的`。首页通过 `/api/v1/home` 加载服务端 Section，提供 loading/success/empty/error/retry；未知 section type 在 adapter 层被安全忽略，不让整个首页崩溃。CMS action 目前只允许 `PREVIEW` target，继续进入 Frontend Sprint 的 feature preview 页面，不会提前调用 M5+ 正式后端。Consumer WeChat Login 未修改。

## Mini Program integration
The fixed TabBar remains `Home | Pangzhu Global | Me`. Home loads server sections from `/api/v1/home` with loading/success/empty/error/retry states; unknown section types are safely ignored by the adapter instead of crashing the page. CMS actions currently allow only `PREVIEW` targets, which continue to the Frontend Sprint feature preview rather than calling M5+ production backends. Consumer WeChat Login is unchanged.

## Admin Web 集成
`CMS / 运营` 不再使用该模块的 preview 数据作为正式内容源。页面通过真实 Staff CMS adapter 加载 Section，并支持新增、标题编辑、排序、enabled、Section publish/unpublish、Page publish/unpublish、保存反馈、loading/empty/error、401/403/409 状态。UI 可见性不是安全边界，API 独立鉴权。

## Admin Web integration
`CMS / Operations` no longer uses preview data as its production content source. It loads sections through the real Staff CMS adapter and supports create, title edit, reorder, enabled state, section publish/unpublish, page publish/unpublish, save feedback, loading/empty/error, and 401/403/409 states. UI visibility is not a security boundary; the API authorizes independently.

## 安全边界
Consumer 与 Staff identity 保持分离；Staff authorization 继续 server-side RBAC + Data Scope；Public API 只读公开内容；CMS JSON 在 API boundary 验证；不记录 token/password/hash/secret；media 仅为 URL/reference boundary，M4 不建立完整对象存储/CDN 管理系统。

## Security boundaries
Consumer and Staff identities remain separate; Staff authorization remains server-side RBAC + Data Scope; the public API reads public content only; CMS JSON is validated at the API boundary; tokens/passwords/hashes/secrets are not logged; media is only a URL/reference boundary and M4 does not build a full object-storage/CDN management system.

## 测试
M4 tests 覆盖 DB type/order constraints、公开 published+enabled 过滤与稳定排序、非法 section/config、401、403、authorized write、disabled Staff、Consumer token 隔离、stale version 409、enable/disable、publish/unpublish、未知 section type 的 Mini Program 安全映射，以及 Admin adapter 的 401/403/409 映射。

## Testing
M4 tests cover DB type/order constraints, public published+enabled filtering and stable ordering, invalid section/config, 401, 403, authorized writes, disabled Staff, Consumer-token isolation, stale-version 409, enable/disable, publish/unpublish, Mini Program safe mapping of unknown section types, and Admin adapter mapping for 401/403/409.

## 已知限制
M4 没有完整媒体资产/CDN 管理、审计日志 UI、角色/权限 provisioning UI，也不实现任何 M5+ 正式业务。`cms.home.manage` 只注册 permission key；现有 RBAC provisioning 流程需要由授权人员把它分配给适当的 GLOBAL Staff role。

## Known limitations
M4 does not include full media/CDN management, an audit-log UI, role/permission provisioning UI, or any M5+ production business. `cms.home.manage` only registers the permission key; the existing RBAC provisioning process must assign it to an appropriate GLOBAL Staff role.

## M5 边界
M5 可让 CMS `PREVIEW` action 逐步替换为经过 contract 审核的正式商城导航目标，但 M4 不创建 catalog/product/cart/order/inventory/payment schema 或 API。

## M5 boundary
M5 may progressively replace CMS `PREVIEW` actions with reviewed production commerce navigation targets, but M4 creates no catalog/product/cart/order/inventory/payment schema or API.
