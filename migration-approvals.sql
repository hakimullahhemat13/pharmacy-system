-- Branch approvals (2026-11-16).
-- Run BEFORE restarting the backend:
--   cd ~\pharmacy-system
--   mysql -u root -p pharmacy_db -e "SOURCE migration-approvals.sql"
-- If you run it twice, MySQL stops at the first ALTER with
-- "Duplicate column name" — that only means the columns are already
-- there. In batch mode MySQL does NOT continue past an error, so after
-- a 1060, check what is present before assuming the whole file ran:
--   SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_SCHEMA = 'pharmacy_db'
--     AND TABLE_NAME IN ('medicines','purchases','branch_day_reviews')
--     AND COLUMN_NAME IN ('approval_status','rejection_note','review_date');
-- All five rows means everything is in place.
USE pharmacy_db;

-- Medicines and purchases entered in a child (non-main) branch wait for
-- the Main Branch admin's approval before they count: a pending medicine
-- cannot be sold, and a pending purchase adds no stock. Everything
-- recorded before this migration is approved, so current data is
-- untouched. A rejection carries the boss's note, so the branch knows
-- what to correct before sending the entry back.
ALTER TABLE medicines
  ADD COLUMN approval_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved',
  ADD COLUMN rejection_note VARCHAR(255) NULL;
ALTER TABLE purchases
  ADD COLUMN approval_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved',
  ADD COLUMN rejection_note VARCHAR(255) NULL;

-- One row per reviewed day, per branch. NO row means the day is still
-- waiting for the boss's review; accepting or rejecting writes a row,
-- and new activity on the day (or a resubmit from the branch) deletes
-- it again so the day returns to "pending". The audit log keeps the
-- full history, so deleting a row never erases the record.
CREATE TABLE IF NOT EXISTS branch_day_reviews (
  id          CHAR(36)     NOT NULL,
  branch_id   CHAR(36)     NOT NULL,
  review_date DATE         NOT NULL,
  status      ENUM('accepted','rejected') NOT NULL,
  note        VARCHAR(255) NULL,
  reviewed_by CHAR(36)     NULL,
  reviewed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_day_reviews_branch_date (branch_id, review_date),
  KEY idx_day_reviews_date (review_date),
  CONSTRAINT fk_day_reviews_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_day_reviews_user FOREIGN KEY (reviewed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
