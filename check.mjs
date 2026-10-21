// Self-check for the game-lock lineup logic: runs the real code from fantasy.mjs against made-up
// players and a fake clock. Run: node check.mjs (no ESPN login needed). Prints "ok" or throws.
import fs from 'fs';
import assert from 'assert/strict';
import crypto from 'crypto';

const src = fs.readFileSync(new URL('./fantasy.mjs', import.meta.url), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert(i >= 0 && j > i, `code moved: ${from}`); return src.slice(i, j + to.length); };
const code = cut('function bestLineup(', 'const lineupProj = t => starters(t).reduce((s, p) => s + weekValue(p), 0);')
  + '\n' + cut('const best = bestLineup(me.roster,', 'const sitOut = starters(me).filter(p => !bestIds.has(p.id));')
  + '\n' + cut('const weekScore = ', '.lineup.reduce((t, x) => t + weekValue(x.player), 0);')
  + '\n' + cut('function judge(', '    after: mineAfter,\n  };\n}')
  + '\n' + cut('const weakness = ', '  return out.sort((a, b) => b.gain - a.gain).slice(0, 5);\n}')
  + '\n' + cut('const SLOT_ID = ', 'const bestMove = lineupMove();')
  + '\nreturn { weekValue, locked, best, benchIn, sitOut, judge, bestSwap, bestMove };';

const HOUR = 3600e3, NOW = Date.UTC(2026, 9, 25, 18); // a Sunday afternoon
// team 1 played Thursday (locked), team 2 kicks off in an hour, team 3 is on bye
const pro = [{ id: 1, proGamesByScoringPeriod: { 7: [{ date: NOW - 72 * HOUR }] } }, { id: 2, proGamesByScoringPeriod: { 7: [{ date: NOW + HOUR }] } }, { id: 3, proGamesByScoringPeriod: {} }];
const pl = (id, pos, slot, proj, team, status = '') => ({ id, name: `P${id}`, pos, slot, proj, proTeamId: team, status });
const consts = {
  slotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 0, 17: 0, 20: 6, 21: 1 },
  SLOT: { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 20: 'Bench', 21: 'IR' },
  SLOT_POS: { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 23: ['RB', 'WR', 'TE'] },
  HURT: ['OUT', 'INJURY_RESERVE', 'SUSPENSION'], week: 7, pro, vor: () => 0,
  allFa: [pl(30, 'RB', 'FA', 30, 1), pl(31, 'RB', 'FA', 20, 2)], // 30 already played (locked), 31 plays later
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
  console.log('lock ok');
}
