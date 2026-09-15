# 前端 Sprint 实现说明 / Frontend Sprint Implementation

## 当前完成 / Current coverage

微信小程序保持固定三项 TabBar：`首页 | 胖竹全球 | 我的`。首页提供小海商城、小海童话动画、小海 AI、分享/活动入口与精选 Demo 内容；胖竹全球提供门店/地图、图书查询、库存、租借、自提/配送、加盟入口；“我的”保留 Consumer WeChat Login，并提供订单、动画、AI 作品、租借、佣金、会员、地址和设置入口。主要二级能力统一进入可复用的功能预览页，明确展示页面结构、Demo/empty 状态与后续 API 接入边界。

The Mini Program keeps the fixed three-item TabBar: `Home | Pangzhu Global | Me`. Home exposes commerce, animation, Xiaohai AI, sharing/activity, and curated demo content; Pangzhu Global exposes stores/map, book search, inventory, rental, pickup/delivery, and franchise entry points; Me preserves Consumer WeChat Login and exposes orders, animation purchases, AI works, rentals, commission, membership, addresses, and settings. Major secondary capabilities use a reusable feature-preview page that clearly presents page structure, demo/empty states, and future API boundaries.

总部 Admin Web 已从登录 placeholder 扩展为 Staff 登录 + Session 恢复 + `/api/v1/staff/me` + App Shell。包含 Dashboard、组织/门店、图书/商品、库存、订单、动画/内容、AI、租借、佣金/财务、CMS/运营、Staff/权限和系统导航。除现有 Staff identity/permissions/dataScopes 外，未完成业务均明确标记为前端预览。

HQ Admin Web now extends the login placeholder into Staff sign-in, session restoration, `/api/v1/staff/me`, and an application shell. Navigation covers Dashboard, organization/stores, catalog/products, inventory, orders, animation/content, AI, rental, commission/finance, CMS/operations, Staff/permissions, and system areas. Apart from the existing Staff identity/permissions/dataScopes context, unfinished business areas are explicitly marked as frontend previews.

门店 Store Web 已扩展为 Staff 登录 + Session 恢复 + `/api/v1/staff/me` + 门店工作台，包含图书查询、库存、租借、订单/自提/配送和基础门店运营入口。

Store Web now includes Staff sign-in, session restoration, `/api/v1/staff/me`, and a store workspace with book search, inventory, rental, orders/pickup/delivery, and basic store-operations entry points.

## Mock 与真实 API 边界 / Mock and real API boundary

Mini Program 未完成业务数据集中在 `apps/miniapp/services/mock.ts`。Admin/Store 的模块预览数据分别集中在各自的 `mock-data.ts`。页面组件不直接散落大批业务假数据。当前 mock 只用于布局、导航、loading/empty/coming-soon 与视觉验证，不写生产数据库，也不声称发生真实支付、库存扣减、订单履约、租借、配送、佣金结算或 AI 生成。

Unfinished Mini Program business data is centralized in `apps/miniapp/services/mock.ts`. Admin and Store preview metadata is centralized in each app's `mock-data.ts`. Page components do not scatter large business mock objects. Current mocks exist only for layout, navigation, loading/empty/coming-soon, and visual validation; they do not write production data or claim real payments, inventory deductions, order fulfillment, rentals, delivery, commission settlement, or AI generation.

## Auth 与权限 / Auth and authorization

Consumer WeChat Login 继续使用现有 `/api/v1/auth/wechat/login` 流程。Admin/Store 继续使用现有 Staff Login，并使用 Staff Session 调用 `GET /api/v1/staff/me`。401 会清理标签页 session 并回到登录。Web 显示 permission keys 和 dataScopes 仅用于当前 Staff 授权上下文展示，不是安全边界；真实业务授权仍必须由服务端 RBAC + Data Scope 执行，客户端 role/storeId/permission 不授予访问权。

Consumer WeChat Login continues to use the existing `/api/v1/auth/wechat/login` flow. Admin/Store continue to use existing Staff Login and use the Staff Session with `GET /api/v1/staff/me`. A 401 clears the tab session and returns to sign-in. Web-visible permission keys and dataScopes only display the current Staff authorization context and are not a security boundary; production business authorization must remain enforced by server-side RBAC + Data Scope, and client role/storeId/permission values never grant access.

## 后续 API 接入点 / Future API integration points

后续对应里程碑应保持页面结构，逐步将集中 mock service 替换为版本化 `/api/v1` service adapters，并使用共享 contracts/validation。商城、库存、订单、支付、内容、AI、门店、租借、配送、加盟、佣金和 CMS 的正式 API 不属于本 Sprint。

Later milestones should preserve the page structure while replacing centralized mock services with versioned `/api/v1` service adapters and shared contracts/validation. Production APIs for commerce, inventory, orders, payments, content, AI, stores, rental, delivery, franchise, commission, and CMS are outside this sprint.

## 已知限制 / Known limitations

本 Sprint 没有增加业务数据库 schema/migration，也没有开始 M3 美萍迁移。小程序的正式地图、真实门店/库存、支付、媒体播放、AI 调用、分享归因等仍待对应里程碑。Web 使用轻量 hash 导航以避免为了前端框架引入大型路由依赖；未来复杂嵌套路由可在需求明确后评估。

This sprint adds no business database schema/migration and does not start M3 Meiping migration. Production maps, real stores/inventory, payment, media playback, AI calls, and sharing attribution remain for their corresponding milestones. Web clients use lightweight hash navigation to avoid adding a large routing dependency for the shell; richer nested routing can be evaluated when requirements are concrete.

## 微信开发者工具验证 / WeChat DevTools validation

本次远程执行环境无法访问用户本地微信开发者工具，因此这里只能确认代码、TypeScript/build 与 CI 层面的结果，不能声称完成 DevTools 或真机验证。合并前仍需在 `/Volumes/Data/Xiaohai/apps/miniapp` 重新编译，重点检查三项 TabBar、二级页跳转、微信登录、滚动/安全区、不同机型布局与真实 AppID 网络行为。

This remote execution environment cannot access the user's local WeChat DevTools, so only code, TypeScript/build, and CI-level results can be confirmed; DevTools or real-device validation is not claimed. Before merge, rebuild `/Volumes/Data/Xiaohai/apps/miniapp` and verify the three-item TabBar, secondary-page navigation, WeChat login, scrolling/safe areas, device layouts, and real-AppID network behavior.
