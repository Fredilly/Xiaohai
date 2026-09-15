CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  merchant_id text NOT NULL, app_id text NOT NULL, out_trade_no text NOT NULL,
  amount_minor integer NOT NULL, currency text NOT NULL DEFAULT 'CNY',
  status text NOT NULL DEFAULT 'PENDING', provider_transaction_id text,
  review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_check CHECK (amount_minor > 0 AND currency = 'CNY'),
  CONSTRAINT payments_status_check CHECK (status IN ('PENDING','SUCCEEDED','CLOSED'))
);
CREATE UNIQUE INDEX payments_order_unique ON payments(order_id);
CREATE UNIQUE INDEX payments_out_trade_unique ON payments(out_trade_no);
CREATE UNIQUE INDEX payments_provider_transaction_unique ON payments(provider_transaction_id);
--> statement-breakpoint
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
  out_refund_no text NOT NULL, provider_refund_id text, amount_minor integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING', requested_by uuid NOT NULL REFERENCES staff_accounts(id),
  original_order_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_amount_check CHECK (amount_minor > 0),
  CONSTRAINT refunds_status_check CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','CLOSED','ABNORMAL')),
  CONSTRAINT refunds_original_status_check CHECK (original_order_status IN ('PAID','CANCELLED'))
);
CREATE UNIQUE INDEX refunds_payment_unique ON refunds(payment_id);
CREATE UNIQUE INDEX refunds_out_refund_unique ON refunds(out_refund_no);
CREATE UNIQUE INDEX refunds_provider_unique ON refunds(provider_refund_id);
--> statement-breakpoint
CREATE TABLE payment_callbacks (
  id text PRIMARY KEY, body_hash text NOT NULL, event_type text NOT NULL,
  payment_id uuid NOT NULL REFERENCES payments(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
  event_key text NOT NULL, kind text NOT NULL, amount_minor integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_ledger_kind_check CHECK (kind IN ('PAYMENT','REFUND')),
  CONSTRAINT payment_ledger_amount_check CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX payment_ledger_event_unique ON payment_ledger(event_key);
--> statement-breakpoint
CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by uuid NOT NULL REFERENCES staff_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES reconciliation_runs(id),
  payment_id uuid NOT NULL REFERENCES payments(id), outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_outcome_check CHECK (outcome IN ('MATCHED','PENDING','REVIEW_REQUIRED','FAILED'))
);
