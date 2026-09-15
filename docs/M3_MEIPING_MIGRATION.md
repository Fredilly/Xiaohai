# M3 美萍迁移基础设施 / Meiping Migration Infrastructure

## 当前完成 / Completed now

M3 只建立“图书主数据 + 当前库存”的安全迁移基础设施：migration batch、staging、canonical input、确定性 normalization/validation/dedupe、dry-run、异常保留、幂等约束和 reconciliation 边界。当前不执行生产切换，也不建立商城、订单、支付、租借或正式库存业务。

M3 only establishes safe migration infrastructure for book master data plus current stock: migration batches, staging, canonical input, deterministic normalization/validation/dedupe, dry-run, exception preservation, idempotency constraints, and a reconciliation boundary. It does not perform production cutover or build commerce, orders, payments, rental, or the production inventory domain.

## 为什么没有真实美萍 parser / Why there is no real Meiping parser

目前没有取得真实美萍导出样本，因此不能安全假定 CSV/Excel 格式、列顺序、编码、表头或文件结构。本阶段故意不提供声称支持真实美萍导出的 parser。后续 adapter 必须在拿到真实样本并人工确认后，把源格式转换到 canonical input boundary。

No real Meiping export sample is available, so CSV/Excel format, column order, encoding, headers, and file structure cannot be safely assumed. This milestone intentionally does not ship a parser claiming to support real Meiping exports. A future adapter must be added only after a real sample is obtained and reviewed, converting the source format into the canonical input boundary.

## 已确认的 7 个字段 / Seven confirmed fields

1. 图书编码 / book code
2. 我们自己的编号 / internal code
3. 图书名字 / title
4. 作者 / author
5. 出版社 / publisher
6. 价格 / price
7. 库存 / inventory

“图书编码”和“自有编号”保持独立；图书编码不会被自动定义为 ISBN。

Book code and internal code remain separate concepts. Book code is not automatically treated as ISBN.

## Canonical input contract

`CanonicalMigrationInput` 接受上述七个逻辑字段。测试中的对象仅是 `TEST FIXTURE / CANONICAL SAMPLE — NOT A REAL MEIPING EXPORT`，它描述 canonical boundary，不描述真实美萍文件。

`CanonicalMigrationInput` accepts the seven logical fields above. Objects used in tests are explicitly `TEST FIXTURE / CANONICAL SAMPLE — NOT A REAL MEIPING EXPORT`; they describe the canonical boundary, not a real Meiping file.

## Normalization / Validation

字符串只执行确定性处理：转字符串（仅 string/number）、Unicode NFKC、trim、连续空白折叠。空字符串变为 null。不会猜测作者、出版社、ISBN 或编号映射。

价格使用严格十进制字符串解析为整数分（minor units），最多两位小数，不使用浮点计算；负数、格式错误、超出安全整数范围均报错。库存必须是安全整数，负库存明确报错。title、price、inventory 缺失是 error；作者、出版社缺失以及两个编号都缺失进入 warning/review。

Strings receive deterministic processing only: string conversion for string/number values, Unicode NFKC, trim, and whitespace collapse. Empty strings become null. Author, publisher, ISBN, and identifier mappings are never guessed.

Prices are parsed from strict decimal strings into integer minor units without floating-point arithmetic; negatives, malformed values, and unsafe ranges are errors. Inventory must be a safe integer and negative inventory is an explicit error. Missing title, price, or inventory is an error; missing author/publisher or both identifiers routes the row to warning/review.

## Dedupe / Conflict

完全相同的 normalized record 标记为 duplicate，不覆盖。相同图书编码对应不同 canonical 内容标记 `BOOK_CODE_CONFLICT`；相同自有编号对应不同内容标记 `INTERNAL_CODE_CONFLICT`。冲突不会自动选择“赢家”。

An identical normalized record is marked duplicate and never overwritten. The same book code mapped to different canonical content becomes `BOOK_CODE_CONFLICT`; the same internal code mapped to different content becomes `INTERNAL_CODE_CONFLICT`. Conflicts never choose a winner automatically.

## Dry run

`dryRunCanonicalMigration` 是纯函数，不包含正式业务数据 writer。它输出总行数、valid/warning/error、duplicate/conflict、可导入、人工 review、source inventory total（只有全部源库存都可安全解析时才给出）以及 planned inventory total。相同输入得到相同结果。

