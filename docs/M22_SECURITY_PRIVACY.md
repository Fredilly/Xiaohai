# M22 安全与隐私 / M22 Security & Privacy

## 范围与依据 / Scope and basis

本阶段依照 Issue #30 和 `DEVELOPMENT_TASKS.md` 加固已有系统，不改变 M1–M21 财务、库存与授权语义。安全评审必须在合并前独立完成。
This milestone follows Issue #30 and `DEVELOPMENT_TASKS.md`, hardening the existing system without changing M1–M21 finance, inventory or authorization semantics. Independent security review is required before merging.

## 信任边界与威胁 / Trust boundaries and threats

小程序消费者、门店端员工、总部后台员工使用不同会话；服务端核验身份、权限、数据范围及资源归属。API 与 PostgreSQL 之间是业务事实边界；Redis 只承载限流与异步唤醒。支付回调必须验签，AI/微信/地图/配送服务响应均是外部输入。媒体元数据与真实对象存储也是不同的边界。
Mini Program consumers, Store staff and HQ staff use distinct sessions; the server verifies identity, permissions, data scope and ownership. The API–PostgreSQL boundary defines business truth; Redis only handles rate limiting and asynchronous wake-ups. Payment callbacks require signature verification, and AI, WeChat, map and delivery providers are external inputs. Media metadata and actual object storage are separate boundaries.

主要滥用途径包括暴力登录、伪造身份或范围、猜测资源 ID、重复财务操作、伪造媒体元数据、恶意内容、包含凭据的日志和过度导出个人信息。客户端提交的门店、区域、价格和角色不可作为授权事实。
Primary abuse paths include brute-force login, forged identity or scope, guessed resource IDs, repeated financial actions, spoofed media metadata, unsafe content, credential-bearing logs and excessive PII exports. Client-submitted store, region, price and role fields are not authorization facts.

## 安全控制 / Security controls

API 在受保护写请求到达路由前使用 Redis 原子递增并设置过期时间。微信和员工登录每分钟每来源 10 次，公开加盟提交每小时 5 次，AI 写入每分钟 30 次，密码重置每小时 5 次。以未经代理信任转换的 socket 地址计算哈希键，不接受 `X-Forwarded-For`；超限 429，Redis 故障时受保护写入 503。限额是暂定的技术保护值，正式额度仍待运营确定。
The API uses atomic Redis increments with expiry before protected write routes. WeChat and Staff login allow 10 attempts per minute per source, public franchise submissions 5 per hour, AI writes 30 per minute and password resets 5 per hour. Keys hash the socket address without trusting `X-Forwarded-For`; exceeded limits return 429 and Redis failure returns 503 for protected writes. These thresholds are provisional technical safeguards; production quotas await operations decisions.

Pino 以白名单序列化请求 ID 与方法，不记录请求 URL、header、body 或 query；密码、会话、微信身份、密钥和异常对象使用集中脱敏。公共未处理错误返回统一代码和 request ID，不返回原始异常。密钥扫描拒绝本地环境文件、私钥、证书及常见服务 token；示例值允许保留。
Pino serializes only request ID and method, omitting URL, headers, body and query; passwords, sessions, WeChat identifiers, keys and exception objects receive centralized redaction. Unhandled public errors return a stable code and request ID, not raw exceptions. Secret scanning rejects local environment files, private keys, certificates and common service tokens while allowing example values.

当前没有二进制上传端点；员工媒体端点只登记元数据。该登记入口现在校验被动媒体 MIME、1 GiB 上限、安全 object key 和无凭据、无查询串的 HTTPS 播放 URL。真实对象存储尚需服务端生成 key、字节级内容校验、扫描与授权访问，不能把元数据校验视作上传安全完成。
There is no binary upload endpoint today; the Staff media route only registers metadata. That route now checks passive media MIME, a 1 GiB ceiling, safe object keys and HTTPS playback URLs without credentials or query strings. Real object storage still needs server-generated keys, byte-level validation, scanning and authorized access; metadata checks do not constitute complete upload security.

