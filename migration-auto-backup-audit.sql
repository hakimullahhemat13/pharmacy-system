-- Automatic backup settings + audit log (2026-11-15).
-- Run BEFORE restarting the backend. Safe to run twice (IF NOT EXISTS).
USE pharmacy_db;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT         NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
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
