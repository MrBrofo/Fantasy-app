// Self-check for the game-lock lineup logic: runs the real code from fantasy.mjs against made-up
// players and a fake clock. Run: node check.mjs (no ESPN login needed). Prints "ok" or throws.
import fs from 'fs';
import assert from 'assert/strict';
import crypto from 'crypto';

const src = fs.readFileSync(new URL('./fantasy.mjs', import.meta.url), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert(i >= 0 && j > i, `code moved: ${from}`); return src.slice(i, j + to.length); };
const code = cut('function bestLineup(', 'const lineupProj = t => weekLine(t).reduce((s, p) => s + weekValue(p), 0);')
  + '\n' + cut('const best = bestLineup(me.roster,', 'const sitOut = starters(me).filter(p => !bestIds.has(p.id));')
  + '\n' + cut('const weekScore = ', '.lineup.reduce((t, x) => t + weekValue(x.player), 0);')
  + '\n' + cut('const faBest = ', '    after: mineAfter,\n  };\n}')
  + '\n' + cut('const weakness = ', '  return out.sort((a, b) => b.gain - a.gain).slice(0, 5);\n}')
  + '\n' + cut('const SLOT_ID = ', 'const bestMove = lineupMove();')
  + '\nreturn { weekValue, seasonValue, locked, best, benchIn, sitOut, judge, bestSwap, bestMove };';

const HOUR = 3600e3, NOW = Date.UTC(2026, 9, 25, 18); // a Sunday afternoon
// team 1 played Thursday (locked), team 2 kicks off in an hour, team 3 is on bye
const pro = [{ id: 1, proGamesByScoringPeriod: { 7: [{ date: NOW - 72 * HOUR }] } }, { id: 2, proGamesByScoringPeriod: { 7: [{ date: NOW + HOUR }] } }, { id: 3, proGamesByScoringPeriod: {} }, { id: 4, proGamesByScoringPeriod: { 7: [{ date: NOW + 5 * HOUR }] } }];
const pl = (id, pos, slot, proj, team, status = '') => ({ id, name: `P${id}`, pos, slot, proj, proTeamId: team, status });
const consts = {
  slotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 0, 17: 0, 20: 6, 21: 1 },
  SLOT: { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 20: 'Bench', 21: 'IR' },
  SLOT_POS: { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 23: ['RB', 'WR', 'TE'] },
  HURT: ['OUT', 'INJURY_RESERVE', 'SUSPENSION'], week: 7, playOdds: p => ({ DOUBTFUL: { pct: 7 }, QUESTIONABLE: { pct: 71 } })[p.status] ?? null, pro, vor: () => 0,
  allFa: [pl(30, 'RB', 'FA', 30, 1), { ...pl(31, 'RB', 'FA', 20, 2), ros: 5 }], // 30 already played (locked), 31 plays later
};
const run = roster => new Function(...Object.keys(consts), 'me', 'Date', code)(...Object.values(consts), { roster }, { now: () => NOW });
const ids = list => list.map(p => p.id).sort();

const base = [
  pl(1, 'QB', 'QB', 18, 2), pl(2, 'RB', 'RB', 4, 1), pl(3, 'RB', 'RB', 12, 2), pl(4, 'WR', 'WR', 11, 2), pl(5, 'WR', 'WR', 10, 2),
  pl(6, 'TE', 'TE', 8, 2), pl(7, 'WR', 'FLEX', 3, 1),
  pl(8, 'RB', 'Bench', 15, 1), // played Thursday from the bench: can't be put in now
  pl(9, 'RB', 'Bench', 9, 2), // game in an hour: can still go in
  pl(10, 'WR', 'Bench', null, 3), // on bye: ESPN gives no projection, so neither do we
];
const r = run(base);
// locked starters (2, 7) stay in even though bench players project more; locked bench (8) is worth 0
assert.equal(r.locked(base[1]), true); assert.equal(r.locked(base[8]), false); assert.equal(r.locked(base[9]), false);
assert.equal(r.weekValue(base[7]), 0, 'locked bench player counts 0');
assert.equal(r.weekValue(base[1]), 4, 'locked starter keeps his number');
assert.deepEqual(ids(r.benchIn), [], 'nobody to swap: both low starters are locked');
assert.deepEqual(ids(r.sitOut), []);
assert.equal(r.best.total, 18 + 4 + 12 + 11 + 10 + 8 + 3);

