// Money — one place for the cent rule.
//
// Every money value the server computes or stores is rounded to cents
// (2 decimals) at the point of computation. JavaScript floats cannot
// hold decimal money exactly (19.99 x 3 is 59.96999999999999), so an
// unrounded total leaks into API responses, the audit log and Excel,
// and a stored total can disagree with the sum of its stored lines by
// a cent. Rounding here — never in the client — keeps
// total = sum(lines) everywhere.
function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

module.exports = { round2 };
