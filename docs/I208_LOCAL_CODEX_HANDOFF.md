# #208 当前工程与本机验收交接

当前分支：`codex/local-release-integration`。保留原 `00d090b` 成果及 `9835db1` 全部历史；不新建分支/PR，不合并 main，不部署，不使用真实库存、支付、BOS 或付费 AI。Fred 负责独立安全审核和 UI 设计。

## 已实现

- #217 多批次账本修复保留；同一总流水可拆多批次，数据库提交校验总和、身份和不可变历史。#217 `e86bdb6` 已有绿色 CI，仍需独立复审。
- 共享商品资料、门店独立售价；选店报价与正式订单同事务重算、锁价并保存快照，客户端确认金额不符拒绝。购物车修改与结算共用消费者锁。旧下单入口拒绝已关联门店 SKU。
- 东门 Excel 预检与既有审核/实盘/独立批准/安全执行链组合；南门普通商品草稿与首次本店库存建档可单独运行，不依赖食品开关。
- 食品仅预包装/瓶装饮料；实际来源分类、批次、日期、冻结/召回/释放、报损/盘亏/专用销毁、真实读取及双后台入口。
- 从 `9835db1` FEFO 基础接入正式订单：下单、订单项、履约门店、批次预留和清空购物车同事务；自提/配送消耗原预留批次，拒绝过期、冻结/召回及不可用祖先。
- 未付取消、未履约确认退款释放原预留；已履约退款不加实物库存。实物接收必须另行确认，按原 SOLD 分配限额，建立新 HELD 批次，保留原到期日与来源；接收凭证和请求键防重。
- 调拨沿用 DRAFT→SUBMITTED→IN_TRANSIT→RECEIVED。两店授权、源批次→目的批次、两侧流水、接收冻结及祖先召回保护；多行失败完整回滚。
- 双后台有原订单批次查询、实物接收和来源查询；门店补本店支付/退款/对账模块。原 GLOBAL 财务接口限制不变，新增显式 storeId 路由要求独立权限+真实数据范围+订单唯一履约门店，错店在 Provider 调用前拒绝。无角色自动赋权。

## 实际测试证据

仓库标准 `0000–0049` migrations，**50** 项 journal/hash 对应检查与 Drizzle check 通过。全 API 真实 PostgreSQL **276 PASS、4 gated skips**；食品及相关资金四套专项 **57 PASS**，无食品用例跳过。四项跳过为队列/限流或 #111 专用环境门禁，不能计作 PASS。

覆盖 FEFO 顺序和重放、完整/伪造分配、无物理流水的假 SALE 拒绝、正式订单并发最后库存、金额变更回滚、召回先持锁阻止履约、自提/配送一次扣减、消费者所有权、退款不返实物、重复/超额实物接收、跨店权限、调拨后续行失败回滚、来源召回、支付错店零 Provider 调用和同退款号并发幂等。

API 单元 **233**、Store Web **59**、HQ Web **86**、Miniapp **167**、Config **8**、Contracts **74** PASS。API/双后台类型、lint/build、Miniapp 结构检查、秘密扫描通过。UI 单元主要为静态渲染，不能代替交互。临时 PostgreSQL 校验自身随机 data_directory/回环端口，独立数据库，运行结束停止自身集群；未使用共享/Mac 数据库。支付 Provider 全为合成对象，无真实资金调用。

`FOOD_STOCK_WRITES_ENABLED=false`、`FOOD_CHECKOUT_ENABLED=false` 保持默认。不能因测试成功自动改环境。500 批次工作集、32 层来源上限及超过即停止的行为须在目标数据预检。

## 本轮隔离业务验收（2026-11-25）

在专用、随机命名的 PostgreSQL 17 disposable 实例中完成迁移后，使用全合成数据运行，实例已在测试完成后停止；未连接既有 I111、开发、Staging 或生产数据库，未使用持久业务卷。