// before any game starts, the same roster does swap them
const early = run(base.map(p => ({ ...p, proTeamId: p.proTeamId === 1 ? 2 : p.proTeamId })));
assert.deepEqual(ids(early.benchIn), [8, 9]); assert.deepEqual(ids(early.sitOut), [2, 7]);

// a locked free agent is worth 0 this week; an unlocked one isn't
assert.equal(r.weekValue(pl(11, 'RB', 'FA', 14, 1)), 0); assert.equal(r.weekValue(pl(12, 'RB', 'FA', 14, 2)), 14);

// trades, this week only. Lineup now: 18 + 4 + 12 + 11 + 10 + 8 + 3 = 66 (players 2 and 7 locked in)
const them = { roster: [] };
assert.equal(r.judge([], [pl(20, 'RB', 'RB', 25, 1)], them).mineWeek, 0, 'getting a player who already played adds nothing');
assert.equal(r.judge([], [pl(21, 'RB', 'RB', 25, 2)], them).mineWeek, 25 - 10, 'getting one who plays later pushes out my lowest open starter (10)');
assert.equal(r.judge([base[1]], [], them).mineWeek, 0, 'trading away a starter who already played loses nothing this week');
assert.equal(r.judge([base[2]], [], them).mineWeek, -(12 - 9), 'trading away one who plays later: the bench RB (9) steps in');
// 2 for 1: the open roster spot gets the best free agent (31, worth 5 a game), so getting one player isn't undervalued
assert.equal(r.judge([base[2], base[3]], [{ ...pl(40, 'RB', 'RB', 0, 2), ros: 3 }], them).mine, 3 + 5, 'open spot filled from free agents');

// questionable: start him when a bench player at his position plays at the same time or later (swap him if he's inactive)
{
  const ros = team => [pl(1, 'QB', 'QB', 18, 2), pl(2, 'RB', 'RB', 12, team, 'QUESTIONABLE'), pl(3, 'RB', 'RB', 9, 2), pl(4, 'RB', 'Bench', 10, 2),
    pl(5, 'WR', 'WR', 9.5, 2), pl(6, 'WR', 'WR', 9.5, 2), pl(8, 'TE', 'TE', 6, 2), pl(9, 'WR', 'FLEX', 9, 2)];
  assert(!run(ros(2)).sitOut.some(p => p.id === 2), 'questionable RB starts: the bench RB plays at the same time');
  assert(run(ros(4)).sitOut.some(p => p.id === 2), 'questionable RB plays later than every backup: no way to swap, so 71% of his points');
}

// playoff seeding: division winners first, then record, then points
{
  const seedOrder = new Function('teams', cut('const divIds = ', 'winners };\n};') + '\nreturn seedOrder;');
  const T = (id, div, w, pf) => ({ id, div, w, pf });
  const ts = [T(1, 1, 8, 900), T(2, 1, 7, 950), T(3, 2, 4, 800), T(4, 2, 3, 990)];
  const go = list => seedOrder(list)(new Map(list.map(t => [t.id, t.w])), new Map(list.map(t => [t.id, t.pf]))).order.map(t => t.id);
  assert.deepEqual(go(ts), [1, 3, 2, 4], 'division winner with 4 wins seeds above a 7-win wild card');
  assert.deepEqual(go(ts.map(t => ({ ...t, div: 0 }))), [1, 2, 3, 4], 'no divisions: by record');
  assert.deepEqual(go([T(1, 0, 5, 800), T(2, 0, 5, 900)]), [2, 1], 'same record: more points wins');
}

