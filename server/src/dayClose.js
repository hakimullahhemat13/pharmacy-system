// Day Close — shared helpers. A closed day is frozen: no sale, return,
// payment, void, purchase, purchase edit/delete, write-off or supplier
// payment may touch that date until an admin reopens it from Reports.
// The day_closes table may not exist yet on a server whose migration has
// not run — in that case every day reads as open, so forgetting the
// migration can never block trading. The day-close endpoints themselves
// report the missing table explicitly.

function pad(n) { return String(n).padStart(2, '0'); }

// Today's local calendar date as YYYY-MM-DD.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Calendar date (YYYY-MM-DD, server-local) of a DATETIME value coming
// back from MySQL — a Date object or a 'YYYY-MM-DD HH:mm:ss' string.
function dayOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// db is the pool or a transaction connection — both have .query.
async function isDayClosed(db, branchId, date) {
  try {
    const [rows] = await db.query(
      'SELECT id FROM day_closes WHERE branch_id = ? AND close_date = ? LIMIT 1',
      [branchId, date]
    );
    return rows.length > 0;
  } catch (err) {
    // Table missing (migration not run): the day is open. Any other
    // error is real — let it surface.
    if (err && err.code === 'ER_NO_SUCH_TABLE') return false;
    throw err;
  }
}

function isMissingDayCloseTable(err) {
  return !!err && err.code === 'ER_NO_SUCH_TABLE';
}

function dayClosedMessage(date) {
  return `Day ${date} is closed. Reopen it from Reports → Day Close to make changes for that day.`;
}

module.exports = { todayStr, dayOf, isDayClosed, isMissingDayCloseTable, dayClosedMessage };