Worker 的基线审核没有正式策略：开发环境结果仍为 `REVIEW_REQUIRED`，staging/production 对未配置策略的文本和场景输入返回 `BLOCKED`，阻止继续生成。发布内容的审核流程与图片、合成视频内容审核尚需专门审核供应商与产品政策，不应声称已完成全面审核。
Worker baseline moderation has no approved policy: development still returns `REVIEW_REQUIRED`, while staging and production return `BLOCKED` for unconfigured text and scene inputs and stop generation. Published content and image/composed-video moderation still require a dedicated moderation provider and product policy; comprehensive moderation is not claimed.

## 个人数据与儿童安全 / PII and child safety

微信 openid/session key、地址与电话、员工账号、加盟申请、支付标识和 AI 提示词属于不同敏感等级。认证凭据不得返回或写日志；财务导出及总部详情必须以服务端权限和用途为界；审计事件保存 actor、action、resource 与 request ID，避免完整业务负载。已有 API 的详细个人信息仅在有明确业务用途与对应权限时可访问。
WeChat openid/session keys, addresses and phones, Staff accounts, franchise applications, payment identifiers and AI prompts have different sensitivity levels. Credentials must not be returned or logged; finance exports and HQ details must be limited by server permissions and purpose. Audit events should retain actor, action, resource and request ID rather than full business payloads. Detailed PII in existing APIs is accessible only for defined business purposes and permissions.

儿童个人信息的年龄门槛、监护人同意、可见范围、删除和导出时限尚无获批政策。上线前必须由产品与法务批准，不能把本阶段技术控制解读为法律合规结论。
Age thresholds, guardian consent, visibility, deletion and export deadlines for child data have no approved policy yet. Product and legal approval is needed before launch; the technical controls here are not a legal compliance determination.

## 审计与测试 / Audit and testing

员工创建、禁用、重置密码、角色及数据范围变更使用同事务 `audit_logs`；财务对账及导出同样留痕。支付、退款、佣金、库存和加盟的审计边界应结合各自的不可变事件及操作记录复核，不用数量化日志替代语义审计。
Staff creation, disabling, password resets and role/data-scope changes write transactional `audit_logs`; finance reconciliation and exports are also recorded. Payment, refunds, commissions, inventory and franchise audit boundaries need review alongside their immutable events and operation records; log volume is not evidence of meaningful audit coverage.

验证命令：`pnpm check`、`pnpm --filter @xiaohai/db db:check`、`pnpm test:integration`、`pnpm test:e2e`、`git diff --check`。Redis 限流、多身份越权、禁用员工、权限撤销及财务/库存范围必须以真实 PostgreSQL/Redis 集成测试和人工 review 验收。
Verification commands: `pnpm check`, `pnpm --filter @xiaohai/db db:check`, `pnpm test:integration`, `pnpm test:e2e`, and `git diff --check`. Redis rate limits, cross-identity access, disabled Staff, permission revocation and finance/inventory scope require real PostgreSQL/Redis integration tests and human review.

## 待确认决策与剩余风险 / Decisions Needed and remaining risks

待定：儿童年龄与监护同意、数据保留/删除/导出期限、正式审核分类与供应商、生产对象存储/CDN/恶意文件扫描、边缘限流与配额、事件响应联系人及 SLA。当前媒体登记仍引用外部对象 key；生产存储集成前不能开放原始二进制上传。地理位置与来源 IP 共享出口会影响按来源限流的公平性。
Pending: child age and guardian consent, data retention/deletion/export periods, moderation categories and provider, production object storage/CDN/malware scanning, edge rate limits and quotas, and incident contacts/SLA. Media registration still references an external object key; raw binary upload must remain unavailable pending production storage integration. Shared IPs and geographic routing may affect fairness of source-based rate limits.