// news headline tags (first match wins, so "inactive" beats "questionable")
const { newsTag } = new Function(cut('const NEWS_TAGS', 'const newsTag = h => NEWS_TAGS.find(([, , re]) => re.test(h)) ?? null;') + '\nreturn { newsTag };')();
for (const [h, want] of [
  ["Judkins (ankle) is inactive for Sunday's game against the Ravens.", 'Out'],
  ["Judkins (ankle), who is listed as questionable for Sunday's contest, will go through a pregame workout", 'Questionable'],
  ['McLaurin (knee) will miss the rest of the season', 'Out for season'],
  ['Winston will start Sunday against the Eagles', 'Starting'],
  ['Addison (hamstring) did not practice Wednesday', "Didn't practice"],
  ['Hockenson (concussion) was a limited participant Thursday', 'Limited in practice'],
  ["Lamar (ankle) is active for Sunday's game", 'Playing'],
  ['Pittman (foot) placed on injured reserve', 'Out'],
  ["McLaurin tore his left patellar tendon during Monday's loss to the 49ers", 'Out for season'],
  ['Diggs (hamstring) is listed as active Monday at San Francisco.', 'Playing'],
  ["Diggs (hamstring), who is listed as questionable for Monday's game, is in line to play", 'Playing'],
  ["McLaurin left Monday night's game against the 49ers in the first quarter with a left knee injury", 'Hurt in game'],
  ['Cook rushes for 120 yards in win', undefined],
]) assert.equal(newsTag(h)?.[0], want, h);

// playoff simulation randomness: bell curve with mean 0 and spread 1, and the same numbers every run for a week
const sim = () => new Function('week', cut('let seed = week * 7919;', 'Math.cos(2 * Math.PI * rnd());') + '\nreturn gauss;')(7);
const draws = (g => Array.from({ length: 20000 }, g))(sim());
const mean = draws.reduce((a, b) => a + b, 0) / draws.length, sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length);
assert(Math.abs(mean) < 0.03 && Math.abs(sd - 1) < 0.03, `bell curve off: mean ${mean}, sd ${sd}`);
assert.equal(sim()(), sim()(), 'same week, same numbers');

// transaction locking: no pickup of a player who already played, no drop of one either
const swaps = r.bestSwap(base, r.weekValue);
assert(swaps.length && swaps.every(x => x.add.id === 31), 'only the free agent who plays later');
assert(swaps.every(x => !r.locked(x.drop)), 'never drops a player whose game has started');
// lineup move sent to ESPN: legal slots, gives exactly the best lineup, never moves a locked player
const applyMove = (roster, move) => roster.map(p => { const x = move?.items.find(i => i.playerId === p.id); return x ? { ...p, slot: consts.SLOT[x.to] } : p; });
for (const t of [r, early]) {
  const roster = t === r ? base : base.map(p => ({ ...p, proTeamId: p.proTeamId === 1 ? 2 : p.proTeamId })), after = applyMove(roster, t.bestMove);
  for (const [id, k] of Object.entries(consts.slotCounts)) if (consts.SLOT_POS[id]) {
    const inSlot = after.filter(p => p.slot === consts.SLOT[id]);
    assert(inSlot.length <= k && inSlot.every(p => consts.SLOT_POS[id].includes(p.pos)), 'legal slot ' + consts.SLOT[id]);
  }
  assert.deepEqual(ids(after.filter(p => p.slot !== 'Bench' && p.slot !== 'IR')), ids(t.best.lineup.map(x => x.player)), 'move gives the best lineup');
  assert(!(t.bestMove?.items ?? []).some(x => t.locked(roster.find(p => p.id === x.playerId))), 'never moves a locked player');
}
assert.equal(r.bestMove, null, 'nothing to move on Sunday: the low starters are locked');
assert.equal(early.bestMove.items.length, 4, 'two in, two out');

