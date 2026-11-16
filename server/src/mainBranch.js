// The Main Branch is the oldest branch — the head office. Its admin is
// the only approver: medicines and purchases entered in any other
// branch wait for approval, and each child branch's day waits for the
// boss's review. With a single branch, that branch IS the main branch,
// so everything is approved at once and single-pharmacy use looks
// exactly as before. db is the pool or a transaction connection.

// The first branch ever created (oldest created_at; id breaks a tie).
async function getMainBranchId(db) {
  const [rows] = await db.query(
    'SELECT id FROM branches WHERE is_deleted = 0 ORDER BY created_at ASC, id ASC LIMIT 1'
  );
  return rows.length ? rows[0].id : null;
}

// A day whose review row disappears returns to "pending" for the boss.
// Called after new activity changes a day's numbers (a sale, a return,
// a void, an approved purchase) — the figures the boss accepted no
// longer describe the day, so the day needs reviewing again. Callers
// AWAIT it (with errors swallowed): the review state must be settled
// before the response returns, or a reader checking right after the
// action still sees the old accepted review. It must never break the
// action it follows: a missing table (migration not run yet) simply
// means no reviews exist, and any other failure is swallowed by the
// caller's .catch().
async function resetDayReview(db, branchId, date) {
  try {
    await db.query('DELETE FROM branch_day_reviews WHERE branch_id = ? AND review_date = ?', [branchId, date]);
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return;
    throw err;
  }
}

module.exports = { getMainBranchId, resetDayReview };