- 东门链路：Meiping 预检/审核会话、实盘确认、独立批准、执行与对账，以及库存初始建档、收货、调拨回滚和并发库存读取：8 个集成套件、38/38 PASS。
- 南门链路：普通商品草稿、本店 SKU/独立售价、首次库存、重复请求幂等、跨店数据范围和错店拒绝：上述 8 个集成套件中的相关场景全部 PASS。
- 食品与履约：FEFO 预留/释放、取消、退款、自提、配送、实物退货、跨店调拨、冻结/召回/溯源：8 个专项集成套件、79/79 PASS。
- 支付：模拟 Provider 下本店退款、对账、跨店权限拒绝和幂等：集成套件通过；未发送真实支付或退款。
- 浏览器：独立合成 API 路由的 `pnpm test:inventory-web` 为 9/9 PASS；GitHub CI `isolated inventory browser acceptance` 为 SUCCESS。

本轮仍 NOT TESTED：真实门店账号、真实库存/实物、真实支付资金、真实 BOS/Provider、微信真机、生产或共享环境迁移，以及食品生产开关开启后的现场验收。以上 PASS 仅代表隔离合成环境和代码路径验证，不代表运营上线或 Issue 完成。

## 本轮门店交互安全补充（2026-11-24）

门店食品页面新增服务端读取结果的 **门店 + SKU、门店 + 订单、门店 + 批次** 双重身份校验；即使响应 JSON 结构合法，错店或错对象也不会被展示。食品写入有明确成功响应时自动清空已提交的表单；后续批次刷新失败会提示“写入已成功响应、读取未确认”，避免原输入被当作一笔待重试的新操作。网络中断而无法确认 POST 成功时仍保留原请求键。

门店端单测 **62 PASS**（新增 3 项响应身份负例），门店端 typecheck、lint、build 通过。之前 API/其他端与 PostgreSQL 数字是前轮证据，不代表本轮重新运行了所有真实数据库用例。

此前受限环境实际尝试 `pnpm test:inventory-web` 两次，因 Chromium 本地 socket `Operation not permitted (1)` 未进入断言。**随后在独立本机 worktree 完成复测：`485be755aa8743b7d38c478a9a497e379cb3099c` 上 9/9 PASS**。修复仅涉及测试定位器（提交 `485be75`），不涉及业务逻辑；API 233、门店 62、总部 86 单元测试及 lint/typecheck/Prettier 通过。该结果只证明合成浏览器交互，不代表真实业务环境 UAT。未 mock API 仍全局中止，Service Worker 仍禁用。不得通过权限绕过或共享服务制造绿色结果。

已增加独立 `inventory-browser` CI 检查：在 GitHub Actions 隔离 runner 安装 Playwright Chromium，执行 `pnpm test:inventory-web`，纳入 merge gate。CI 实际运行状态须以提交后 GitHub 检查结果为准，不能预先记作通过。

## 本机统一执行

网站运行约束：Store Web 与 HQ Admin Web 的 API 默认改为同源 `/api/**`（总部健康检查为 `/health`），本地 Vite 代理转发到隔离 API。若静态站与 API 不同域，构建时须显式提供 `VITE_API_BASE_URL`；同源部署必须由反向代理转发 `/api/**` 和 `/health`。禁止浏览器退回访问用户电脑的 `127.0.0.1:3000`。此项代码修复不等于已完成目标环境部署或网络验收。

1. 核对最新分支 SHA/干净状态、专属合成测试环境及非生产 Provider；**禁止复用 #111 Gate B、原 Mac 数据库、真实商品库或共享资源**。
2. `pnpm test:inventory-web`，共 **9** 项（原 6 项库存/Excel/切店/权限 + 食品入库断网同键重试、实物接收成功后刷新失败仍同键、错店溯源不展示）。独立本机环境已 **9/9 PASS**；CI 自动重跑为新增门禁。未 mock API 全局中止，Service Worker 禁用，不允许漏到 Vite 本机 3000 代理。
3. 在另建的 #208 专属应用/数据库中验证：两店名称/售价一致性、旧入口拒绝、同购物车并发下单；食品有效/到期/冻结、原批次自提/配送、取消/退款与实物接收分离、调拨在途及两端清点、召回传递、断网重试；门店只读/错店/单权限拒绝。
4. 门店支付 UAT：只读员工不能退款；获授权本店经理可以对账/整单退款；猜另一店 paymentId 拒绝；退款不增加实物库存；总部原 GLOBAL 入口不变。只用模拟支付，不发送真实退款。
5. 食品开关保持 false，单独验证东门合成 Excel 预检→审核→人工实盘→独立批准→执行/对账，南门普通商品草稿→首次库存→重复请求/权限/流水；普通商品不用批次。真实 Excel 及实盘另有资源与操作授权后才导入，禁止把每行默认 1 件当实盘。
6. 证据记录 SHA、环境、用例、预期/实际、PASS/FAIL/NOT TESTED、脱敏截图/trace。禁令牌、DSN、签名 URL 和个人数据。浏览器、WeChat 真机、真实照片/数据、共享环境迁移及部署尚未通过，不能宣布 #208 上线或关闭 Issue。