// waiver rivals for bye-week fill-ins: a team ahead of me whose only kicker is on bye next week takes the best waiver kicker
{
  const lostOnWaivers = new Function('teams', 'me', 'week', 'playable', 'slotCounts', 'FA_SLOT', 'allFa', 'nextValue',
    cut('const shortNextWeek = ', '  return k > 0 &&') + ' allFa.filter(o => o.wa && o.pos === c.pos && o.id !== c.id && !taken.has(o.id) && nextValue(o) > nextValue(c)).length < k;\n};\nreturn lostOnWaivers;');
  const k = (id, bye, wa, next) => ({ id, pos: 'K', slot: 'Bench', bye, wa, next });
  const me = { waiver: 11, roster: [k(1, 8)] }, ahead = { waiver: 2, roster: [k(2, 8)] }, fine = { waiver: 3, roster: [k(3, 9)] };
  const loop = k(10, 13, true, 9.8), smack = k(11, 11, true, 9.1), mcl = k(12, 10, false, 9.2);
  const run = (teams, fa) => lostOnWaivers(teams, me, 7, () => true, { 17: 1 }, { K: 17 }, fa, p => p.next);
  const one = run([me, ahead, fine], [loop, smack, mcl]);
  assert(one(loop, new Set()) && !one(smack, new Set()) && !one(mcl, new Set()), 'one rival takes the top waiver kicker; free agents are never lost');
  assert(!run([me, fine], [loop])(loop, new Set()), 'no rival short at kicker: claim is safe');
}

// injuries and close calls in the lineup
{
  const qb = [pl(1, 'QB', 'QB', 18, 2), pl(2, 'RB', 'RB', 10, 2, 'DOUBTFUL'), pl(3, 'RB', 'RB', 9, 2), pl(4, 'RB', 'Bench', 8, 2),
    pl(5, 'WR', 'WR', 8.5, 2), pl(6, 'WR', 'WR', 8, 2), pl(7, 'WR', 'Bench', 8.6, 2), pl(8, 'TE', 'TE', 6, 2), pl(9, 'WR', 'FLEX', 8.4, 2)];
  const t = run(qb);
  assert(Math.abs(t.weekValue(qb[1]) - 0.7) < 1e-9, 'doubtful counts his 7% chance to play');
  assert(t.benchIn.some(p => p.id === 4) && t.sitOut.some(p => p.id === 2), 'healthy 8 replaces the doubtful 10');
  assert(!t.benchIn.some(p => p.id === 7), '8.6 on the bench vs WRs at 8.5, 8.4 and 8 is a coin flip: no swap');
  assert.equal(t.seasonValue({ ...pl(20, 'WR', 'WR', 0, 2, 'OUT'), ros: 12 }), 12, 'out this week keeps his rest-of-season value');
  assert.equal(t.seasonValue({ ...pl(21, 'WR', 'IR', 0, 2, 'INJURY_RESERVE'), ros: 12 }), 0, 'IR is worth 0');
}

