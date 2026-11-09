-- Purchases pack upgrade: returns to supplier. Each row is some units of
-- one purchase item sent back; the money value is quantity * unit_price
-- (the price snapshot from the purchase item). The stock ledger already
-- has a 'purchase_return' type — no other change is needed.
-- Run ONCE on pharmacy_db. If the CREATE says the table already exists,
-- it has already been applied — harmless, carry on.
CREATE TABLE purchase_returns (
  id               CHAR(36)      NOT NULL,
  branch_id        CHAR(36)      NOT NULL,
  purchase_id      CHAR(36)      NOT NULL,
  purchase_item_id CHAR(36)      NOT NULL,
  batch_id         CHAR(36)      NOT NULL,
  quantity         INT           NOT NULL,
  unit_price       DECIMAL(12,2) NOT NULL,
  created_by       CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status      VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted       TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_preturns_purchase (purchase_id),
  KEY idx_preturns_item (purchase_item_id),
  CONSTRAINT fk_preturns_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_preturns_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id),
  CONSTRAINT fk_preturns_item FOREIGN KEY (purchase_item_id) REFERENCES purchase_items (id),
  CONSTRAINT fk_preturns_batch FOREIGN KEY (batch_id) REFERENCES medicine_batches (id),
  CONSTRAINT fk_preturns_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_preturns_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
