# Issue #128 — Mini Program full UI redesign / Stage A

基于 `main` `9a49ddefcc120c1844653bc6fc1faeeda6438a5c`。本阶段只提交设计文档与静态原型，不修改 `apps/miniapp` 运行代码，不扩大 PR #126。

## 1. 交付物

- 可交互静态原型：[issue-128-stage-a.html](../prototypes/issue-128-stage-a.html)
- 本文：页面盘点、三套方向、设计系统、状态/实施分期与审批门槛。

原型支持切换三套方向、首页/胖竹全球/我的、窄屏/宽屏，以及当前结构的 BEFORE 对照与 AFTER 方案稿。原型中的商品、门店、账户和统计均为“示意数据 / 非真实业务数据”，不代表 CMS、BOS 或 API 返回值。

## 2. 31 个注册页面盘点

| 路由 | 目的 | 当前结构 | 改版优先级 | 依赖与阻塞 |
|---|---|---|---|---|
| `index` | 首页入口、CMS 内容、商城/童话/AI | 品牌行、搜索、Hero、功能卡、CMS 列表 | P0 | CMS Hero/图片；#70/#76 真机与公网环境 |
| `global` | 门店地图、搜索、区域、服务 | 介绍、服务网格、筛选、地图、门店列表 | P0 | 门店/区域 API、地图；#76/#113 |
| `me` | 登录、订单、个人服务 | 资料 Hero、订单中心、服务网格 | P0 | 微信会话、订单/服务状态；登录端到端仍需环境 |
| `feature` | 未开放功能提示 | 单一占位状态页 | P1 | 无真实数据时保持诚实空态 |
| `shop` | 商品列表、搜索、购物车入口 | 工具栏、商品列表、封面/价格 | P1 | Catalog/CMS 图片；不创建测试商品 |
| `product` | 商品详情、购买入口 | 封面、书籍信息、价格、库存/履约 | P1 | Catalog、库存、价格；支付不在 Stage A |
| `cart` | 购物车 | 商品行、数量、结算 | P1 | 订单/库存；不改变业务语义 |
| `address` | 地址管理 | 地址列表/空态 | P2 | 消费者会话；不新增/删除地址 |
| `checkout` | 结算确认 | 地址、商品、金额、配送/自提 | P2 | 订单/支付；只做视觉方案 |
| `orders` | 订单列表 | 状态筛选与订单行 | P1 | 订单状态接口；需明确状态筛选契约 |
| `order-detail` | 订单详情 | 状态、商品、履约、操作 | P2 | 订单/支付/履约 |
| `stories` | 公开童话列表 | 搜索、内容卡片、空/错误态 | P1 | CMS 已发布内容；#113 |
| `story-detail` | 故事详情/选集 | 封面、简介、章节 | P1 | CMS 内容与媒体 |
| `playback` | 播放/进度 | 播放器、章节、继续观看 | P2 | CDN、权益、进度 |
| `story-create` | AI 故事创作 | 表单、生成进度、结果 | P1 | AI Job、费用与内容审核；默认 Mock |
| `story-works` | 我的故事作品 | 作品列表、状态 | P2 | 会话、作品归属 |
| `story-work` | 故事作品详情 | 内容、编辑/续写操作 | P2 | AI/作品权限 |
| `picture-books` | 绘本作品/目录 | 作品卡、封面、状态 | P1 | 真实作品/插画；图片错误隔离 |
| `picture-book-create` | 绘本创作 | 角色、分页、插画进度 | P1 | AI/media Worker、BOS；费用保护 |
| `picture-book-detail` | 绘本详情/预览 | 分页插画、错误/恢复 | P1 | #110 未提交修改；需保留视觉一致性 |
| `animations` | 动画列表 | 作品状态卡 | P1 | AI/media Job、BOS |
| `animation-create` | 动画创作 | 分镜/参数/进度 | P1 | AI Job、费用与审核 |
| `animation-detail` | 动画详情 | 播放、状态、重试 | P2 | 媒体/CDN、作品权限 |
| `store-detail` | 门店详情 | 地址、营业时间、服务、导航 | P1 | 门店真实数据；#76 |
| `book-search` | 门店库存找书 | 搜索、库存门店 | P1 | Catalog/Inventory；不能用假库存 |
| `rentals` | 租借列表 | 空态/租借记录 | P2 | Consumer Session；#76 已有只读鉴权证据 |
| `rental-detail` | 租借详情 | 取书、归还、逾期状态 | P2 | Rental/门店服务 |
| `franchise-apply` | 加盟介绍/申请 | 说明、表单、状态 | P2 | Franchise API、隐私 |
| `commission` | 佣金与提现 | 余额、记录、申请 | P1 | 财务鉴权/幂等；#113 401 运行时仍 BLOCKED |
| `referral` | 分享/归因 | 分享链接、说明、状态 | P2 | Referral/Commission；不展示虚拟财务数据 |