// advice check: each rule catches the mistake it was written for, and good advice passes clean
{
  const adviceCheck = new Function(cut('function adviceCheck(', '  return out;\n}') + '\nreturn adviceCheck;')();
  const P = (id, pos, o = {}) => ({ id, name: `P${id}`, pos, slot: 'Bench', status: '', bye: 12, proj: 0, next: 0, ros: 5, ...o });
  const zvada = P(1, 'K', { slot: 'K', bye: 8, proj: 8.7 }), sanders = P(2, 'K', { proj: 8.9, next: 9.0, ros: 8 });
  const mcl = P(3, 'K', { next: 9.2, ros: 8.8 }), lions = P(4, 'D/ST', { next: 5.1, ros: 4.8 }), cmdrs = P(5, 'D/ST', { next: 7.4, ros: 4.7 });
  const texans = P(6, 'D/ST', { slot: 'D/ST', bye: 8, proj: 8 }), winston = P(7, 'QB', { ros: 5 }), mendoza = P(8, 'QB', { ros: 8.5 });
  const doubt = P(9, 'RB', { slot: 'RB', status: 'DOUBTFUL', proj: 0.7 }), rb2 = P(10, 'RB', { proj: 6 }), out1 = P(11, 'WR', { slot: 'WR', status: 'OUT', ros: 10 });
  const ctx = o => ({
    week: 7, weekValue: p => p.proj, nextValue: p => p.next, seasonValue: p => (p.status === 'OUT' ? 0 : p.ros), rate: p => p.ros, locked: () => false,
    benchIn: [], replaces: new Map(), lineup: [], roster: [], base: [], seasonStarters: new Set(), fills: [], plan: [], benchUps: [], claims: [],
    allFa: [mcl, lions, cmdrs], taken: new Set(), lost: () => false, slotPos: { RB: ['RB'], K: ['K'] }, ...o });
  assert.equal(adviceCheck(ctx({ benchIn: [sanders], replaces: new Map([[sanders, zvada]]) })).length, 1, 'catches "Do now" for a 0.2-point swap');
  assert.equal(adviceCheck(ctx({ lineup: [{ slot: 'RB', player: doubt }], roster: [doubt, rb2] })).length, 1, 'catches a doubtful starter kept over a healthy bench RB');
  assert.equal(adviceCheck(ctx({ fills: [{ add: lions, byeFor: [texans] }], allFa: [lions, cmdrs] })).length, 1, 'catches the Lions picked over the Commanders for the bye week');
  assert.match(adviceCheck(ctx({ fills: [{ add: sanders, byeFor: [zvada] }], allFa: [sanders, mcl] })).map(x => x[1]).join(), /coin flip/, 'catches a close call not marked close');
  assert.equal(adviceCheck(ctx({ fills: [{ add: sanders, byeFor: [zvada], close: mcl }], allFa: [sanders, mcl] })).length, 0, 'a close call marked close passes');
  assert.equal(adviceCheck(ctx({ plan: [{ add: rb2, drop: doubt, gain: 0.4, kind: 'season' }] })).length, 1, 'catches a pickup step worth under a point');
  assert.equal(adviceCheck(ctx({ base: [winston], allFa: [mendoza] })).length, 1, 'catches a much better backup QB nobody mentions');
  assert.equal(adviceCheck(ctx({ base: [winston], allFa: [mendoza], benchUps: [{ add: mendoza, drop: winston }] })).length, 0, 'a mentioned backup passes');
  assert.equal(adviceCheck(ctx({ roster: [out1] })).length, 1, 'catches a one-week absence worth 0 for the season');
  assert.equal(adviceCheck(ctx({ claims: [{ add: [mcl] }], lost: p => p === mcl })).length, 1, 'catches an unflagged claim a team ahead will win');
  assert.equal(adviceCheck(ctx({ fills: [{ add: cmdrs, byeFor: [texans] }], allFa: [lions, cmdrs] })).length, 0, 'good advice: no warnings');
}
// bench check: keep a bye cover and a real backup, free up a spare and say what to do with his spot
{
  const slotCounts = { 0: 1, 2: 2, 4: 2, 6: 1 }, SLOT = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE' }, SLOT_POS = { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'] };
  const bestLineup = new Function('slotCounts', 'SLOT', 'SLOT_POS', cut('function bestLineup(', '  return { lineup, total: lineup.reduce((s, x) => s + value(x.player), 0) };\n}') + '\nreturn bestLineup;')(slotCounts, SLOT, SLOT_POS);
  const pp = (name, pos, r, slot = 'Bench', bye = 0) => ({ id: name, name, pos, r, slot, bye });
  const starters = [pp('qb', 'QB', 20, 'QB'), pp('rb1', 'RB', 15, 'RB'), pp('rb2', 'RB', 14, 'RB'), pp('wr1', 'WR', 15, 'WR', 9), pp('wr2', 'WR', 14, 'WR'), pp('te', 'TE', 6, 'TE')];
  const backup = pp('rb3', 'RB', 8), spare = pp('rb4', 'RB', 5), cover = pp('wr3', 'WR', 7), freeTe = pp('fte', 'TE', 9, 'FA'), freeRb = pp('frb', 'RB', 4, 'FA');
  const baseRoster = [...starters, backup, spare, cover];
  const g = { week: 8, lastWeek: 14, rosSaved: { future: { by: {} } }, bestLineup, score: (r, v) => bestLineup(r, v).total, seasonValue: p => p.r, weekValue: p => (p.slot === 'Bench' ? 0 : p.r),
    rate: p => p.r, locked: () => false, faBest: [freeTe, freeRb], benchTaken: new Set(), plan: [], benchUps: [], baseRoster, seasonStarterIds: new Set(starters.map(p => p.id)),
    POS_NAME: { QB: 'Quarterback', RB: 'Running back', WR: 'Wide receiver', TE: 'Tight end' }, f1: v => v.toFixed(1), FA_SLOT: { QB: 0, RB: 2, WR: 4, TE: 6 },
    trades: [{ give: spare, take: pp('x', 'WR', 16), team: { name: 'T' }, mine: 2, strict: true }], fleece: [] };
  const bc = new Function(...Object.keys(g), cut('const benchHorizon = [];', '  return { p, swap, trade, steal, planned: plan.some(s => s.drop === p) || benchUps.some(x => x.drop === p) };\n});') + '\nreturn benchCheck;')(...Object.values(g));
  const by = Object.fromEntries(bc.map(b => [b.p.id, b]));
  assert(/week 9, covering wr1's bye/.test(by.wr3.keep), 'bye cover kept: ' + by.wr3.keep);
  assert(/top backup/.test(by.rb3.keep), 'real backup kept: ' + by.rb3.keep);
  assert(!by.rb4.keep && by.rb4.swap?.add === freeTe && Math.round(by.rb4.swap.gain) === 12 && by.rb4.trade?.take.id === 'x', 'spare: swap for the better TE (+3 x 4 weeks) and a trade');
}

