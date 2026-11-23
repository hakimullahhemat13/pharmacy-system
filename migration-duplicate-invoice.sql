-- One invoice number, one purchase per supplier (2026-11-23).
-- Run BEFORE restarting the backend:
--   cd ~\pharmacy-system
--   mysql -u root -p pharmacy_db -e "SOURCE migration-duplicate-invoice.sql"
-- The database itself now refuses a second purchase with the same
-- (branch, supplier, invoice_no), so two people saving at the same
-- moment can no longer record one delivery twice. The old
-- check-then-insert guard could be beaten by a race; the unique index
-- cannot. Purchases with no invoice number (NULL) are not affected —
-- MySQL treats NULL as distinct, so any number of them may exist.
-- If this file fails with "Duplicate entry", the database already has
-- a duplicate. Find it first:
--   SELECT branch_id, supplier_id, invoice_no, COUNT(*) AS n
--   FROM purchases WHERE is_deleted = 0 AND invoice_no IS NOT NULL
--   GROUP BY branch_id, supplier_id, invoice_no HAVING n > 1;
-- Fix or delete the extra row, then run this file again.
-- If you run it twice, MySQL stops with "Duplicate key name" — that
-- only means the index is already there.
USE pharmacy_db;

ALTER TABLE purchases
  ADD UNIQUE INDEX uq_purchase_invoice (branch_id, supplier_id, invoice_no);
