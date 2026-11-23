-- Session invalidation on password change (2026-11-23).
-- Run BEFORE restarting the backend:
--   cd ~\pharmacy-system
--   mysql -u root -p pharmacy_db -e "SOURCE migration-token-version.sql"
-- Every login token now carries the user's token_version, and the
-- server rejects a token whose version no longer matches the database
-- row. Changing your own password, or an admin resetting a password,
-- bumps token_version, so every existing session of that user stops
-- working at once and they must log in again with the new password.
-- Tokens issued before this change carry no token_version and are
-- treated as version 0, so existing logins keep working until the
-- next password change. Fresh installs already have the column in
-- database/schema.sql; this file is only for existing databases.
-- If you run it twice, MySQL stops with "Duplicate column name" —
-- that only means the column is already there.
USE pharmacy_db;

ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0;