## 3. 三套视觉方向

### A — 雾蓝绘本 / Misty Reading（推荐）

温暖纸张底、雾蓝主色、淡紫强调；以“翻开一本书”的留白和编辑型排版组织内容。首页强调真实 CMS Hero 与三条核心入口；胖竹全球单独使用自然绿，地图先于服务入口；我的页面用柔和资料区承接订单与服务。

- 优点：最贴合“小海童话 + 高品质独立书店 + 家长友好”；长文可读性好，品牌区分清晰。
- 风险：需要严格控制插画装饰，避免变成泛儿童模板。
- 原型状态：已在静态稿中实现三主页面窄/宽屏。

### B — 胖竹自然 / Pangzhu Field Notes

小海保持奶白/雾蓝，胖竹扩展为苔绿、纸白、墨色的“门店地图手册”；地图和真实门店列表成为全球页主视觉。卡片更少，使用横向信息带和门店标签。

- 优点：业务识别强，适合搜索、区域、门店详情和加盟入口。
- 风险：首页与我的仍需额外约束，避免全产品变成绿色门店系统。
- 适用：若近期业务重点是门店网络与线下联动。

### C — 纸上剧场 / Paper Theatre

以深墨蓝为舞台底，奶油纸张为内容面，珊瑚/淡紫作为故事和 AI 状态色；使用章节、胶片、书页切片表达故事与创作进度。

- 优点：差异最大，故事、动画、AI 创作的叙事感和状态感强。
- 风险：对电商结算、长表单和家长阅读负担较高；需要更多插画资产与无障碍对比度验证。
- 适用：内容/AI 成为主增长入口后再考虑。

推荐 A；B 作为胖竹全球的局部品牌模式；C 暂不作为首轮实现方向。

## 4. Design system v1（方向 A）

### 色彩

| 用途 | Token | 值 | 规则 |
|---|---|---|---|
| Xiaohai 背景 | `xiaohai-paper` | `#F7F3EC` | 页面底，不承载小字号正文 |
| Xiaohai 主墨色 | `xiaohai-ink` | `#26394A` | 标题/核心文字 |
| 雾蓝 | `xiaohai-mist` | `#DCE8F0` | Hero/浅状态 |
| 淡紫 | `xiaohai-lilac` | `#E8E0F1` | AI/故事强调 |
| 胖竹绿 | `pangzhu-leaf` | `#5F806A` | 主按钮/门店标签 |
| 胖竹浅绿 | `pangzhu-sage` | `#E4EFE6` | 地图/门店面板 |
| 成功 | `semantic-success` | `#38735A` | 成功/可用 |
| 警告 | `semantic-warning` | `#9A6D3B` | 待处理，不表示失败 |
| 错误 | `semantic-error` | `#A95858` | 错误/重试 |
| 不可用 | `semantic-muted` | `#7A858E` | 空态/未开放 |

### 排版与尺寸

