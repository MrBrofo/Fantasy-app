// Self-check for the game-lock lineup logic: runs the real code from fantasy.mjs against made-up
// players and a fake clock. Run: node check.mjs (no ESPN login needed). Prints "ok" or throws.
import fs from 'fs';
import assert from 'assert/strict';

const src = fs.readFileSync(new URL('./fantasy.mjs', import.meta.url), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert(i >= 0 && j > i, `code moved: ${from}`); return src.slice(i, j + to.length); };
const code = cut('function bestLineup(', 'const lineupProj = t => starters(t).reduce((s, p) => s + weekValue(p), 0);')
  + '\n' + cut('const best = bestLineup(me.roster,', 'const sitOut = starters(me).filter(p => !bestIds.has(p.id));')
  + '\nreturn { weekValue, locked, best, benchIn, sitOut };';

const HOUR = 3600e3, NOW = Date.UTC(2026, 9, 25, 18); // a Sunday afternoon
// team 1 played Thursday (locked), team 2 kicks off in an hour, team 3 is on bye
const pro = [{ id: 1, proGamesByScoringPeriod: { 7: [{ date: NOW - 72 * HOUR }] } }, { id: 2, proGamesByScoringPeriod: { 7: [{ date: NOW + HOUR }] } }, { id: 3, proGamesByScoringPeriod: {} }];
const consts = {
  slotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 0, 17: 0, 20: 6, 21: 1 },
  SLOT: { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 20: 'Bench', 21: 'IR' },
  SLOT_POS: { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 23: ['RB', 'WR', 'TE'] },
  HURT: ['OUT', 'INJURY_RESERVE', 'SUSPENSION'], week: 7, pro,
};
const run = roster => new Function(...Object.keys(consts), 'me', 'Date', code)(...Object.values(consts), { roster }, { now: () => NOW });
const pl = (id, pos, slot, proj, team, status = '') => ({ id, name: `P${id}`, pos, slot, proj, proTeamId: team, status });
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
console.log('ok');
