// The gold account: what brought gold into a country in a quarter and what took it out, item by item.
// Nothing here moves gold or decides anything. Every place in the engine that moves gold between countries says so here as it does it
// (moved), and when the quarter closes the account is shut and kept for five quarters (c.goldLog), so that a keeper of the treasury who
// says the reserve is running out can say what is taking it (queries.js memoranda), and how that differs from a year ago.
// (World 19: one state's reserve fell from 926 to 397 in three years. Its ruler was told every quarter how long the gold would last and
// was never told that it went on cloth he himself had put first among the country's purchases, while his neighbours bought less grain.)
// Keys: a good's own name for what is sold and bought abroad (treaty deliveries that are paid for among them); tolls, interest, freight,
// insurance, dividends, flight (money sent abroad by its owners), withdrawn and home (money called back), mines, treaty (tribute and
// reparations), lent, borrowed, repaid, aid, loot, customs (seized from a debtor), secession; and other, for what no place has named.
export function moved(c, key, amount) {
  if (!c || !Number.isFinite(amount) || Math.abs(amount) < 1e-9) return;
  const g = c._gold ||= { in: {}, out: {} }, side = amount > 0 ? g.in : g.out; side[key] = (side[key] || 0) + Math.abs(amount);
}
// The day's reserve is noted when a quarter opens for a country that has no account yet (a new state, an old save).
export const openGold = c => { c._goldWas ??= c.reserves; };
export function closeGold(c, turn) {
  const g = c._gold || { in: {}, out: {} }, tot = o => Object.values(o).reduce((a, v) => a + v, 0);
  // What the reserve did that no place accounted for is written down as what it is, so that the account always adds up to the reserve.
  if (c._goldWas != null) { const rest = c.reserves - c._goldWas - (tot(g.in) - tot(g.out)); if (Math.abs(rest) > .5) (rest > 0 ? g.in : g.out).other = Math.abs(rest); }
  (c.goldLog ||= []).push({ t: turn, in: g.in, out: g.out }); if (c.goldLog.length > 5) c.goldLog.shift();
  c._gold = { in: {}, out: {} }; c._goldWas = c.reserves;
}
