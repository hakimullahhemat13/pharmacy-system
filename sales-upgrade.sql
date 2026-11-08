-- Sales upgrade (2026-11-08): credit (por) sales, bill voiding.
-- Run ONCE against pharmacy_db. Safe to inspect; running twice will
-- only raise "duplicate column / table exists" errors, nothing breaks.
USE pharmacy_db;

ALTER TABLE sales ADD COLUMN paid_amount DECIMAL(12,2) NULL AFTER net_total;
ALTER TABLE sales ADD COLUMN voided_at DATETIME NULL AFTER paid_amount;

CREATE TABLE sale_payments (
  id          CHAR(36)      NOT NULL,
  branch_id   CHAR(36)      NOT NULL,
  sale_id     CHAR(36)      NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  created_by  CHAR(36)      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_sale_payments_sale (sale_id),
  CONSTRAINT fk_sale_payments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_sale_payments_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_sale_payments_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_sale_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
