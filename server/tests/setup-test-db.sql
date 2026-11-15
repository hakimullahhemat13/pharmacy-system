-- One-time setup for the automated tests (run once, as root).
-- Creates the SEPARATE test database and gives the pharmacy_app user
-- full access to it. The real pharmacy_db is never touched.
-- From the project folder (PowerShell):
--   mysql -u root -p -e "SOURCE server/tests/setup-test-db.sql"
-- (Type the MySQL root password when asked; check the taskbar shows ENG.)

CREATE DATABASE IF NOT EXISTS pharmacy_db_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON pharmacy_db_test.* TO 'pharmacy_app'@'localhost';
FLUSH PRIVILEGES;