// wind cuts passing and kicking outdoors only; a QB split needs games both ways and is pulled toward no change
{
  const { windFactor, qbSplit } = new Function('rosSaved', cut('const WIND_CUT = ', '  return { ratio, games: wo.length, with: avg(w), without: avg(wo) };\n}') + '\nreturn { windFactor, qbSplit };')({});
  assert.equal(windFactor('WR', { wind: 18 }), 0.93);
  assert.equal(windFactor('K', { wind: 25 }), 0.88);
  assert.equal(windFactor('RB', { wind: 25 }), 1, 'runners not cut');
  assert.equal(windFactor('QB', { wind: 25, indoor: true }), 1, 'dome: no wind');
  assert.equal(windFactor('QB', { wind: 10 }), 1);
  const wk = (me, qb) => ({ wr: [80, 'X', me], ...(qb ? { qb: [100, 'X', 20] } : {}) });
  const weeks = { 1: wk(20, true), 2: wk(20, true), 3: wk(10, false), 4: wk(10, false) };
  const sp = qbSplit('wr', 'qb', weeks);
  assert(sp && sp.games === 2 && Math.abs(sp.ratio - (1 - 0.5 * 2 / 6)) < 1e-9, 'half as good without him, 2 games: pulled to ' + sp?.ratio);
  assert.equal(qbSplit('wr', 'qb', { 1: wk(20, true), 2: wk(10, false), 3: wk(10, false) }), null, 'one game with him is too few');
}

