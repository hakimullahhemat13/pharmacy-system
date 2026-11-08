-- Suppliers module upgrade: later payments toward what the pharmacy owes
-- a supplier (the amount paid at purchase time lives on
-- purchases.paid_amount; this table is the rest of the story).
-- Run ONCE on pharmacy_db. If the CREATE says the table already exists,
-- it has already been applied — harmless, carry on.
CREATE TABLE supplier_payments (
  id          CHAR(36)       NOT NULL,
  branch_id   CHAR(36)       NOT NULL,
  supplier_id CHAR(36)       NOT NULL,
  amount      DECIMAL(12,2)  NOT NULL,
  created_by  CHAR(36)       NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)    NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_supplier_payments_supplier (supplier_id),
  CONSTRAINT fk_supplier_payments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_supplier_payments_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_supplier_payments_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_supplier_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