规则与迁移/恢复门禁见 `ADR_FOOD_ORDER_AND_PHYSICAL_FLOW.md`、`FOOD_STOCK_OPERATIONS_RUNBOOK.md`。已同步维护 #114 经营证据矩阵；#114 已关闭并不证明本轮增量已在真实环境验收。#116/#32–#35 的剩余现场条件不可用自动化冒充。

## 2026-11-25 商品图库经营闭环增量

- Store Web 的草稿图库支持读取现有图片、继续上传、调整顺序、指定主图、移除图片引用及明确保存；上传、保存出现网络异常时，关闭编辑器会重新读取门店商品，避免用旧版本继续操作。
- API 为门店及总部共用的 `products` / `product_media` 提供受 Staff RBAC + Store Scope 或 HQ GLOBAL 权限保护的图库读取与版本化调整。写入仅允许 `DRAFT`，只接受已有图片 UUID，严格校验唯一性、公开 HTTPS URL、关联门店、产品版本，使用产品及全部 SKU 行锁、事务和审计日志。移除关联不会删除不可变 BOS 对象；图库管理不会自动发布商品。
- 路由单测及单店/共享店/伪造 ID/版本冲突的隔离 PostgreSQL 集成用例已补齐。新增 2 个 Playwright 合成浏览器用例加入原 `inventory-browser` CI：主图/排序/移除，以及断网不自动重试和错商品回填拒绝（总计 11 项）。
- 本容器的 PostgreSQL 环境变量未配置，专用集成套件按门禁跳过，不记为 PASS。浏览器实测尝试被本环境缺失 Chromium 实际二进制阻断（`/usr/bin/chromium` 也只是缺少目标文件的包装脚本）；等待原分支 CI 的隔离 Chromium 结果，不把新用例记作通过。
- 未访问真实 BOS、修改真实图片或上架商品；食品、支付及其他运营开关保持默认关闭。

## 2026-11-25 门店图书建档与资料维护增量

- 门店工作台的商品草稿入口支持选择图书或非图书商品。图书录入书名、作者、出版社、可选 ISBN，ISBN 空格和连字符规范化、格式及重复值由服务端进一步核验；保持 `DRAFT`、`availableForSale=false`、本店零库存绑定、原有请求键防重复。食品虽属非图书商品，仍须使用独立批次入库流程，不因建档变为可售。
- 已建图书可在门店资料页编辑书名、作者、出版社和 ISBN；只提交变更字段与对应 `bookVersion` / `editionVersion`。共享变更仍须先经签名影响预览，涉及其他门店则拒绝本店直接写入；本店售价及库存操作未改。现有 ISBN 不允许从此入口直接清空。
- 增补 API 授权门禁测试、隔离 PostgreSQL 图书创建测试代码，以及 2 个合成 Playwright 交互场景（图书草稿断网原键重试、跨店影响拦截与带签名令牌版本写入）。浏览器套件现共 13 项；本容器尝试启动时全部在断言前因 Playwright Chromium 实际二进制缺失而失败，**不得计作已通过**，需由 CI 的 `inventory-browser` runner 实测。PostgreSQL 集成用例此处无授权隔离实例，未执行。
- 本轮 Store Web 单测 68/68 PASS，API 单测 237/237 PASS；Store Web 与 API typecheck、lint、Store Web build、全仓 Prettier PASS。这是离线代码证据，不代表真实门店、微信真机、图片存储或生产验收。

## 2026-11-25 正式域名与三端接入配置

