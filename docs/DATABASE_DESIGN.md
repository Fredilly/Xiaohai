# DATABASE_DESIGN.md — 小海童话 2.0 / Xiaohai 2.0

## 1. 技术决定 / Technical decision
**PostgreSQL** is the production system of record. Use **Drizzle migrations**. SQLite may be used only for isolated local tooling/tests, never as the production commerce/inventory/payment database.

金额使用 integer minor units or `numeric`, never float. Core finance/inventory records are append-only or audited.

## 2. Identity / 用户
- `consumer_users`
- `wechat_identities` unique `(app_id, openid)`
- `user_addresses`

## 3. Staff / RBAC
- `staff_accounts`
- `roles`, `permissions`
- `staff_roles`, `role_permissions`
- `staff_data_scopes`
- `staff_login_logs`

Consumer and Staff identities remain logically separate.

## 4. Pangzhu organization / 组织
- `regions`
- `franchisees`
- `stores`
- `store_staff`

Store data includes country/region/city/timezone/location and operational status.

## 5. Catalog / 图书与商品
- `books`
- `book_editions` (ISBN/barcode/publisher/language/etc.)
- `categories`, `book_categories`
- `products`
- `skus`
- `product_media`

Keep book metadata separate from sellable SKU so future non-book products/services fit cleanly.

## 6. Inventory / 库存
- `store_inventory(store_id, sku_id, on_hand, reserved, rental_reserved, version)` unique `(store_id, sku_id)`
- `inventory_transactions`
- `inventory_reservations`

Available stock is derived by rule. Every change has a transaction. Concurrency uses PostgreSQL transactions and guarded updates/locking.

## 7. Meiping migration / 美萍迁移
- `migration_batches`
- `migration_book_staging`
- `migration_inventory_staging`

Import flow maps book → edition → product → SKU → store inventory and emits `INITIAL_MIGRATION`. Keep checksums, raw references, reports and rerun safety.

## 8. Procurement / 进销存
- `suppliers`
- `purchase_orders`, `purchase_order_items`
- `goods_receipts`, `goods_receipt_items`
- `stocktakes`, `stocktake_items`
- `stock_transfers`, `stock_transfer_items`

## 9. Commerce / 订单
- `carts`, `cart_items`
- `orders`
- `order_items`

Orders keep price/product/address snapshots needed for historical accuracy.

## 10. Payment / Refund
- `payments`
- `payment_callbacks`
- `refunds`
- `reconciliation_runs`, `reconciliation_items`

Provider transaction IDs are unique where applicable. Callbacks are idempotent.

## 11. Content / Media / AI
- `media_assets`
- `animation_series`, `animation_episodes`
- `content_entitlements`, `playback_progress`
- `ai_projects`, `ai_jobs`, `ai_job_attempts`
- `works`, `work_versions`, `work_pages/scenes`
- `character_profiles`

Large files live in object storage; DB stores metadata and references.

## 12. Rental / Delivery / Franchise
- `rental_orders`, `rental_items`, `rental_events`
- `deliveries`, `delivery_events`
- `franchise_applications`, `franchise_followups`

## 13. Referral / Commission
- `referral_links`
- `referral_attributions`
- `commission_rules`
- `commission_events`
- `commission_ledger`
- `withdrawal_requests`

Commission rate is configurable; no direct balance mutation without ledger entry.

## 14. Finance / CMS / Audit
- `finance_ledger_entries`
- `banners`, `content_pages`, `home_sections`, `announcements`
- `moderation_records`
- `audit_logs`
- `notifications`, `notification_deliveries`

## 15. State machines / 状态机
Orders, payments, refunds, inventory reservations, rentals, AI jobs and withdrawals use explicit allowed transitions. No arbitrary status jumps.

## 16. Indexing / 索引
Unique business numbers, ISBN/barcodes, store+SKU, order status+time, provider transaction IDs, AI job status+time, rental due date, commission beneficiary+status, audit resource+time. Final indexes are validated against real query plans.
