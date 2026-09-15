# M5 Commerce / 商城基础闭环

## 中文

### Scope
M5 实现商品目录、搜索、商品详情/SKU、购物车、Consumer 地址、结算预览、未支付订单创建、订单列表/详情、UNPAID 订单取消，以及 HQ Admin 商品/SKU 基础管理。M6 微信支付、正式库存预占/扣减、门店履约、退款、配送、租借、动画、AI、佣金均不在本里程碑。

### Architecture
沿用模块化单体、Fastify `/api/v1`、Zod shared contracts、PostgreSQL/Drizzle、native WeChat Mini Program 和 React Admin。Consumer 与 Staff 身份继续分离。

### Data model
新增 `books`, `book_editions`, `products`, `skus`, `product_media`, `carts`, `cart_items`, `user_addresses`, `orders`, `order_items`。金额为 integer minor units。订单保存地址、商品名、SKU 名称/编码、单价、数量和行金额快照。购物车 `(cart_id, sku_id)` 唯一且 quantity 为 1..99。

### Consumer APIs
Public catalog: `GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:id`。Consumer Session 保护：cart CRUD、address CRUD、checkout preview、orders create/list/detail/cancel。所有私有资源从已验证 Session 获取 consumer identity，不接受 consumerUserId。

### Admin capabilities
`catalog.manage` + server-resolved GLOBAL Data Scope 保护 Admin catalog list/create/update。Admin 可维护商品/图书基础资料、SKU code/name、整数价格、商品状态、SKU 状态与可售开关。前端可见性不是授权边界。

### Mini Program flow
首页商城入口 → 商品列表/搜索 → 商品详情/SKU → 购物车 → 地址 → checkout preview → 创建 UNPAID 订单 → 我的订单/详情 → 合法取消。支付位置明确提示 M6 尚未开放。

### Authentication / authorization & ownership isolation
Consumer cart/address/order 查询均绑定 Consumer Session 的 `sub`。Staff 写操作继续使用 Staff Session + RBAC + Data Scope。客户端 `consumerUserId`, `store_id`, price, total, permission 不作为业务权威输入。

### Price authority
客户端创建订单只提交 addressId + clientRequestId。checkout 与 order total 根据数据库当前 SKU price 重新计算；订单项保存价格快照，禁止 float。

### Order state model
数据库保留 PRD 明确状态：UNPAID, PAID, PROCESSING, PICKUP_READY, DELIVERING, COMPLETED, CANCELLED, REFUNDING, REFUNDED。M5 只创建 UNPAID，并只允许 UNPAID → CANCELLED；其他状态由后续里程碑实现。

### Inventory boundary
M5 不创建库存预占、扣减或假库存事务。SKU 只有可售状态；真实门店库存属于后续 M12-M14。商品详情不得把可售状态解释为真实门店数量。

### M6 payment boundary
M5 不调用 `wx.requestPayment`，不创建 payment transaction，不模拟支付成功，不实现 callback/refund/reconciliation。订单创建后保持 UNPAID。

### Tests
共享 contracts 覆盖 quantity、整数价格、订单输入和状态；PostgreSQL integration 覆盖 cart isolation、地址/订单 ownership、服务端价格、不可售 SKU、idempotent clientRequestId 和取消状态；Admin adapter 覆盖 401/403。

### Known limitations
M5 没有正式库存数量、门店履约、运费、优惠、税费、支付、退款。Catalog Admin 当前采用 GLOBAL scope，因为 M12 组织/门店模型尚未进入正式实现。Store Web 不修改：M19 才是门店运营端正式里程碑。

### Next milestone
下一里程碑 M6 仅在 M5 review/merge 后开始，实现真实微信支付与退款/对账安全链路。

## English

### Scope
M5 delivers catalog/search/detail/SKU, cart, consumer addresses, checkout preview, UNPAID order creation, order list/detail, UNPAID cancellation, and basic HQ Admin product/SKU management. WeChat Pay, inventory reservation/deduction, store fulfillment, refunds, delivery, rental, animation, AI and commissions are out of scope.

### Architecture
The existing modular monolith, Fastify `/api/v1`, shared Zod contracts, PostgreSQL/Drizzle, native Mini Program and React Admin are reused. Consumer and Staff identities remain separate.

### Data model
M5 adds `books`, `book_editions`, `products`, `skus`, `product_media`, `carts`, `cart_items`, `user_addresses`, `orders`, and `order_items`. Money uses integer minor units. Orders retain address, product/SKU names and code, unit price, quantity and line-total snapshots. Cart SKU uniqueness and quantity 1..99 are enforced.

### Consumer APIs
Public catalog uses the two catalog GET endpoints. Cart/address/checkout/order endpoints require a verified Consumer Session and derive ownership from its subject rather than accepting consumerUserId.

### Admin capabilities
Admin catalog list/create/update require `catalog.manage` plus server-resolved GLOBAL Data Scope. The UI is never the authorization boundary.

### Mini Program flow
Home commerce entry → catalog/search → detail/SKU → cart → address → checkout preview → UNPAID order → order list/detail → legal cancellation. Payment is visibly deferred to M6.

### Authentication / authorization & ownership isolation
Consumer resources are scoped by verified Consumer Session. Staff writes use existing Staff Session, RBAC and Data Scope. Client consumer IDs, store IDs, prices, totals and permissions are not authoritative.

### Price authority
Order creation accepts addressId and clientRequestId only. The server recalculates totals from current database SKU prices and stores immutable order snapshots.

### Order state model
The database constrains the PRD states. M5 creates only UNPAID orders and permits only UNPAID → CANCELLED.

### Inventory boundary
M5 does not reserve, deduct or fabricate inventory. SKU sale availability is not a store stock quantity; real store inventory belongs to later store/inventory milestones.

### M6 payment boundary
No `wx.requestPayment`, payment transaction, fake success, callback, refund or reconciliation exists in M5. New orders remain UNPAID.

### Tests
Contracts cover quantities, integer money, order input and states. PostgreSQL integration covers ownership isolation, server pricing, unavailable SKUs, idempotent request IDs and cancellation. Admin adapter covers 401/403.

### Known limitations
No stock quantity, store fulfillment, shipping fee, promotion, tax, payment or refund is implemented. Admin catalog is GLOBAL-scoped until the formal organization/store milestones. Store Web is unchanged because its formal operational milestone is M19.

### Next milestone
M6 begins only after M5 review/merge and adds the real WeChat Pay/refund/reconciliation chain.
