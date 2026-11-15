USE pharmacy_db;

-- One row per closed day, per branch. Closing freezes the day's report:
-- while a row exists, no sale, return, payment, void, purchase, purchase
-- edit/delete, write-off or supplier payment may touch that date.
-- Reopening deletes the row; the audit log keeps the history.
CREATE TABLE IF NOT EXISTS day_closes (
  id            CHAR(36)      NOT NULL,
  branch_id     CHAR(36)      NOT NULL,
  close_date    DATE          NOT NULL,
  closed_by     CHAR(36)      NULL,
  closed_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
  counted_cash  DECIMAL(12,2) NOT NULL DEFAULT 0,
  difference    DECIMAL(12,2) NOT NULL DEFAULT 0,
  note          VARCHAR(255)  NULL,
  stock_check   JSON          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_day_closes_branch_date (branch_id, close_date),
  KEY idx_day_closes_date (close_date),
  CONSTRAINT fk_day_closes_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_day_closes_user FOREIGN KEY (closed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
