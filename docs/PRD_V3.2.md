# 小海童话 2.0 / Xiaohai Fairytale 2.0 — Production V1 PRD V3.2

## 1. 目标 / Goal
从零重建可正式运营的小海童话 2.0：**儿童内容 + 图书商城 + AI 创作 + 胖竹全球书店网络**。

Rebuild Xiaohai 2.0 as a production system combining **children's content + book commerce + AI creation + the Pangzhu global bookstore network**.

不是 Demo。旧源码不可用。美萍只迁图书主数据和当前库存。

## 2. 产品结构 / Product structure
微信小程序固定 TabBar：`首页 | 胖竹全球 | 我的`。

- 首页 / Home: 小海商城、故事/动画、小海AI、运营内容。
- 小海商城 / Commerce: 图书优先，预留文创/玩具/服务/课程。
- 小海童话 / Content: 故事、动画、免费/试看/付费权益、播放进度。
- 小海AI / AI: 故事、绘本、动画三个独立创作流程。
- 胖竹全球 / Pangzhu Global: 门店、地图、找书、库存、购买、租借、自提、配送、加盟。
- 我的 / Me: 订单、已购、AI作品、租借、佣金、会员、地址、设置。

## 3. 商城与订单 / Commerce & orders
图书详情至少包含封面、书名、作者、ISBN、出版社、价格、简介、库存与履约方式。支持购物车、地址、结算、订单、取消、退款。

Order states include unpaid, paid, processing, pickup-ready, delivering, completed, cancelled, refunding and refunded.

微信支付必须支持服务端创建、回调验签、幂等、支付流水、退款和对账。

## 4. 小海童话 / Stories & animation
支持列表、分类、搜索、详情、推荐、免费/试看、付费解锁、播放进度、继续观看、我的已购。媒体走对象存储 + CDN。

## 5. 小海AI / Xiaohai AI
### 故事 / Story
想法 → 年龄/主题/风格 → 大纲 → 正文 → 修改/续写/润色 → 保存。

### 绘本 / Picture book
故事 → 角色设定 → 分页/分镜 → 插画 → 排版 → 封面 → 整书预览 → 保存。主要角色需要尽可能保持视觉一致；预留 PDF/印刷。

### 动画 / Animation
故事 → 脚本 → 分镜 → 角色/场景 → 异步生成 → 声音/字幕/音乐（按能力）→ 合成 → 预览 → 保存。

AI jobs must support queued/running/succeeded/failed/cancelled, retry, timeout, moderation, usage/cost and logs.

## 6. 胖竹全球 / Pangzhu Global
不是单纯地图，而是门店、库存、交易、租借、配送与加盟平台。

组织模型 / Organization:
`总部 HQ → 国家/区域 Region → 加盟商 Franchisee → 门店 Store → 员工 Staff`

支持国家/城市/区域筛选、附近门店、名称搜索、地图、门店详情、营业信息、服务项目与导航。

## 7. 找书与库存 / Book search & inventory
支持书名、作者、出版社、ISBN/条码搜索。用户能直接看到哪些门店有货、可售/可租状态，以及购买/租借/自提/配送入口。

Every inventory change must create a transaction. Support purchase receipt, sale, rental, return, stocktake, adjustment, transfer and return-to-supplier flows.

## 8. 美萍迁移 / Meiping migration
只迁：图书主数据 + 当前门店库存。

Do not migrate members, historical sales, historical finance, historical rentals, suppliers, legacy logs or commission history.

流程 / Flow:
`Export → Raw Archive → Staging → Normalize/Dedupe → Dry Run → Review → Import → Reconcile → New System SoT`

重复 ISBN、空 ISBN、异常条码、负库存等必须报告，不得静默丢弃。

## 9. 租借、自提、配送 / Rental, pickup & delivery
Rental: search → reserve → pickup → borrowed → return, including overdue handling.

Commerce supports store pickup and local delivery. Delivery providers sit behind an adapter.

## 10. 加盟 / Franchise
用户端展示介绍、条件、流程和申请；后台支持线索、分配、跟进、审核、签约、筹备和开店状态。

## 11. 分享与佣金 / Referral & commission
分享链接/二维码 → 归因 → 有效订单 → 佣金冻结 → 可结算 → 提现。

The known ~6% rate is **not final**. It must remain configurable until basis, eligibility, settlement, refund reversal, withdrawal and compliance are confirmed. Every commission movement uses a ledger.

## 12. 后台与门店端 / Admin & Store Web
HQ Admin: users, catalog, content, AI, stores, inventory, procurement, orders, rentals, delivery, franchise, payments/refunds, commission, finance, CMS, RBAC, audit and configuration.

Store Web: search, stock, receipts/issues, orders, pickup verification, rental/return, delivery, stocktake, transfer and manager functions based on role.

## 13. 权限 / Permissions
Consumer and Staff identities are separate. Staff authorization is **RBAC + Data Scope** enforced server-side. Store/region/HQ boundaries cannot rely on frontend visibility or client-supplied IDs.

## 14. 安全与儿童保护 / Safety & child protection
Privacy, guardian requirements where applicable, content moderation, AI-generated-content handling, copyright, secure uploads, least privilege, audit, log redaction and production secret management are required for V1.

## 15. 技术原则 / Technical principles
Production V1 uses native WeChat Mini Program + TypeScript, shared API, PostgreSQL as the system of record, object storage + CDN for media, queue/worker for long AI/media jobs, and server-side integrations for WeChat Pay/AI/maps/delivery.

## 16. 性能与可靠性 / Performance & reliability
Use mini-program subpackages, lazy loading, compressed media, indexed queries, API aggregation where useful, caching only where safe, async AI jobs, structured logs, monitoring, backups and restore testing. Final SLOs are set in the implementation plan.

## 17. Delivery milestones / 交付阶段
M0 plan; M1 foundation; M2 identity/RBAC; M3 Meiping migration; M4 home/CMS; M5 commerce; M6 payment/refund; M7 content/animation; M8 AI platform; M9 story; M10 picture book; M11 animation; M12 stores; M13 search/inventory; M14 inventory operations; M15 rental; M16 pickup/delivery; M17 franchise; M18 referral/commission; M19 Store Web; M20 HQ Admin; M21 finance/audit; M22 security/privacy; M23 performance/reliability; M24 WeChat experience build; M25 launch preparation; M26 final migration cutover; M27 review/release.

## 18. Done
A module is Done only with applicable user UI + API + DB + Admin/Store UI + permissions + validation + error handling + logs + tests + docs.

## 19. 待确认 / Decisions needed
AI pricing; animation purchase/subscription model; complete commission rules; rental deposit/fees; delivery regions/providers; franchise approval rules; Meiping export sample; store list; WeChat主体/AppID/merchant/domain ownership; public AI/child moderation rules; budget and target launch date.