- 负责人确认正式门店站 `store.pamboo.asia`、总部站 `admin.pamboo.asia`、API `api.pamboo.asia`。小程序 release 已由无效占位地址切至 `https://api.pamboo.asia`；develop/trial 仍指向 `https://staging-api.pamboo.asia`，保持数据隔离。
- `deploy/` 已备生产网站（仅静态构建及 HTTPS 反代）和独立 API/Worker 的人工部署定义。没有生产数据库/Redis 自动创建、迁移或清理；生产 Web 通过同源 `/api` 转发，API 上游需要显式配置。生产凭据文件在 Git/Docker ignore 清单中，食品写入/交易和微信支付示例保持关闭。
- 这只是源代码/配置接通：尚未修改 DNS、申请真实 TLS、获取可用生产服务器或发布官方 AppID，也未进行微信真机、真实支付、真实库存或运营验收。必须由环境负责人提供生产隔离基础设施和微信后台配置，Fred 独立安全审计及 UI 设计不由本轮替代。
- 新确认的基础设施信息：现有 Staging 与拟上线正式环境使用的是**同一台阿里云 ECS**，`pamboo.asia` 在阿里云购买且 DNS 托管位置待核；企业小程序 AppID 暂报 `wx315898250f72794b`，仍需在微信公众平台核对。当前配置**不可直接在原 ECS 启动第二套 Caddy**，会争用 80/443；两个生产预检已加入默认拒绝门禁 `PRODUCTION_HOST_ISOLATED=true`，该值只允许在确认独立生产主机后提供，绝不可对当前 Staging ECS 虚填。实际部署阻塞及最小 DNS/微信交接见 `deploy/PRODUCTION_WEB_READINESS.md`。不得把此源代码验证当作正式环境或真机验收。
- 负责人随后明确选用**与 Staging 共用现有 ECS**，并告知第四个独立网站 `orientalsourcepress.com` 已购域名、准备上线。已备手动选择的 `production-cohost.compose.yml` 与 `staging-cohost.override.yml`、共用入口 Caddyfile 和独立生产 Postgres/Redis/Worker/Web/数据卷；无第二个公网端口绑定、无生产请求回退 Staging。正常 Staging 部署默认不启用覆盖层；单独的 `cohost.enabled` 及保留其他网站路由文件、生产预检/资源和恢复证据是启动前强制条件。该架构仍需 Fred 安全复审和独立操作授权；当前 2 核/4G/50G 服务器能否承载全部服务尚未现场确认。详见 `deploy/PRODUCTION_COHOST_RUNBOOK.md` 和 `docs/ADR_PRODUCTION_STAGING_COHOST.md`。没有配置或启动第四个网站，也没有触碰服务器。
- 本轮源码验证：共机/独立方案预检、Staging 发布兼容与镜像保留隔离的合成测试通过；小程序 175、Store Web 68、HQ Web 88、API 237 项单测通过，Store/HQ 构建、API/Worker/Miniapp 类型检查及小程序结构检查通过。宿主环境没有 Docker/Caddy 可执行文件，**Compose 真实配置合并、Caddy 语法/路由、云主机容量、真实服务、WeChat 真机均未在 ECS 验证，不得记为 PASS**。生产与 Staging 共用 GHCR API/Worker 镜像仓库，旧 Staging 镜像清理在共机激活时默认硬停止，不能因磁盘紧张绕过。
- 已获得宿主机只读证据：这是阿里云**轻量应用服务器（非标准 ECS）**，2 vCPU、3.4 GiB RAM、无 Swap、49 GiB 文件系统仅剩 15 GiB；53 个 Docker 镜像约 30.66 GB，Staging 5 容器正常，Caddy 独占 80/443。升级报价超出负责人预算，**未批准购买/升级/重启或删除镜像**。为减少部署峰值磁盘和 CPU 占用，共机 Web 改成只拉取固定 SHA 的 GHCR 静态运行镜像，新增手动 GitHub runner 打包工作流（只构建、不部署）。生产实际容量及可恢复备份仍未通过，`COHOST_CAPACITY_EVIDENCE_VERIFIED` 必须保持关闭。详见 `deploy/PRODUCTION_COHOST_RUNBOOK.md`。