// why a past week went the way it did
{
  const K = n => `${n}|CIN`;
  const weeks = { 1: { [K('wr a')]: [90, 'DEN'], [K('qb a')]: [100, 'DEN'], [K('wr b')]: [80, 'DEN'] }, // normal week, tough defense
    2: { [K('wr a')]: [30, 'BAL'], [K('qb b')]: [100, 'BAL'], [K('wr b')]: [80, 'BAL'] }, // starter QB out, few snaps
    3: { [K('qb a')]: [100, 'KC'], [K('wr b')]: [80, 'KC'] }, // he missed it
    4: { 'x|PIT': [80, 'CLE'] } }; // CIN on bye
  const allowed = { WR: Object.fromEntries(['DEN', 'BAL', 'KC', ...'ABCDEFGHIJ'].map((t, i) => [t, t === 'DEN' ? 1 : 10 + i])) };
  const usual = [[K('qb a'), 'QB A', 'QB', 'CIN', 50], [K('qb b'), 'QB B', 'QB', 'CIN', 10], [K('wr a'), 'WR A', 'WR', 'CIN', 40], [K('wr b'), 'WR B', 'WR', 'CIN', 30]];
  const whyWeek = new Function('rosSaved', 'ordinal', 'norm', 'TEAM', 'pkey', 'POS_PL', 'usualBy',
    cut('const usualStarters = ', '\n') + cut('const defRank = ', '\n') + cut('const POS_ONE = ', '  return out;\n}') + '\nreturn whyWeek;');
  const usualBy = new Map();
  for (const [k, name, pos, team, pts] of usual) (usualBy.get(`${team}|${pos}`) ?? usualBy.set(`${team}|${pos}`, []).get(`${team}|${pos}`)).push({ k, name, pos, pts });
  const f = whyWeek({ weeks, allowed }, k => k + 'th', s => s.toLowerCase(), t => t, (name, pos, team) => `${name.toLowerCase()}|${team}`, { WR: 'receivers' }, usualBy);
  const p = { name: 'WR A', pos: 'WR', team: 'CIN', avg: 10 };
  const w1 = f(p, 1, 5), w2 = f(p, 2, 3);
  assert(w1.length === 1 && /toughest/.test(w1[0]), 'tough defense named: ' + w1);
  assert(w2.some(t => /QB A, didn't play/.test(t)) && w2.some(t => /only 30%/.test(t)), 'QB out and snap drop named: ' + w2);
  assert.deepEqual(f(p, 3, null), ["He didn't play (hurt or inactive)."]);
  assert.deepEqual(f(p, 4, null), [], 'bye week: nothing');
  assert(!f({ ...p, name: 'WR B' }, 1, 30).some(t => /QB B/.test(t)), "a backup who hadn't played yet isn't \"missing\"");
}
console.log('ok');

// site lock: the published page can't be read without the password, and the password opens it
{
  const lockPage = new Function('crypto', 'Buffer', cut('async function lockPage(', "</script></body></html>`;\n}") + '\nreturn lockPage;')(crypto, Buffer);
  const page = '<html><head><meta name="built" content="1"></head><body>my roster ✓</body></html>', out = await lockPage(page, 'pw');
  assert(!out.includes('my roster') && out.includes('name="built" content="1"'), 'page hidden, build time readable');
  const [salt, iv, data] = ['salt', 'iv', 'data'].map(k => Buffer.from(out.match(new RegExp(k + ": '([^']+)'"))[1], 'base64'));
  const { subtle } = crypto.webcrypto, base = await subtle.importKey('raw', Buffer.from('pw'), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  assert.equal(Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv }, key, data)).toString(), page);
  // the phone saves the key, so the next build must use the same salt (and a new iv)
  const next = await lockPage(page, 'pw'), field = (s, k) => s.match(new RegExp(k + ": '([^']+)'"))[1];
  assert(field(next, 'salt') === field(out, 'salt') && field(next, 'iv') !== field(out, 'iv'), 'same salt, new iv each build');
  console.log('lock ok');
}