- 页面标题 40–44rpx、区块标题 30–32rpx、卡片标题 26–28rpx、正文 23–25rpx、辅助文字 19–22rpx。
- 行高正文 1.55–1.7；中文长标题最多两行，不能用 `nowrap` 隐藏关键信息。
- 8rpx 基础间距，常用 16/24/32rpx；圆角 16/24/32rpx，避免每层都套卡片。
- 触达区域至少 88×88rpx；图标仅作辅助，入口必须有文字语义。
- 适配 320–430px 窄屏和 430–600px 宽屏；底部内容预留 `env(safe-area-inset-bottom)`。

### 图片、图标与状态

- 图片优先级：API/CMS/BOS 真实媒体 > 明确匹配的本地资产 > 结构化空封面；不得用 Logo、无关图片替换故事/商品图。
- Hero 16:9 或 4:3；书封 112×150rpx；门店图/地图占据主要视觉面；所有远程图固定尺寸并有错误回退。
- 图标使用线性、单色、24–32rpx；不混用 Emoji 和随机图标包。
- 每个列表均定义 `loading → ready → empty/error → retry`；错误状态不显示 0、余额或虚构条目。
- 付费/锁定/AI 处理中状态必须有明确语义和费用边界，不能用“成功”色伪装处理中。

## 5. 三主页面结构

### Home

品牌识别 → 搜索/商城入口 → CMS Hero → 三个核心入口（商城、童话、AI）→ 真实内容列表 → 空/错误重试。减少重复卡片，Hero 和核心入口承担主要视觉重量。

### Pangzhu Global

品牌介绍 → 门店搜索/区域筛选 → 地图与数量 → 门店卡片 → 找书/租借/自提/加盟辅助入口。错误时地图、数量和列表同步为“暂不可用/数量未知”，空结果才显示 0 和“没有找到门店”。

### Me

头像/登录状态 → 订单中心 → 我的服务 → 未开放服务提示。删除未接入真实接口的收藏/优惠券/积分假统计；登录前不展示财务、订单或作品数据。

## 6. 其他页面分期

1. **Stage B / 三 Tab 落地**：Home、Global、Me；只改 WXML/WXSS/必要展示适配，保留路由、API、状态机；独立 PR，窄/宽屏 + loading/empty/error/retry 验收。
2. **Stage C / Commerce**：Shop、Product、Cart、Checkout、Orders、Order Detail、Address；先定义真实数据卡片和订单状态筛选视觉，支付/库存语义由现有 API 保持不变。
3. **Stage D / Content**：Stories、Story Detail、Playback、Picture Books、Picture Book Detail、Animations、Animation Detail；统一封面、章节、媒体错误和继续播放状态，依赖 #70/#113 证据。
4. **Stage E / AI**：Story Create/Works、Picture Book Create/Detail、Animation Create/Detail；统一 Job 状态、成本提示、失败/重试、审核和媒体占位，不开启真实付费 AI。
5. **Stage F / Other**：Store Detail、Book Search、Rentals、Franchise、Commission、Referral、Feature；按数据风险和权限逐页实施。
6. **Stage G / Acceptance**：可访问语义、中文长文本、320/375/430/600px、真机、网络错误、真实 CMS/BOS 和回滚检查。

每阶段一条聚焦 PR；旧 UI 可通过分支回退，数据/API 不变，视觉验收以截图前后对照和状态矩阵为准。

## 7. Stage A 决策请求

请 Fred 与产品方只批准一个方向（推荐 A），并确认三主页面稿。批准后再创建 Stage B 实施 Issue/PR；本分支不进入正式小程序 UI 编码。

## 8. 证据边界

本阶段的 AFTER 是静态方案稿，不是 DevTools 实际截图；BEFORE 面板是基于当前 WXML/WXSS 结构的示意对照，不宣称真实设备渲染。已有旧 DevTools 截图属于历史验收证据，不能证明当前 main 或未来方案稿的真实渲染。真实屏幕验收保留为 Stage B 之后的 NOT TESTED 项。
