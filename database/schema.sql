-- ============================================================
-- Pharmacy Management System — Database Schema v1
-- MySQL 8.0 / InnoDB / utf8mb4 (Pashto, Dari, English)
-- Run AFTER creating and selecting the database:
--   CREATE DATABASE pharmacy_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   USE pharmacy_db;
-- ============================================================

USE pharmacy_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- Branches (now: one, later: many — structure is ready)
-- ------------------------------------------------------------
CREATE TABLE branches (
  id          CHAR(36)     NOT NULL,
  name        VARCHAR(150) NOT NULL,
  address     VARCHAR(255) NULL,
  phone       VARCHAR(30)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Users (Admin / Pharmacist / Cashier)
-- password is stored ONLY as a hash (Argon2/bcrypt), never plain
-- ------------------------------------------------------------
CREATE TABLE users (
  id            CHAR(36)     NOT NULL,
  branch_id     CHAR(36)     NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  username      VARCHAR(60)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','pharmacist','cashier') NOT NULL DEFAULT 'cashier',
  language      VARCHAR(5)   NOT NULL DEFAULT 'ps',
  token_version INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status   VARCHAR(20)  NOT NULL DEFAULT 'pending',
  is_deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_branch (branch_id),
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Medicines — barcode is unique per branch
-- ------------------------------------------------------------
CREATE TABLE medicines (
  id          CHAR(36)      NOT NULL,
  branch_id   CHAR(36)      NOT NULL,
  name        VARCHAR(200)  NOT NULL,
  generic_name VARCHAR(200) NULL,
  company     VARCHAR(150)  NULL,
  barcode     VARCHAR(50)   NULL,
  unit        VARCHAR(30)   NOT NULL DEFAULT 'tablet',
  category    VARCHAR(100)  NULL,
  sale_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_stock   INT           NOT NULL DEFAULT 10,
  warn_months INT           NOT NULL DEFAULT 3,
  approval_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved',
  rejection_note VARCHAR(255) NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_medicines_branch_barcode (branch_id, barcode),
  KEY idx_medicines_name (name),
  KEY idx_medicines_branch (branch_id),
  CONSTRAINT fk_medicines_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Medicine batches — stock and expiry live HERE, per batch
-- quantity_on_hand is a cache; stock_transactions (ledger) is the truth
-- ------------------------------------------------------------
CREATE TABLE medicine_batches (
  id               CHAR(36)      NOT NULL,
  branch_id        CHAR(36)      NOT NULL,
  medicine_id      CHAR(36)      NOT NULL,
  batch_no         VARCHAR(60)   NOT NULL,
  expiry_date      DATE          NOT NULL,
  purchase_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity_on_hand INT           NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status      VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted       TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_batches_medicine (medicine_id),
  KEY idx_batches_expiry (expiry_date),
  KEY idx_batches_branch (branch_id),
  CONSTRAINT fk_batches_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id),
  CONSTRAINT fk_batches_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT chk_batches_qty CHECK (quantity_on_hand >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Suppliers
-- ------------------------------------------------------------
CREATE TABLE suppliers (
  id          CHAR(36)     NOT NULL,
  branch_id   CHAR(36)     NOT NULL,
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(30)  NULL,
  address     VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_suppliers_branch (branch_id),
  CONSTRAINT fk_suppliers_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Customers (for credit / قرض if needed)
-- ------------------------------------------------------------
CREATE TABLE customers (
  id          CHAR(36)      NOT NULL,
  branch_id   CHAR(36)      NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  phone       VARCHAR(30)   NULL,
  balance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted  TINYINT(1)     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_customers_branch (branch_id),
  CONSTRAINT fk_customers_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Purchases (stock IN)
-- ------------------------------------------------------------
CREATE TABLE purchases (
  id           CHAR(36)      NOT NULL,
  branch_id    CHAR(36)      NOT NULL,
  supplier_id  CHAR(36)      NULL,
  invoice_no   VARCHAR(60)   NULL,
  purchase_date DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  notes        VARCHAR(255)  NULL,
  approval_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved',
  rejection_note VARCHAR(255) NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status  VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted   TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_purchases_branch_date (branch_id, purchase_date),
  KEY idx_purchases_supplier (supplier_id),
  UNIQUE KEY uq_purchase_invoice (branch_id, supplier_id, invoice_no),
  CONSTRAINT fk_purchases_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_purchases_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_items (
  id             CHAR(36)      NOT NULL,
  purchase_id    CHAR(36)      NOT NULL,
  medicine_id    CHAR(36)      NOT NULL,
  batch_id       CHAR(36)      NOT NULL,
  quantity       INT           NOT NULL,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_pitems_purchase (purchase_id),
  CONSTRAINT fk_pitems_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id),
  CONSTRAINT fk_pitems_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id),
  CONSTRAINT fk_pitems_batch FOREIGN KEY (batch_id) REFERENCES medicine_batches (id),
  CONSTRAINT chk_pitems_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Sales (stock OUT) — cost_price is a snapshot of the batch
-- purchase price at sale time, so profit reports stay correct
-- even if prices change later
-- ------------------------------------------------------------
CREATE TABLE sales (
  id           CHAR(36)      NOT NULL,
  branch_id    CHAR(36)      NOT NULL,
  invoice_no   VARCHAR(30)   NOT NULL,
  customer_id  CHAR(36)      NULL,
  sale_date    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount  DECIMAL(12,2) NULL,
  voided_at    DATETIME      NULL,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sync_status  VARCHAR(20)   NOT NULL DEFAULT 'pending',
  is_deleted   TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_branch_invoice (branch_id, invoice_no),
  KEY idx_sales_branch_date (branch_id, sale_date),
  CONSTRAINT fk_sales_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_sales_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_items (
  id           CHAR(36)      NOT NULL,
  sale_id      CHAR(36)      NOT NULL,
  medicine_id  CHAR(36)      NOT NULL,
  batch_id     CHAR(36)      NOT NULL,
  quantity     INT           NOT NULL,
  unit_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_sitems_sale (sale_id),
  CONSTRAINT fk_sitems_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_sitems_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id),
  CONSTRAINT fk_sitems_batch FOREIGN KEY (batch_id) REFERENCES medicine_batches (id),
  CONSTRAINT chk_sitems_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Sale payments — later payments against a credit (por) bill.
-- The amount paid at the till lives on sales.paid_amount; every
-- payment after that is one row here. What a customer still owes
-- is always computed from sales + returns + these rows.
-- ------------------------------------------------------------
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

-- Later payments toward what the pharmacy owes a supplier. The amount
-- paid at purchase time lives on purchases.paid_amount; the supplier's
-- due is always COMPUTED: SUM(purchases.total_amount)
--   - SUM(purchases.paid_amount) - SUM(supplier_payments.amount).
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

-- Units of a purchase sent back to the supplier. The value of a return is
-- quantity * unit_price (the purchase item's price snapshot); supplier
-- dues are computed net of these. Stock movements use the ledger type
-- 'purchase_return'.
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

-- ------------------------------------------------------------
-- Stock ledger — APPEND ONLY. Every stock movement is one row.
-- Stock is always calculated from here; rows are never edited.
-- ------------------------------------------------------------
CREATE TABLE stock_transactions (
  id              CHAR(36)    NOT NULL,
  branch_id       CHAR(36)    NOT NULL,
  medicine_id     CHAR(36)    NOT NULL,
  batch_id        CHAR(36)    NOT NULL,
  type            ENUM('purchase','sale','sale_return','purchase_return','expired','adjustment') NOT NULL,
  quantity_change INT         NOT NULL,
  reference_id    CHAR(36)    NULL,
  reason          VARCHAR(255) NULL,
  created_by      CHAR(36)    NULL,
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stock_branch_medicine (branch_id, medicine_id),
  KEY idx_stock_created (created_at),
  CONSTRAINT fk_stock_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_stock_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id),
  CONSTRAINT fk_stock_batch FOREIGN KEY (batch_id) REFERENCES medicine_batches (id),
  CONSTRAINT fk_stock_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Audit log — APPEND ONLY. Who changed what, and when.
-- ------------------------------------------------------------
CREATE TABLE app_settings (
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT         NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_log (
  id         CHAR(36)     NOT NULL,
  branch_id  CHAR(36)     NULL,
  user_id    CHAR(36)     NULL,
  action     VARCHAR(60)  NOT NULL,
  table_name VARCHAR(60)  NOT NULL,
  record_id  CHAR(36)     NULL,
  details    JSON         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Day closes — one row per closed day, per branch. While a row
-- exists the day's report is frozen: no sale, return, payment, void,
-- purchase, purchase edit/delete, write-off or supplier payment may
-- touch that date. Reopening deletes the row; the audit log keeps
-- the history. expected/counted/difference and the stock check are
-- snapshotted at close time.
-- ------------------------------------------------------------
CREATE TABLE day_closes (
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

-- ------------------------------------------------------------
-- Branch day reviews — the boss's review of a child branch's day.
-- NO row means the day is still waiting for review; accepting or
-- rejecting writes a row, and new activity on the day (or a resubmit
-- from the branch) deletes it again so the day returns to "pending".
-- The audit log keeps the full history.
-- ------------------------------------------------------------
CREATE TABLE branch_day_reviews (
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

SET FOREIGN_KEY_CHECKS = 1;
