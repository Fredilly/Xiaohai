INSERT INTO "permissions" ("key","display_name","description") VALUES
('finance.read','Read finance','View M21 finance summaries, ledger entries, and reconciliation results'),
('finance.reconcile','Reconcile finance','Create M21 internal finance reconciliation runs'),
('finance.export','Export finance','Create controlled M21 finance exports')
ON CONFLICT ("key") DO UPDATE SET
"display_name" = EXCLUDED."display_name",
"description" = EXCLUDED."description";