`dryRunCanonicalMigration` is pure and contains no production business-data writer. It reports total, valid/warning/error, duplicate/conflict, importable, human-review, source inventory total (only when every source inventory value is safely parseable), and planned inventory total. Identical input produces identical output.

## Batch、异常与安全重跑 / Batch, exceptions, and safe rerun

`migration_batches` 使用 `(source_type, checksum)` 唯一约束阻止同一来源内容被重复创建。`migration_book_staging` 使用 `(batch_id, source_row_number)` 唯一约束保证一条源记录在同一 batch 中只有一个 staging 身份。raw JSON 永久保留用于审计；normalized JSON、validation/import state、issues、fingerprint 和规范化金额/库存分开保存。

Partial failure 后应继续使用原 batch：查询已有 source row，只补缺失行；不得新建同 checksum batch 来绕过幂等约束。正式 import 尚未启用，因此当前不会产生重复正式图书或 double inventory。

`migration_batches` has a unique `(source_type, checksum)` constraint to reject duplicate source content. `migration_book_staging` has a unique `(batch_id, source_row_number)` constraint so each source row has one staging identity per batch. Raw JSON is retained for audit; normalized JSON, validation/import state, issues, fingerprint, and normalized money/inventory are stored separately.

After partial failure, resume the same batch by reading existing source rows and adding only missing rows; never create another batch with the same checksum to bypass idempotency. Production import is not enabled yet, so this milestone cannot create duplicate production books or double inventory.

## Import boundary

当前 schema 尚没有正式 `books → edition → product → SKU → store_inventory → inventory_transactions` 业务链。M3 不提前实现这些 M4+ / M12+ 结构。因此 `IMPORT_PLANNED`/`IMPORTED` 只是 staging 状态边界，当前没有代码把 staging 写入正式业务数据。

拿到真实数据且正式目标模型存在后，import service 必须在数据库事务中执行，并用 batch/staging identity 建立唯一导入审计；初始库存只能通过 `INITIAL_MIGRATION` inventory transaction 建立，禁止直接静默覆盖库存。

The production `books → edition → product → SKU → store_inventory → inventory_transactions` chain does not yet exist. M3 does not prematurely implement those later milestone structures. `IMPORT_PLANNED`/`IMPORTED` therefore define staging boundaries only; no current code writes staging rows into production business data.

Once real data is available and the production target model exists, the import service must run transactionally with unique batch/staging import audit. Initial stock may only be established through `INITIAL_MIGRATION` inventory transactions; direct silent inventory overwrite is forbidden.

## Reconciliation

`reconcileMigration` 比较 source/staging 行数、accepted/rejected/review 分布、planned/imported record 数、source/accepted/imported inventory total，并返回明确 mismatch code。差异保持可见，不做静默修正。

`reconcileMigration` compares source/staging row counts, accepted/rejected/review disposition, planned/imported record counts, and source/accepted/imported inventory totals, returning explicit mismatch codes. Differences remain visible and are never silently corrected.

## 尚未完成 / Not completed

- 真实美萍 CSV/Excel adapter / real Meiping CSV/Excel adapter
- 真实 raw archive 存储位置与保留策略的最终生产配置 / final production raw-archive storage and retention configuration
- 正式 catalog/inventory target mapping 与 import writer / production catalog/inventory target mapping and import writer
- `INITIAL_MIGRATION` inventory transactions / production initial inventory transactions
- 真实门店 reconciliation 与 production cutover / real store reconciliation and production cutover

## 拿到真实导出样本后的下一步 / Next step after receiving a real export sample

人工保存原始文件只读副本并计算 checksum；确认文件类型、编码、列名、列顺序、金额与库存表示；新增独立 source adapter，把真实格式映射到 canonical input；用真实样本补充 adapter tests；先 staging + dry-run，逐条解决 exception；只有正式 catalog/inventory 模型完成后才实现受审计 import；最终 M26 仍需要 freeze old inventory → final export → dry-run → review → import → reconcile → 人工批准，之后新 PostgreSQL 系统才成为 Source of Truth。

Preserve a read-only raw copy and checksum it; confirm file type, encoding, headers, column order, and money/inventory representation; add a dedicated source adapter mapping the real format into canonical input; add adapter tests using reviewed samples; run staging and dry-run first and resolve every exception. Only after the production catalog/inventory model exists should an audited import writer be added. Final M26 still requires freeze old inventory → final export → dry-run → review → import → reconcile → human approval before PostgreSQL becomes the Source of Truth.
