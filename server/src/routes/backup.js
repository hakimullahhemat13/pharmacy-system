// Backup & restore.
// Download: every logged-in user may download a backup (read-only,
// harmless) — streams a mysqldump of the whole database to the browser,
// and the user picks where to save it in the browser's Save dialog.
// Restore: admin only — accepts a .sql dump as the request body and
// replays it, replacing ALL current data; the interface asks first.
// Automatic backup: when enabled (the default), the server writes one
// full dump per day into a folder on this computer, and prunes older
// files, keeping the configured number. No user action needed.
// The DB password reaches mysqldump through the MYSQL_PWD environment
// variable, so it never appears in the process arguments or any log.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { auditLog } = require('../audit');

const router = express.Router();
// Every logged-in user may DOWNLOAD a backup; only an admin may RESTORE
// one (it rewrites the whole database) or change automatic-backup settings.
router.use(authRequired);

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

function dumpArgs(cfg) {
  return [
    `--host=${cfg.host}`,
    `--port=${cfg.port}`,
    `--user=${cfg.user}`,
    '--single-transaction',
    '--default-character-set=utf8mb4',
    cfg.database,
  ];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

function localDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

router.get('/download', (req, res) => {
  const cfg = dbConfig();
  const filename = `pharmacy_db-${stamp(new Date())}.sql`;

  const child = spawn('mysqldump', dumpArgs(cfg), {
    env: { ...process.env, MYSQL_PWD: cfg.password },
  });

  let headersSent = false;
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('error', (err) => {
    if (!headersSent) {
      res
        .status(500)
        .json({ status: 'error', message: `mysqldump could not start: ${err.code || err.message}` });
    }
  });
  child.stdout.on('data', (chunk) => {
    if (!headersSent) {
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      headersSent = true;
    }
    res.write(chunk);
  });
  child.on('close', (code) => {
    if (code !== 0 && !headersSent) {
      return res.status(500).json({
        status: 'error',
        message: `Backup failed: ${stderr.trim() || `mysqldump exited with code ${code}`}`,
      });
    }
    if (code === 0) {
      auditLog(req, 'backup.downloaded', 'backups', null, { summary: `Manual backup downloaded: ${filename}` });
    }
    return res.end();
  });
});

router.post('/restore', requireRole('admin'), express.text({ type: '*/*', limit: '100mb' }), async (req, res) => {
  const sql = typeof req.body === 'string' ? req.body : '';
  if (!sql.trim()) {
    return res.status(400).json({ status: 'error', message: 'No backup file content received' });
  }
  if (!sql.includes('CREATE TABLE')) {
    return res.status(400).json({
      status: 'error',
      message: 'This file does not look like a database backup (no CREATE TABLE found)',
    });
  }
  let conn;
  try {
    conn = await mysql.createConnection({ ...dbConfig(), multipleStatements: true, charset: 'utf8mb4' });
    await conn.query(sql);
    auditLog(req, 'backup.restored', 'backups', null, {
      summary: 'Database restored from an uploaded backup file',
    });
    return res.json({ status: 'ok', message: 'Database restored from backup' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Automatic backup
// ---------------------------------------------------------------------------

// Default folder: D:\pharmacy-backups when a D: drive exists (backups stay
// safe even if Windows or the C: drive fails), otherwise a "backups" folder
// in the project root. The admin can change it to any folder in the app.
function defaultFolder() {
  try {
    if (fs.existsSync('D:\\')) return 'D:\\pharmacy-backups';
  } catch (_) {
    // Fall through to the project folder.
  }
  return path.resolve(__dirname, '..', '..', '..', 'backups');
}
const AUTO_PREFIX = 'pharmacy_db-auto-';
const AUTO_FILE_RE = /^pharmacy_db-auto-\d{4}-\d{2}-\d{2}_\d{6}\.sql$/;

let settingsTableMissing = false;

async function getSetting(key) {
  if (settingsTableMissing) return null;
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
    return rows.length ? rows[0].setting_value : null;
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      settingsTableMissing = true;
      console.error('automatic backup disabled: app_settings table is missing (run the migration)');
      return null;
    }
    throw err;
  }
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    [key, value]
  );
}

async function getAutoConfig() {
  const [enabled, folder, keep, lastRun, lastFile, lastError] = await Promise.all([
    getSetting('auto_backup_enabled'),
    getSetting('auto_backup_folder'),
    getSetting('auto_backup_keep'),
    getSetting('auto_backup_last_run'),
    getSetting('auto_backup_last_file'),
    getSetting('auto_backup_last_error'),
  ]);
  return {
    enabled: enabled === null ? true : enabled === '1',
    folder: folder || defaultFolder(),
    keep: keep === null ? 7 : Math.max(1, Math.min(90, parseInt(keep, 10) || 7)),
    lastRun: lastRun || null,
    lastFile: lastFile || null,
    lastError: lastError || null,
  };
}

// Runs mysqldump and writes the dump straight to a file. Rejects on any
// failure, removing a partial file, so a failed run never looks like a backup.
function dumpToFile(filePath) {
  return new Promise((resolve, reject) => {
    const cfg = dbConfig();
    const child = spawn('mysqldump', dumpArgs(cfg), {
      env: { ...process.env, MYSQL_PWD: cfg.password },
    });
    const out = fs.createWriteStream(filePath);
    let stderr = '';
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(filePath, () => reject(err));
    };
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => fail(new Error(`mysqldump could not start: ${err.code || err.message}`)));
    out.on('error', (err) => fail(err));
    child.stdout.pipe(out);
    child.on('close', (code) => {
      if (failed) return;
      out.end(() => {
        if (code !== 0) {
          fail(new Error(`Backup failed: ${stderr.trim() || `mysqldump exited with code ${code}`}`));
        } else {
          resolve();
        }
      });
    });
  });
}

async function pruneAutoBackups(folder, keep) {
  let names;
  try {
    names = await fs.promises.readdir(folder);
  } catch (_) {
    return;
  }
  const files = [];
  for (const name of names) {
    if (!AUTO_FILE_RE.test(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(folder, name));
      if (st.isFile()) files.push({ name, mtime: st.mtimeMs });
    } catch (_) {
      // Ignore entries that disappear mid-listing.
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(keep)) {
    await fs.promises.unlink(path.join(folder, f.name)).catch(() => undefined);
  }
}

async function runAutoBackup(cfg, trigger) {
  const folder = cfg.folder;
  await fs.promises.mkdir(folder, { recursive: true });
  const now = new Date();
  const filename = `${AUTO_PREFIX}${stamp(now)}${pad(now.getSeconds())}.sql`;
  const filePath = path.join(folder, filename);
  await dumpToFile(filePath);
  const st = await fs.promises.stat(filePath);
  await pruneAutoBackups(folder, cfg.keep);
  await setSetting('auto_backup_last_run', now.toISOString());
  await setSetting('auto_backup_last_file', filename);
  await setSetting('auto_backup_last_error', '');
  return { file: filename, size: st.size };
}

let autoRunning = false;

async function autoBackupTick() {
  if (autoRunning) return;
  let cfg;
  try {
    cfg = await getAutoConfig();
  } catch (err) {
    console.error('automatic backup check failed:', err.message);
    return;
  }
  if (settingsTableMissing || !cfg.enabled) return;
  if (cfg.lastRun && cfg.lastRun.slice(0, 10) === localDay(new Date())) return; // already backed up today
  autoRunning = true;
  try {
    const result = await runAutoBackup(cfg, 'scheduled');
    console.log(`automatic backup written: ${result.file}`);
    auditLog(null, 'backup.auto', 'backups', null, {
      summary: `Automatic backup written: ${result.file}`,
    });
  } catch (err) {
    console.error('automatic backup failed:', err.message);
    try {
      await setSetting('auto_backup_last_error', String(err.message || err).slice(0, 500));
    } catch (_) {
      // The settings write itself failed; the console line above is the record.
    }
  } finally {
    autoRunning = false;
  }
}

// Starts the scheduler: one check at server start, then every 30 minutes.
// "Once a day" is judged by calendar day, so the first server start of a
// day creates that day's backup — right for a shop computer that is not
// always on. Starting the server twice in one day does not duplicate it.
function startAutoBackup() {
  setTimeout(autoBackupTick, 5000);
  setInterval(autoBackupTick, 30 * 60 * 1000);
}

// GET /api/backup/auto/config — admin only.
router.get('/auto/config', requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getAutoConfig();
    return res.json({ status: 'ok', config: cfg, settingsTableMissing });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// PUT /api/backup/auto/config — admin only. Body: { enabled, folder, keep }
router.put('/auto/config', requireRole('admin'), async (req, res) => {
  const { enabled, folder, keep } = req.body || {};
  const folderStr = String(folder || '').trim();
  const keepNum = Number(keep);
  if (!folderStr) {
    return res.status(400).json({ status: 'error', message: 'Folder is required' });
  }
  if (!Number.isInteger(keepNum) || keepNum < 1 || keepNum > 90) {
    return res.status(400).json({ status: 'error', message: 'Keep must be a whole number between 1 and 90' });
  }
  try {
    await setSetting('auto_backup_enabled', enabled ? '1' : '0');
    await setSetting('auto_backup_folder', folderStr);
    await setSetting('auto_backup_keep', String(keepNum));
    const cfg = await getAutoConfig();
    return res.json({ status: 'ok', config: cfg });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/backup/auto/run — admin only. Runs a backup right now, even if
// one already ran today.
router.post('/auto/run', requireRole('admin'), async (req, res) => {
  if (autoRunning) {
    return res.status(409).json({ status: 'error', message: 'A backup is already running' });
  }
  autoRunning = true;
  try {
    const cfg = await getAutoConfig();
    const result = await runAutoBackup(cfg, 'manual');
    auditLog(req, 'backup.auto', 'backups', null, {
      summary: `Automatic backup run by hand: ${result.file}`,
    });
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    try {
      await setSetting('auto_backup_last_error', String(err.message || err).slice(0, 500));
    } catch (_) {
      // Ignore — the response below carries the error.
    }
    return res.status(500).json({ status: 'error', message: err.message || err.code });
  } finally {
    autoRunning = false;
  }
});

// GET /api/backup/auto/files — admin only. Lists the automatic backups on disk.
router.get('/auto/files', requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getAutoConfig();
    let names = [];
    try {
      names = await fs.promises.readdir(cfg.folder);
    } catch (_) {
      return res.json({ status: 'ok', folder: cfg.folder, files: [] });
    }
    const files = [];
    for (const name of names) {
      if (!AUTO_FILE_RE.test(name)) continue;
      try {
        const st = await fs.promises.stat(path.join(cfg.folder, name));
        if (st.isFile()) files.push({ name, size: st.size, mtime: st.mtime.toISOString() });
      } catch (_) {
        // Ignore entries that disappear mid-listing.
      }
    }
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return res.json({ status: 'ok', folder: cfg.folder, files });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/backup/auto/files/:name — admin only. Downloads one automatic backup.
// The name must match the automatic-backup pattern exactly, and the resolved
// path must stay inside the configured folder (no path traversal).
router.get('/auto/files/:name', requireRole('admin'), async (req, res) => {
  const name = req.params.name;
  if (!AUTO_FILE_RE.test(name)) {
    return res.status(400).json({ status: 'error', message: 'Not an automatic backup file' });
  }
  try {
    const cfg = await getAutoConfig();
    const folder = path.resolve(cfg.folder);
    const filePath = path.resolve(folder, name);
    if (filePath !== path.join(folder, name) || !filePath.startsWith(folder + path.sep)) {
      return res.status(400).json({ status: 'error', message: 'Invalid file name' });
    }
    const st = await fs.promises.stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      return res.status(404).json({ status: 'error', message: 'Backup file not found' });
    }
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.startAutoBackup = startAutoBackup;

module.exports = router;
