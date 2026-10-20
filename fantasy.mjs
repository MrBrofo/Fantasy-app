// ESPN fantasy league report. Run: node fantasy.mjs  ->  writes site/index.html next to this file.
// Login comes from env ESPN_S2 / SWID / LEAGUE_ID (GitHub Actions) or league-config.json (local).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, 'league-config.json');
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const ESPN_S2 = process.env.ESPN_S2 || cfg.espn_s2;
const SWID = process.env.SWID || cfg.SWID;
const LEAGUE_ID = process.env.LEAGUE_ID || cfg.leagueId;
const SEASON = Number(process.env.SEASON || cfg.season || new Date().getFullYear());
if (!ESPN_S2 || !SWID || !LEAGUE_ID) throw new Error('Missing ESPN_S2, SWID or LEAGUE_ID');

const H = { Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}` };
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}`;
const LEAGUE = `${BASE}/segments/0/leagues/${LEAGUE_ID}`;

async function get(url, filter) {
  const headers = filter ? { ...H, 'x-fantasy-filter': JSON.stringify(filter) } : H;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} from ESPN: ${(await r.text()).slice(0, 200)}${r.status === 401 ? ' (cookies expired? re-copy espn_s2/SWID)' : ''}`);
  return r.json();
}

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const POS_NAME = { QB: 'Quarterback', RB: 'Running back', WR: 'Wide receiver', TE: 'Tight end', K: 'Kicker', 'D/ST': 'Defense' };
const SLOT = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR', 23: 'FLEX' };
const SLOT_POS = { 0: ['QB'], 2: ['RB'], 3: ['RB', 'WR'], 4: ['WR'], 5: ['WR', 'TE'], 6: ['TE'], 7: ['QB', 'RB', 'WR', 'TE'], 16: ['D/ST'], 17: ['K'], 23: ['RB', 'WR', 'TE'] };
const SLOT_ORDER = ['QB', 'RB', 'RB/WR', 'WR', 'WR/TE', 'TE', 'FLEX', 'OP', 'D/ST', 'K', 'Bench', 'IR'];
const FA_SLOT = { QB: 0, RB: 2, WR: 4, TE: 6, K: 17, 'D/ST': 16 };
const HURT = ['OUT', 'INJURY_RESERVE', 'SUSPENSION'];
const STATUS = {
  QUESTIONABLE: ['Might not play', 'warn'], DOUBTFUL: ['Probably won\'t play', 'bad'], OUT: ['Out this week', 'bad'],
  INJURY_RESERVE: ['Hurt long-term (IR)', 'bad'], SUSPENSION: ['Suspended', 'bad'],
};

const league = await get(`${LEAGUE}?view=mSettings&view=mTeam&view=mRoster&view=mStatus&view=mMatchupScore`);
const week = league.status?.currentMatchupPeriod ?? league.scoringPeriodId;
const pro = (await get(`${BASE}?view=proTeamSchedules_wl`)).settings.proTeams;
const proAbbr = Object.fromEntries(pro.map(t => [t.id, t.abbrev]));
const proName = Object.fromEntries(pro.map(t => [t.id, t.id ? `${t.location} ${t.name}` : 'No team']));
const proBye = Object.fromEntries(pro.map(t => [t.id, t.byeWeek]));
const slotCounts = league.settings.rosterSettings.lineupSlotCounts;
const playoffTeams = league.settings.scheduleSettings?.playoffTeamCount ?? 0;
const lastWeek = league.settings.scheduleSettings?.matchupPeriodCount ?? 14;

// statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season, 1 = one week.
// Stats also include last season's totals, so filter by seasonId.
const stat = (p, src, split) => p.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === split && (split === 0 || s.scoringPeriodId === week));

// ratings[0] = season-long; positionalRanking = e.g. 14th-best QB so far
function row(p, ratings) {
  const season = stat(p, 0, 0);
  const proj = stat(p, 1, 1);
  return {
    id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] ?? '?', proTeamId: p.proTeamId,
    team: proAbbr[p.proTeamId] ?? 'FA', teamName: proName[p.proTeamId] ?? 'No team', bye: proBye[p.proTeamId] ?? null,
    status: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    pts: season?.appliedTotal ?? null, avg: season?.appliedAverage ?? null, proj: proj?.appliedTotal ?? null, ceiling: proj?.appliedTotalCeiling ?? null,
    owned: p.ownership?.percentOwned ?? null, trend: p.ownership?.percentChange ?? 0, rank: ratings?.[0]?.positionalRanking || null,
  };
}

const names = {};
const teams = league.teams.map(t => {
  const roster = t.roster.entries.map(e => {
    const p = e.playerPoolEntry.player;
    names[p.id] = p.fullName;
    return { ...row(p, e.playerPoolEntry.ratings), slot: SLOT[e.lineupSlotId] ?? e.lineupSlotId };
  });
  const r = t.record.overall;
  return { id: t.id, name: t.name.trim(), owners: t.owners, w: r.wins, l: r.losses, pf: r.pointsFor, pa: r.pointsAgainst, waiver: t.waiverRank, roster };
});
const teamName = Object.fromEntries(teams.map(t => [t.id, t.name]));
const me = teams.find(t => t.owners?.includes(SWID));

// Injury details (type, expected return, out for season) for my hurt players; only the player card view has them
const hurtIds = me.roster.filter(p => p.status).map(p => p.id);
if (hurtIds.length) {
  const d = await get(`${LEAGUE}?view=kona_playercard&scoringPeriodId=${week}`, { players: { filterIds: { value: hurtIds } } });
  for (const x of d.players) {
    const i = x.player.injuryDetails, p = me.roster.find(r => r.id === x.player.id);
    if (i && p) p.inj = { type: i.type, back: i.expectedReturnDate && new Date(i.expectedReturnDate[0], i.expectedReturnDate[1] - 1, i.expectedReturnDate[2]), season: i.outForSeason };
  }
}

// Best lineup for a set of players. Single-position slots fill first, then the
// flex-type slots, narrowest first; with ESPN's slot shapes that greedy fill is optimal.
// value(p) = points we expect from p; players who can't play should get 0.
function bestLineup(players, value) {
  const left = [...players].filter(p => value(p) > 0).sort((a, b) => value(b) - value(a));
  const lineup = [];
  const slots = Object.entries(slotCounts).filter(([id, n]) => n > 0 && SLOT_POS[id]).sort(([a], [b]) => SLOT_POS[a].length - SLOT_POS[b].length);
  for (const [id, n] of slots) for (let i = 0; i < n; i++) {
    const k = left.findIndex(p => SLOT_POS[id].includes(p.pos));
    if (k >= 0) lineup.push({ slot: SLOT[id], player: left.splice(k, 1)[0] });
  }
  return { lineup, total: lineup.reduce((s, x) => s + value(x.player), 0) };
}
const playable = p => p.slot !== 'IR' && !HURT.includes(p.status);
const weekValue = p => (playable(p) ? p.proj ?? 0 : 0);
const seasonValue = p => (playable(p) ? p.avg ?? 0 : 0);
const score = (players, value) => bestLineup(players, value).total;
const starters = t => t.roster.filter(p => p.slot !== 'Bench' && p.slot !== 'IR');
const lineupProj = t => starters(t).reduce((s, p) => s + weekValue(p), 0);

// This week's opponent
const game = league.schedule?.find(g => g.matchupPeriodId === week && (g.home?.teamId === me.id || g.away?.teamId === me.id));
const opp = game && teams.find(t => t.id === (game.home.teamId === me.id ? game.away?.teamId : game.home.teamId));
const [mySide, oppSide] = game ? (game.home.teamId === me.id ? [game.home, game.away] : [game.away, game.home]) : [];

// Free agents + waivers: top 40 by ownership at each position
const fa = {};
for (const [pos, slot] of Object.entries(FA_SLOT)) {
  const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, {
    players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [slot] }, limit: 40, sortPercOwned: { sortPriority: 1, sortAsc: false } },
  });
  fa[pos] = d.players.map(x => { names[x.player.id] = x.player.fullName; return { ...row(x.player, x.ratings), wa: x.status === 'WAIVERS', slot: 'FA' }; });
}
const allFa = Object.values(fa).flat();

// Available players being added fastest across all ESPN leagues
const trending = (await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, {
  players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: Object.values(FA_SLOT) }, limit: 8, sortPercChanged: { sortPriority: 1, sortAsc: false } },
})).players.map(x => ({ ...row(x.player, x.ratings), wa: x.status === 'WAIVERS', slot: 'FA' })).filter(p => p.trend > 0);

// --- Start / sit: best lineup by this week's projections vs what's set now
const best = bestLineup(me.roster, weekValue);
const bestIds = new Set(best.lineup.map(x => x.player.id));
const benchIn = best.lineup.map(x => x.player).filter(p => !starters(me).includes(p));
const sitOut = starters(me).filter(p => !bestIds.has(p.id));

// --- Waiver pickups: add each free agent, drop whichever player hurts least.
// Injured players are never suggested as drops (they come back), unless out for the season.
// A this-week pickup also pays for any season-long points it costs, so a star on bye is never the drop.
const weakness = p => (p.inj?.season ? -1 : p.avg ?? 0); // tie-break: drop out-for-season players first
function bestSwap(roster, value, used = new Set()) {
  const base = score(roster, value);
  const seasonBase = score(roster, seasonValue);
  const drops = roster.filter(p => p.slot !== 'IR' && (!HURT.includes(p.status) || p.inj?.season) && !used.has(p.id));
  const out = [];
  for (const add of allFa) {
    if (value(add) <= 0 || used.has(add.id)) continue;
    let top = null;
    for (const drop of drops) {
      const next = [...roster.filter(p => p !== drop), add];
      const gain = score(next, value) - base + (value === seasonValue ? 0 : Math.min(0, score(next, seasonValue) - seasonBase));
      // on a tie, drop the weaker player
      if (!top || gain > top.gain + 0.05 || (gain > top.gain - 0.05 && weakness(drop) < weakness(top.drop))) top = { add, drop, gain };
    }
    if (top && top.gain >= 1) out.push(top); // under a point isn't worth a roster move
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, 5);
}
// One plan, done in order: each step is applied before picking the next, so every step
// drops a different player and players added earlier in the plan are never dropped.
const plan = [];
{
  let roster = [...me.roster];
  const used = new Set();
  for (const [kind, value] of [['week', weekValue], ['season', seasonValue]]) {
    while (plan.length < 5) {
      const opts = bestSwap(roster, value, used);
      if (!opts.length) break;
      const s = opts[0];
      plan.push({ ...s, kind, alts: opts.slice(1).filter(o => o.add.pos === s.add.pos).slice(0, 2) });
      used.add(s.add.id);
      roster = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
    }
  }
  // Same set of drops, but paired with a same-position add where possible so steps read
  // naturally (defense for defense), then each step's gain is recounted in that order.
  const drops = plan.map(s => s.drop);
  for (const s of plan) { const k = drops.findIndex(d => d.pos === s.add.pos); s.drop = drops.splice(Math.max(k, 0), 1)[0]; }
  roster = [...me.roster];
  for (const s of plan) {
    const value = s.kind === 'week' ? weekValue : seasonValue;
    const next = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
    s.gain = score(next, value) - score(roster, value);
    roster = next;
  }
}
const weekPlanGain = plan.filter(s => s.kind === 'week').reduce((t, s) => t + s.gain, 0);

// --- Trades. Managers judge a player by "value over replacement": how much better he is than the
// best player free on waivers at his position. A great tight end is rare, so he's worth more than
// his raw points say; raw points alone made swapping an elite TE for a RB look fair when it isn't.
const healthyFa = pos => (fa[pos] ?? []).filter(p => !HURT.includes(p.status)).map(p => p.avg ?? 0).sort((a, b) => b - a);
const repl = Object.fromEntries(Object.keys(FA_SLOT).map(pos => [pos, healthyFa(pos)[1] ?? healthyFa(pos)[0] ?? 0]));
const vor = p => Math.max(0, (p.avg ?? 0) - (repl[p.pos] ?? 0));
// Who would start at a position (best by season average) in a roster
const starterAt = (roster, pos) => bestLineup(roster, seasonValue).lineup.map(x => x.player).filter(p => p.pos === pos).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
// Effect of a trade on both teams. give = players I send, take = players I get.
function judge(give, take, them) {
  const mineAfter = [...me.roster.filter(p => !give.includes(p)), ...take];
  const theirsAfter = [...them.roster.filter(p => !take.includes(p)), ...give];
  return {
    mine: score(mineAfter, seasonValue) - score(me.roster, seasonValue),
    mineWeek: score(mineAfter, weekValue) - score(me.roster, weekValue),
    theirs: score(theirsAfter, seasonValue) - score(them.roster, seasonValue),
    vorGive: give.reduce((s, p) => s + vor(p), 0), vorTake: take.reduce((s, p) => s + vor(p), 0),
    after: mineAfter,
  };
}

// Trade ideas: 1-for-1, worth 2+ points a week to me, and fair to them on value over replacement.
// ponytail: 1-for-1 only; add 2-for-1 if this gets used a lot.
const tradeable = p => playable(p) && !['K', 'D/ST'].includes(p.pos) && (p.avg ?? 0) > 0;
const trades = [];
for (const t of teams) {
  if (t === me) continue;
  for (const give of me.roster.filter(tradeable)) for (const take of t.roster.filter(tradeable)) {
    if (vor(give) < vor(take) * 0.85) continue;
    const j = judge([give], [take], t);
    if (j.mine >= 2 && j.theirs >= -0.5) trades.push({ team: t, give, take, ...j });
  }
}
trades.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs));
const topTrades = [];
for (const tr of trades) {
  // at most 2 ideas per player I give up, so the list isn't one name 10 times
  if (topTrades.filter(x => x.give === tr.give).length < 2 && topTrades.length < 6) topTrades.push(tr);
}

// --- Adds / drops / trades around the league, last 3 weeks. Also my pending claims and trade
// offers, and other teams' offers and claims that didn't happen (ESPN's app hides those).
const moves = [], pendingTx = new Map(), intel = new Map();
const involvesMe = tx => tx.items.some(i => i.toTeamId === me.id || i.fromTeamId === me.id);
for (let wk = Math.max(1, week - 2); wk <= week; wk++) {
  const d = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${wk}`);
  for (const tx of d.transactions ?? []) {
    // old weeks keep stale "PENDING" rows; only this week's with isPending are real
    if (wk === week && tx.isPending && tx.status === 'PENDING' && ['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && involvesMe(tx)) pendingTx.set(tx.id, tx);
    else if (tx.status !== 'EXECUTED' && tx.status !== 'PENDING' && ['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && !involvesMe(tx)) intel.set(tx.id, tx);
    if (tx.status !== 'EXECUTED' || !['FREEAGENT', 'WAIVER', 'TRADE_ACCEPT'].includes(tx.type)) continue;
    for (const it of tx.items) if (['ADD', 'DROP', 'TRADE'].includes(it.type)) moves.push({ date: tx.processDate ?? tx.proposedDate, type: it.type, playerId: it.playerId, team: it.type === 'DROP' ? it.fromTeamId : it.toTeamId, from: it.fromTeamId });
  }
}
// Full player rows for everyone mentioned (rostered, free agents, or looked up)
const byId = new Map([...teams.flatMap(t => t.roster), ...allFa].map(p => [p.id, p]));
const txIds = [...pendingTx.values(), ...intel.values()].flatMap(tx => tx.items.map(i => i.playerId));
const missing = [...new Set([...moves.map(m => m.playerId), ...txIds])].filter(id => !byId.has(id));
if (missing.length) {
  const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: missing } } });
  for (const x of d.players) { names[x.player.id] = x.player.fullName; byId.set(x.player.id, { ...row(x.player, x.ratings), slot: 'FA' }); }
}
moves.sort((a, b) => b.date - a.date);

// My pending moves, judged with the same math as everything else
const pending = [...pendingTx.values()].map(tx => {
  const p = id => byId.get(id) ?? { id, name: names[id] ?? 'Unknown', pos: '?', teamName: '', avg: 0, proj: 0 };
  if (tx.type === 'WAIVER') {
    const add = tx.items.filter(i => i.type === 'ADD').map(i => p(i.playerId)), drop = tx.items.filter(i => i.type === 'DROP').map(i => p(i.playerId));
    const after = [...me.roster.filter(r => !drop.some(d => d.id === r.id)), ...add.map(a => ({ ...a, slot: 'Bench' }))];
    return { kind: 'waiver', add, drop, week: score(after, weekValue) - score(me.roster, weekValue), season: score(after, seasonValue) - score(me.roster, seasonValue) };
  }
  const them = teams.find(t => t.id === tx.items.map(i => (i.fromTeamId === me.id ? i.toTeamId : i.fromTeamId)).find(id => id !== me.id));
  const give = tx.items.filter(i => i.fromTeamId === me.id).map(i => me.roster.find(r => r.id === i.playerId) ?? p(i.playerId));
  const take = tx.items.filter(i => i.toTeamId === me.id).map(i => them.roster.find(r => r.id === i.playerId) ?? p(i.playerId));
  return { kind: 'trade', mineOffer: tx.teamId === me.id, them, give, take, ...judge(give, take, them) };
});

// --- Luck check: "all-play" record = your record if you'd played every team every week
const weekly = {}; // week -> { teamId: points }
for (const g of league.schedule ?? []) {
  if (g.matchupPeriodId >= week || !g.away) continue;
  const w = (weekly[g.matchupPeriodId] ??= {});
  w[g.home.teamId] = g.home.totalPoints; w[g.away.teamId] = g.away.totalPoints;
}
let apW = 0, apL = 0;
for (const w of Object.values(weekly)) for (const [id, pts] of Object.entries(w)) {
  if (+id === me.id) continue;
  if (w[me.id] > pts) apW++; else if (w[me.id] < pts) apL++;
}
const pfRank = [...teams].sort((a, b) => b.pf - a.pf).indexOf(me) + 1;
const apPct = apW / Math.max(1, apW + apL);
const realPct = me.w / Math.max(1, me.w + me.l);

// --- Schedule ahead: remaining opponents and how strong they've been
const gamesPlayed = Object.keys(weekly).length || 1;
const leagueAvg = teams.reduce((s, t) => s + t.pf, 0) / teams.length / gamesPlayed;
const ahead = (league.schedule ?? []).filter(g => g.matchupPeriodId > week && g.matchupPeriodId <= lastWeek && (g.home.teamId === me.id || g.away?.teamId === me.id))
  .sort((a, b) => a.matchupPeriodId - b.matchupPeriodId)
  .map(g => {
    const t = teams.find(x => x.id === (g.home.teamId === me.id ? g.away.teamId : g.home.teamId));
    const avg = t.pf / gamesPlayed;
    return { week: g.matchupPeriodId, t, avg, level: avg > leagueAvg + 5 ? 'hard' : avg < leagueAvg - 5 ? 'easy' : 'medium' };
  });

// --- Waiver competition: teams that pick before you and would also want the player
const rivalsFor = (add, value) => teams.filter(t => t !== me && t.waiver < me.waiver && score([...t.roster, add], value) - score(t.roster, value) >= 1);

// --- To-do list, most urgent first. Each item: [level, title, why]
const n = v => (v == null ? '-' : v.toFixed(1));
const todo = [];
for (const p of starters(me)) {
  if (p.bye === week) todo.push(['urgent', `Take ${p.name} out of your lineup`, `His team (${p.teamName}) has no game this week, so he'll score 0.`]);
  else if (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status)) todo.push(['urgent', `Take ${p.name} out of your lineup`, `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`]);
}
for (const [i, p] of benchIn.entries()) todo.push(['urgent', `Start ${p.name}`, `He's expected to score ${n(p.proj)}${sitOut[i] ? `, more than ${sitOut[i].name} (${n(weekValue(sitOut[i]))})` : ''}.`]);
for (const [i, s] of plan.entries()) {
  todo.push([i === 0 && s.kind === 'week' && sitOut.length > benchIn.length ? 'urgent' : 'week', `Pickup step ${i + 1}: add ${s.add.name}, drop ${s.drop.name}`,
    s.kind === 'week' ? `Adds about ${n(s.gain)} points to your score this week.` : `Makes your team about ${n(s.gain)} points per week better for the rest of the season.`]);
}
const irUsed = me.roster.filter(p => p.slot === 'IR').length;
const dateStr = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
for (const p of me.roster) {
  if (p.status === 'INJURY_RESERVE' && p.slot !== 'IR' && irUsed < (slotCounts[21] ?? 0)) todo.push(['week', `Move ${p.name} to your IR spot`, 'He\'s hurt long-term. Putting him in the IR spot frees a bench spot for free, without dropping him.']);
  if (p.inj?.season && !plan.some(s => s.drop === p)) todo.push(['week', `Drop ${p.name}`, `He's out for the season (${p.inj.type?.toLowerCase() ?? 'injury'}), so he'll never score for you again. Use his spot on someone who plays.`]);
  if (p.slot === 'IR' && p.inj?.back && p.inj.back - Date.now() < 8 * 864e5 && !p.inj.season) todo.push(['later', `${p.name} may be back around ${dateStr(p.inj.back)}`, 'When ESPN takes him off IR you have to move him to your bench, which needs an open bench spot. Plan who you\'d drop.']);
}
// Bye gaps, counting the players the plan adds (so a planned pickup that covers it hides the warning)
const afterPlan = [...me.roster.filter(p => !plan.some(s => s.drop === p)), ...plan.map(s => s.add)];
for (let wk = week + 1; wk <= lastWeek; wk++) {
  for (const pos of ['QB', 'TE', 'K', 'D/ST']) {
    if (afterPlan.some(p => p.pos === pos && !HURT.includes(p.status) && p.slot !== 'IR' && p.bye !== wk)) continue;
    const sub = fa[pos].filter(p => p.bye !== wk && !HURT.includes(p.status)).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
    todo.push(['later', `Week ${wk}: get a ${POS_NAME[pos].toLowerCase()}`, `None of yours play that week.${sub ? ` Best one available: ${sub.name} (${sub.teamName}, ${n(sub.avg)} points per game).` : ''}`]);
  }
}

// --- HTML
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => esc(name.split(' ').map(w => w[0]).join('').slice(0, 2));
const pic = p => p.id < 0 || p.pos === 'D/ST'
  ? `<span class="pic logo"><img loading="lazy" src="https://a.espncdn.com/i/teamlogos/nfl/500/${esc(p.team.toLowerCase())}.png" alt=""></span>`
  : `<span class="pic" data-i="${initials(p.name)}"><img loading="lazy" src="https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png" alt="" onerror="this.remove()"></span>`;
// Injury chip, with what's wrong and when he's expected back when ESPN knows
function chip(p) {
  const out = [];
  if (p.bye === week && !p.inj?.season) out.push('<span class="chip bad">No game this week</span>');
  const s = STATUS[p.status];
  if (p.inj?.season) out.push(`<span class="chip bad">Out for the season${p.inj.type ? ` (${esc(p.inj.type.toLowerCase())})` : ''}</span>`);
  else if (s) {
    const wks = p.inj?.back ? Math.ceil((p.inj.back - Date.now()) / (7 * 864e5)) : 0;
    const when = p.inj?.back && wks > 0 ? ` &middot; back ~${dateStr(p.inj.back)}${wks > 1 ? ` (${wks} wks)` : ''}` : '';
    out.push(`<span class="chip ${s[1]}">${s[0]}${p.inj?.type && p.inj.type !== 'Undisclosed' ? ` (${esc(p.inj.type.toLowerCase())})` : ''}${p.status === 'QUESTIONABLE' ? '' : when}</span>`);
  }
  return out.join(' ');
}
const ordinal = k => k + { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(k)];
// Tapping a player opens his detail sheet; every player shown is remembered so the sheet data
// (recent games, news, game time) is fetched for exactly those after the page is built.
// rank = how he compares at his position this season
const shown = new Map();
const player = (p, extra = '') => { shown.set(p.id, p); return `<div class="player" data-pid="${p.id}" role="button" tabindex="0">${pic(p)}<div class="who">
  <div class="name">${esc(p.name)} <span class="more">&rsaquo;</span></div>
  <div class="meta"><span class="pos pos-${p.pos.replace('/', '')}">${p.pos}</span> ${esc(p.teamName)}${p.bye ? ` &middot; bye wk ${p.bye}` : ''}</div>
  ${p.rank ? `<div class="rank">${ordinal(p.rank)}-best ${POS_NAME[p.pos]?.toLowerCase()} this season</div>` : ''}${chip(p)}${extra}</div></div>`; };
const big = (v, label, ceiling) => `<div class="big"><b>${n(v)}</b><small>${label}</small>${ceiling > v + 1 ? `<small class="up">up to ${Math.round(ceiling)}</small>` : ''}</div>`;

const myRank = [...teams].sort((a, b) => b.w - a.w || b.pf - a.pf).indexOf(me) + 1;
const standings = [...teams].sort((a, b) => b.w - a.w || b.pf - a.pf);
const cutWins = standings[playoffTeams - 1]?.w ?? 0;
const playoffLine = myRank <= playoffTeams ? `You're in a playoff spot. Top ${playoffTeams} make it.`
  : `Top ${playoffTeams} make the playoffs. ${cutWins - me.w <= 0 ? 'You have as many wins as the last playoff team, so it comes down to points.' : `You're ${cutWins - me.w} win${cutWins - me.w > 1 ? 's' : ''} behind.`}`;
const myProj = lineupProj(me);
const oppProj = opp ? lineupProj(opp) : 0;
const fixedProj = best.total;
const lineupRows = [...me.roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
const levelName = { urgent: 'Do now', week: 'This week', later: 'Plan ahead' };

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Fantasy"><meta name="theme-color" content="#0b1530">
<meta name="built" content="${Date.now()}">
<link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="manifest" href="manifest.json">
<title>${esc(me.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef1f7;--card:#fff;--fg:#121826;--muted:#667085;--line:#e4e7ee;--brand:#0b1530;--brand2:#1d3a8a;
--good:#12a150;--goodbg:#e3f6ea;--warn:#b26b00;--warnbg:#fff3d6;--bad:#d92d20;--badbg:#fde8e6;--chip:#f1f3f8}
@media (prefers-color-scheme:dark){:root{--bg:#0a0f1c;--card:#141b2d;--fg:#eef1f7;--muted:#98a2b3;--line:#232c42;
--good:#3ccf7a;--goodbg:#10301f;--warn:#f5b84a;--warnbg:#33270d;--bad:#ff6b5e;--badbg:#3a1714;--chip:#1c2540}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 48px}
header{background:linear-gradient(160deg,var(--brand),var(--brand2));color:#fff;padding:calc(env(safe-area-inset-top) + 20px) 0 56px}
header .wrap{padding-bottom:0}
.league{opacity:.7;font-size:13px;font-weight:500}
h1{font-size:26px;font-weight:800;margin:4px 0 2px;letter-spacing:-.02em}
.record{font-size:14px;opacity:.85}
.match{background:var(--card);color:var(--fg);border-radius:20px;padding:16px;margin:-40px 0 16px;box-shadow:0 8px 24px rgba(11,21,48,.12)}
.match h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.vs{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center}
.vs .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vs .p{font-weight:800;font-size:20px;text-align:right}
.bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--chip);overflow:hidden;margin-bottom:6px}.bar i{display:block;height:100%;border-radius:3px}
.verdict{margin-top:8px;font-size:14px}
nav{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{flex:none;padding:7px 14px;border-radius:999px;background:var(--card);color:var(--fg);text-decoration:none;font-weight:600;font-size:13px;border:1px solid var(--line)}
section{margin-top:22px}h2{font-size:20px;font-weight:800;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.card{background:var(--card);border-radius:16px;padding:14px;margin-bottom:10px;border:1px solid var(--line)}
.todo{display:flex;gap:12px;align-items:flex-start}
.todo .lvl{flex:none;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:6px;margin-top:2px}
.lvl.urgent{background:var(--badbg);color:var(--bad)}.lvl.week{background:var(--warnbg);color:var(--warn)}.lvl.later{background:var(--chip);color:var(--muted)}
.todo b{display:block;font-size:15px}.todo p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
.player{display:flex;gap:12px;align-items:center;min-width:0;flex:1}
.pic{flex:none;width:48px;height:48px;border-radius:50%;background:var(--chip);overflow:hidden;position:relative;display:grid;place-items:center}
.pic::before{content:attr(data-i);font-weight:700;color:var(--muted);font-size:14px}
.pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.pic.logo img{object-fit:contain;padding:6px}
.who{min-width:0}.name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pos{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:5px;color:#fff;margin-right:2px;vertical-align:1px}
.pos-QB{background:#e5484d}.pos-RB{background:#12a150}.pos-WR{background:#3e63dd}.pos-TE{background:#f76b15}.pos-K{background:#8e4ec6}.pos-DST{background:#646f82}
.chip{display:inline-block;margin-top:4px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px}
.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.row{display:flex;align-items:center;gap:10px}
.slot{flex:none;width:44px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase}
.big{flex:none;text-align:right}.big b{display:block;font-size:20px;font-weight:800;line-height:1.1}.big small{display:block;font-size:11px;color:var(--muted)}
.big small.up{color:var(--good);font-weight:600}
.rank{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-pid]{cursor:pointer;-webkit-tap-highlight-color:transparent}.more{color:var(--muted);font-weight:400}
#sheet{position:fixed;inset:0;z-index:20}.sheet-bg{position:absolute;inset:0;background:rgba(5,10,25,.55)}
.sheet-card{position:absolute;left:0;right:0;bottom:0;max-width:720px;margin:0 auto;max-height:88vh;background:var(--bg);border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;animation:up .22s ease-out}
@keyframes up{from{transform:translateY(40px);opacity:.4}}
.sheet-body{overflow-y:auto;padding:20px 16px calc(24px + env(safe-area-inset-bottom))}
.sheet-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border-radius:50%;border:0;background:var(--chip);color:var(--fg);font-size:22px;line-height:1;cursor:pointer;z-index:1}
.sh-top{display:flex;gap:14px;align-items:center;margin-bottom:14px;padding-right:40px}.sh-top .pic{width:64px;height:64px}
.sh-name{font-size:20px;font-weight:800}
.sh-q{border-radius:14px;padding:12px 14px;margin-bottom:10px;background:var(--card);border:1px solid var(--line)}
.sh-q small{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.sh-q b{display:block;font-size:16px;margin:2px 0}.sh-q span{font-size:13px;color:var(--muted)}
.sh-q.yes{border-left:4px solid var(--good)}.sh-q.no{border-left:4px solid var(--bad)}.sh-q.maybe{border-left:4px solid var(--warn)}
.bars{display:flex;gap:8px;align-items:flex-end;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.bars div{flex:1;text-align:center}.bars i{display:block;background:var(--brand2);border-radius:4px 4px 0 0;margin:0 auto 4px;width:70%}
.bars b{display:block;font-size:12.5px}.bars small{font-size:10.5px;color:var(--muted)}
a.news{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;color:var(--fg);text-decoration:none}
a.news b{display:block;font-size:14px;font-weight:600}a.news small{color:var(--muted);font-size:12px}
.wp{display:flex;align-items:baseline;gap:8px;margin-bottom:12px}.wp b{font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:1}
.live{display:inline-block;background:var(--badbg);color:var(--bad);font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:2px}
.stat{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat div{background:var(--chip);border-radius:12px;padding:10px}.stat b{display:block;font-size:20px;font-weight:800}.stat small{color:var(--muted);font-size:12px}
.lv{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase}.lv.hard{background:var(--badbg);color:var(--bad)}.lv.medium{background:var(--warnbg);color:var(--warn)}.lv.easy{background:var(--goodbg);color:var(--good)}
.list .card{margin-bottom:0;border-radius:0;border-bottom:none}.list .card:first-child{border-radius:16px 16px 0 0}.list .card:last-child{border-radius:0 0 16px 16px;border-bottom:1px solid var(--line)}
.list .card:only-child{border-radius:16px}
.group{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 8px}
.swap{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.row{min-width:0}
.arrow{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase}
.arrow::after{content:"";flex:1;height:1px;background:var(--line)}
.gain{display:inline-block;background:var(--goodbg);color:var(--good);font-weight:800;padding:4px 10px;border-radius:8px;font-size:14px}
.why{color:var(--muted);font-size:13.5px;margin:10px 0 0}
.tag{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:9px 4px;border-bottom:1px solid var(--line)}
td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}tr.me td{font-weight:800;color:var(--fg)}
tr.cut td{border-bottom:2px dashed var(--good)}
details summary{cursor:pointer;font-weight:700;list-style:none;display:flex;justify-content:space-between}
details summary::after{content:"+";color:var(--muted);font-weight:400;font-size:20px;line-height:1}details[open] summary::after{content:"\\2212"}
details[open] summary{margin-bottom:8px}
dl{margin:0}dt{font-weight:700;margin-top:12px}dd{margin:2px 0 0;color:var(--muted);font-size:14px}
.empty{color:var(--muted);text-align:center;padding:18px}
.worder{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}.worder span{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--chip);color:var(--muted)}
.worder span.ahead{color:var(--fg)}.worder span.me{background:var(--brand2);color:#fff;font-weight:700}
.vhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
[class^=verdict-]{flex:none;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px}
.verdict-good{background:var(--goodbg);color:var(--good)}.verdict-bad{background:var(--badbg);color:var(--bad)}.verdict-meh{background:var(--chip);color:var(--muted)}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:32px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
#refresh{flex:none;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 12px;font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer}
#refresh:active{background:rgba(255,255,255,.28)}#refresh.spin span{display:inline-block;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>

<header><div class="wrap">
  <div class="top"><div class="league">${esc(league.settings.name)} &middot; Week ${week} &middot; <span id="ago">just updated</span></div>
  <button id="refresh" type="button"><span>&#8635;</span> Refresh</button></div>
  <h1>${esc(me.name)}</h1>
  <div class="record">${me.w}-${me.l} record &middot; ${ordinal(myRank)} of ${teams.length}</div>
</div></header>

<div class="wrap">
${opp ? (() => {
  // Once games start, ESPN's live numbers replace the pre-game projection
  const live = mySide.totalPointsLive > 0 || oppSide.totalPointsLive > 0;
  const [a, b] = live ? [mySide.totalProjectedPointsLive, oppSide.totalProjectedPointsLive] : [myProj, oppProj];
  const wp = Math.round((mySide.winProbability ?? 0) * 100);
  return `<div class="match"><h3>This week vs ${esc(opp.name)}${live ? '<span class="live">LIVE</span>' : ''}</h3>
  <div class="wp"><b style="color:${wp >= 50 ? 'var(--good)' : 'var(--bad)'}">${wp}%</b><span>chance you win <span class="tag">(ESPN's estimate)</span></span></div>
  ${live ? `<div class="tag" style="margin-bottom:8px">Score right now: <b>${n(mySide.totalPointsLive)}</b> to <b>${n(oppSide.totalPointsLive)}</b>. Final guess below.</div>` : ''}
  <div class="vs">
  <div class="t">You</div><div class="p">${n(a)}</div><div class="bar"><i style="width:${Math.min(100, a / Math.max(a, b, 1) * 100)}%;background:var(--brand2)"></i></div>
  <div class="t">${esc(opp.name)}</div><div class="p">${n(b)}</div><div class="bar"><i style="width:${Math.min(100, b / Math.max(a, b, 1) * 100)}%;background:var(--muted)"></i></div>
</div><div class="verdict">${a >= b ? `<b style="color:var(--good)">You're expected to win</b> by ${n(a - b)} points.` : `<b style="color:var(--bad)">You're expected to lose</b> by ${n(b - a)} points.`}
${!live && fixedProj + weekPlanGain > myProj + 0.5 ? ` Doing the to-do list below gets you to about <b>${n(fixedProj + weekPlanGain)}</b>.` : ''}</div>
<div class="tag" style="margin-top:6px">${esc(playoffLine)}</div></div>`;
})() : ''}

<nav><a href="#todo">To-do</a><a href="#lineup">My team</a><a href="#pickups">Pickups</a><a href="#pending">Pending</a><a href="#trades">Trades</a><a href="#season">Season</a><a href="#league">League</a><a href="#help">How it works</a></nav>

<section id="todo"><h2>To-do list</h2><p class="sub">Most important first. Do these in the ESPN app.</p>
${todo.length ? todo.map(([lvl, title, why]) => `<div class="card todo"><span class="lvl ${lvl}">${levelName[lvl]}</span><div><b>${esc(title)}</b><p>${esc(why)}</p></div></div>`).join('') : '<div class="card empty">You\'re all set this week.</div>'}
</section>

<section id="lineup"><h2>My team</h2><p class="sub">Big number = points ESPN expects him to score this week. Green "up to" = his score if he has a great game. Tap any player to see if he plays, when, his last games and news.</p>
${[['Starting', p => p.slot !== 'Bench' && p.slot !== 'IR'], ['Bench', p => p.slot === 'Bench'], ['Injured reserve', p => p.slot === 'IR']].map(([label, f]) => {
  const ps = lineupRows.filter(f);
  return ps.length ? `<div class="group">${label}</div><div class="list">${ps.map(p => `<div class="card row"><span class="slot">${p.slot === 'Bench' || p.slot === 'IR' ? '' : p.slot}</span>${player(p)}${big(weekValue(p), 'expected', weekValue(p) > 0 ? p.ceiling : null)}</div>`).join('')}</div>` : '';
}).join('')}
</section>

<section id="pickups"><h2>Pickup plan</h2><p class="sub">Do these in order. Each step swaps one player for one free player nobody in your league has. In ESPN: Players &rarr; find him &rarr; Add.</p>
<div class="card"><div class="vhead"><span class="group" style="margin:0">Waiver order</span><span class="verdict-meh">You pick ${ordinal(me.waiver)} of ${teams.length}</span></div>
<div class="worder">${[...teams].sort((a, b) => a.waiver - b.waiver).map(t => `<span class="${t === me ? 'me' : t.waiver < me.waiver ? 'ahead' : ''}">${t.waiver}. ${esc(t.name)}</span>`).join('')}</div>
<p class="tag" style="margin-bottom:0">When two teams claim the same player, the one higher on this list gets him. ${me.waiver > 1 ? `${me.waiver - 1} team${me.waiver > 2 ? 's' : ''} pick before you.` : 'You pick first.'} Free agents (not on waivers) go to whoever adds them first.</p></div>
${plan.length ? plan.map((s, i) => { const wk = s.kind === 'week'; return `<div class="card">
  <div class="group" style="margin:0 0 10px">Step ${i + 1} &middot; ${wk ? 'helps this week' : 'helps rest of season'}</div>
  <div class="row">${player(s.add)}${big(wk ? s.add.proj : s.add.avg, wk ? 'expected' : 'per game')}</div>
  <p class="why"><span class="gain">+${n(s.gain)}</span> ${wk ? 'more points this week' : 'more points per week'}. To make room, drop <b>${esc(s.drop.name)}</b> (${n(wk ? weekValue(s.drop) : s.drop.avg)} ${wk ? 'expected' : 'per game'}).<br>
  <span class="tag">${s.add.wa ? 'On waivers: your claim goes through in about a day.' : 'Free agent: yours right away.'}</span>
  ${s.add.wa ? (() => { const r = rivalsFor(s.add, wk ? weekValue : seasonValue); return r.length
    ? `<br><span class="tag" style="color:var(--warn)">${r.length} team${r.length > 1 ? 's' : ''} that pick${r.length > 1 ? '' : 's'} before you could use him too: ${r.slice(0, 3).map(t => esc(t.name)).join(', ')}${r.length > 3 ? '&hellip;' : ''}.</span>`
    : '<br><span class="tag" style="color:var(--good)">No team that picks before you needs him, so you\'ll probably get him.</span>'; })() : ''}
  ${s.alts.length ? `<br><span class="tag">If someone else gets him first, take ${s.alts.map(a => `<b>${esc(a.add.name)}</b> (${n(wk ? a.add.proj : a.add.avg)})`).join(' or ')} instead.</span>` : ''}</p></div>`; }).join('')
  : '<div class="card empty">Nobody out there beats what you have.</div>'}
${trending.length ? `<div class="group">Trending: being picked up fast in other leagues</div><div class="list">${trending.slice(0, 5).map(p => `<div class="card row">${player(p)}${big(p.avg, 'per game')}</div>`).join('')}</div>
<p class="tag">Often means news broke (an injury ahead of him, a bigger role). Not always worth it for you, but worth a look.</p>` : ''}
</section>

<section id="pending"><h2>Your pending moves</h2><p class="sub">Waiver claims and trade offers that haven't gone through yet, checked with the same math as everything else.</p>
${pending.length ? pending.map(m => {
  if (m.kind === 'waiver') {
    const v = m.week >= 1 || m.season >= 1 ? ['good', 'Good claim'] : m.week <= -1 || m.season <= -1 ? ['bad', 'Bad claim, cancel it'] : ['meh', 'Barely matters'];
    return `<div class="card"><div class="vhead"><span class="tag">Waiver claim</span><span class="verdict-${v[0]}">${v[1]}</span></div>
    <div class="swap">${m.add.map(p => `<div class="row">${player(p)}${big(p.avg, 'per game')}</div>`).join('')}<div class="arrow">drop</div>${m.drop.map(p => `<div class="row">${player(p)}${big(p.avg, 'per game')}</div>`).join('')}</div>
    <p class="why">This week: <b>${m.week >= 0 ? '+' : ''}${n(m.week)}</b> points. Rest of season: <b>${m.season >= 0 ? '+' : ''}${n(m.season)}</b> per week.</p></div>`;
  }
  const v = m.mine >= 1 ? ['good', m.mineOffer ? 'Good offer' : 'Accept'] : m.mine <= -1 ? ['bad', m.mineOffer ? 'Bad for you, cancel it' : 'Decline'] : ['meh', 'About even'];
  const lost = [...new Set(m.give.map(p => p.pos))].map(pos => { const s = starterAt(m.after, pos); return s && !m.give.includes(s) ? `your ${POS_NAME[pos]?.toLowerCase()} would be ${esc(s.name)} (${n(s.avg)})` : `you'd have no ${POS_NAME[pos]?.toLowerCase()}`; });
  return `<div class="card"><div class="vhead"><span class="tag">${m.mineOffer ? 'You offered' : 'Offered to you by'} <b>${esc(m.them.name)}</b></span><span class="verdict-${v[0]}">${v[1]}</span></div>
  <div class="swap"><div class="arrow">you give</div>${m.give.map(p => `<div class="row">${player(p)}${big(p.avg, 'per game')}</div>`).join('')}
  <div class="arrow">you get</div>${m.take.map(p => `<div class="row">${player(p)}${big(p.avg, 'per game')}</div>`).join('')}</div>
  <p class="why">Rest of season: <b>${m.mine >= 0 ? '+' : ''}${n(m.mine)}</b> points per week for you, ${m.theirs >= 0 ? '+' : ''}${n(m.theirs)} for them. This week: ${m.mineWeek >= 0 ? '+' : ''}${n(m.mineWeek)}.
  ${m.mineWeek > 2 && m.mine < -1 ? '<br><b>Trap:</b> it only helps this week (your players are on bye or hurt). After that you\'re worse off.' : ''}
  ${lost.length ? `<br>After the trade, ${lost.join('; ')}.` : ''}
  ${m.vorTake < m.vorGive * 0.7 ? '<br>You\'re giving up more real value than you get back.' : m.vorTake > m.vorGive * 1.3 ? '<br>You get more real value than you give.' : ''}</p></div>`;
}).join('') : '<div class="card empty">Nothing pending right now.</div>'}
</section>

<section id="trades"><h2>Trade ideas</h2><p class="sub">Swaps worth 2+ points a week to you that the other team could see as fair. "Value" counts how hard a player is to replace, so stars at scarce spots like tight end count extra. Offer them in ESPN under Trade.</p>
${topTrades.length ? topTrades.map(t => { const s = starterAt(t.after, t.give.pos); return `<div class="card"><div class="tag" style="margin-bottom:8px">with <b>${esc(t.team.name)}</b></div><div class="swap">
  <div class="row">${player(t.give, '')}${big(t.give.avg, 'per game')}</div>
  <div class="arrow">for</div>
  <div class="row">${player(t.take, '')}${big(t.take.avg, 'per game')}</div></div>
  <p class="why"><span class="gain">+${n(t.mine)}</span> points per week for you. You get a ${POS_NAME[t.take.pos].toLowerCase()}; they get a ${POS_NAME[t.give.pos].toLowerCase()}${t.theirs > 0.2 ? `, which helps them too (+${n(t.theirs)})` : ''}.
  <br>Your ${POS_NAME[t.give.pos].toLowerCase()} after: ${s ? `${esc(s.name)} (${n(s.avg)} per game)` : 'nobody, so you\'d need to pick one up'}.</p></div>`; }).join('') : '<div class="card empty">No trades right now that clearly help you and look fair to the other team.</div>'}
</section>

<section id="season"><h2>Season outlook</h2><p class="sub">How you've really played, and who's coming up.</p>
<div class="card"><div class="group" style="margin:0 0 10px">Luck check</div><div class="stat">
  <div><b>${me.w}-${me.l}</b><small>your real record</small></div>
  <div><b>${apW}-${apL}</b><small>if you played every team every week</small></div>
  <div><b>${ordinal(pfRank)}</b><small>most points of ${teams.length} teams</small></div>
  <div><b>${n(me.pf / gamesPlayed)}</b><small>your points per week (league: ${n(leagueAvg)})</small></div></div>
  <p class="why">${apPct > realPct + 0.08 ? 'You\'ve been <b>unlucky</b>: you\'ve played better than your record shows, so wins should come.'
    : apPct < realPct - 0.08 ? 'You\'ve been <b>lucky</b>: your record is better than your points. Keep improving the lineup.'
    : 'Your record matches how you\'ve played.'}${pfRank > teams.length / 2 ? ' Your team scores less than most, so pickups and trades matter.' : ''}</p></div>
${ahead.length ? `<div class="card"><div class="group" style="margin:0 0 4px">Your schedule ahead</div><table>
${ahead.map(g => `<tr><td class="num" style="text-align:left">Wk ${g.week}</td><td>${esc(g.t.name)} <span class="tag">${g.t.w}-${g.t.l}</span></td><td class="num">${n(g.avg)}/wk</td><td style="text-align:right"><span class="lv ${g.level}">${g.level}</span></td></tr>`).join('')}</table>
<p class="tag">Hard = they score a lot more than average. Easy weeks are the ones you should win.</p></div>` : ''}
</section>

<section id="league"><h2>League</h2><p class="sub">Dashed line = playoff cutoff. Waiver # = who gets first pick of new players (1 goes first).</p>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">W-L</td><td class="num">Points</td><td class="num">Waiver #</td></tr>
${standings.map((t, i) => `<tr class="${t === me ? 'me' : ''} ${i + 1 === playoffTeams ? 'cut' : ''}"><td class="num" style="text-align:left">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.w}-${t.l}</td><td class="num">${Math.round(t.pf)}</td><td class="num">${t.waiver}</td></tr>`).join('')}</table></div>
${intel.size ? `<div class="card"><details open><summary>Behind the scenes: offers and claims that didn't happen</summary>
<p class="tag" style="margin-top:0">The ESPN app doesn't show these. A team that offered a player in a trade is shopping him; a team that tried to claim someone needs that position.</p><table>
${[...intel.values()].sort((a, b) => b.proposedDate - a.proposedDate).slice(0, 20).map(tx => {
  const nm = id => esc(byId.get(id)?.name ?? names[id] ?? 'someone');
  const date = new Date(tx.proposedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (tx.type === 'WAIVER') {
    const add = tx.items.filter(i => i.type === 'ADD').map(i => nm(i.playerId)).join(', '), drop = tx.items.filter(i => i.type === 'DROP').map(i => nm(i.playerId)).join(', ');
    return `<tr><td class="num" style="text-align:left">${date}</td><td><b>${esc(teamName[tx.teamId] ?? '')}</b> tried to claim ${add}${drop ? ` (dropping ${drop})` : ''} <span class="tag">(${tx.status === 'CANCELED' ? 'they canceled it' : 'didn\'t go through'})</span></td></tr>`;
  }
  const other = tx.items.map(i => (i.fromTeamId === tx.teamId ? i.toTeamId : i.fromTeamId)).find(id => id !== tx.teamId);
  const gave = tx.items.filter(i => i.fromTeamId === tx.teamId).map(i => nm(i.playerId)).join(', '), got = tx.items.filter(i => i.toTeamId === tx.teamId).map(i => nm(i.playerId)).join(', ');
  return `<tr><td class="num" style="text-align:left">${date}</td><td><b>${esc(teamName[tx.teamId] ?? '')}</b> offered ${gave} to ${esc(teamName[other] ?? '')} for ${got} <span class="tag">(${tx.status.toLowerCase().replace(/_/g, ' ')})</span></td></tr>`;
}).join('')}</table></details></div>` : ''}
<div class="card"><details><summary>Recent moves around the league</summary><table>
${moves.slice(0, 30).map(m => `<tr><td class="num" style="text-align:left">${new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td>${esc(teamName[m.team] ?? '')}</td><td>${m.type === 'ADD' ? '<b style="color:var(--good)">added</b>' : m.type === 'DROP' ? '<span style="color:var(--bad)">dropped</span>' : `traded with ${esc(teamName[m.from])}`} ${esc(names[m.playerId] ?? '')}</td></tr>`).join('')}</table></details></div>
</section>

<section id="help"><h2>How it works</h2><p class="sub">Football basics, just what you need for fantasy.</p>
<div class="card"><dl>
<dt>How you win</dt><dd>Every week you play one other team. Your starters score points from what they do in real NFL games. Higher total wins. Bench players don't count.</dd>
<dt>Positions</dt><dd><span class="pos pos-QB">QB</span> Quarterback: throws the ball. Usually your highest scorer.<br>
<span class="pos pos-RB">RB</span> Running back: runs with the ball.<br>
<span class="pos pos-WR">WR</span> Wide receiver: catches passes.<br>
<span class="pos pos-TE">TE</span> Tight end: blocks and catches passes.<br>
<span class="pos pos-K">K</span> Kicker: kicks field goals and extra points.<br>
<span class="pos pos-DST">D/ST</span> Defense: a whole team's defense. Scores for sacks, turnovers and holding the other team to few points.<br>
<b>FLEX</b>: one extra spot that can be an RB, WR or TE.</dd>
<dt>Expected points</dt><dd>ESPN's guess for how many points a player will score this week. It's a guess, not a promise, but it's the best simple way to decide who to start.</dd>
<dt>"Up to" number</dt><dd>What he'd score if he has a great game. A big gap between expected and "up to" means he's boom-or-bust.</dd>
<dt>Win chance</dt><dd>ESPN's estimate of how likely you are to win this week. During games it updates with the live score.</dd>
<dt>Points per game</dt><dd>How many points he's actually scored each week on average this season. Better for judging who's good long-term.</dd>
<dt>Bye week</dt><dd>Each NFL team gets one week off. A player on bye scores 0, so never start him that week.</dd>
<dt>Injury tags</dt><dd><b>Might not play</b> (questionable): about 50/50, usually plays. <b>Probably won't play</b> (doubtful). <b>Out</b>: won't play. <b>IR</b>: hurt for weeks; move him to your IR spot so he doesn't take up a bench spot.</dd>
<dt>Waivers vs free agents</dt><dd>Recently dropped players go on <b>waivers</b> for about a day. Everyone can claim them, and the team with the best waiver # gets him. After that he's a <b>free agent</b>: first to add him gets him.</dd>
<dt>Scoring in this league</dt><dd>Half-point PPR: players get half a point for every catch, on top of points for yards and touchdowns.</dd>
<dt>Where these tips come from</dt><dd>This page does the math on ESPN's projections and season stats. It doesn't know about news ESPN hasn't added yet, so for big decisions it's worth a second opinion.</dd>
</dl></div></section>

<footer>Updated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET &middot; new data about every 5 minutes &middot; this page checks for it every minute</footer>
</div>
<div id="sheet" hidden><div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true"><button class="sheet-x" type="button" data-close aria-label="Close">&times;</button><div class="sheet-body"></div></div></div>
<script type="application/json" id="pdata">__PDATA__</script>
<script>
// Load the newest build when there is one: on the button, every minute, and when you come back to the app.
// GitHub caches pages ~10 min, so a timestamped URL is used to skip the cache.
const built = +document.querySelector('meta[name=built]').content;
const btn = document.getElementById('refresh'), ago = document.getElementById('ago');
const fresh = () => location.pathname + '?t=' + Date.now();
// GitHub starts a run on each 5-minute mark and it takes ~90s to publish, so the next
// update is the mark after the one that made this build, plus 90s. GitHub can run late; then "any moment".
const STEP = 5 * 60000, PUBLISH = 90000;
const nextAt = Math.floor(built / STEP) * STEP + STEP + PUBLISH;
let lastCheck = 0;
function showAgo() {
  const m = Math.round((Date.now() - built) / 60000);
  const left = Math.ceil((nextAt - Date.now()) / 1000);
  const next = left > 0 ? 'next in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'next any moment';
  ago.textContent = (m < 1 ? 'updated just now' : m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + ' hr ago') + ' \\u00b7 ' + next;
  // once the countdown is over, look for the new version every 15s instead of every minute
  if (left <= 0 && !document.hidden && Date.now() - lastCheck > 15000) { lastCheck = Date.now(); check(false); }
}
async function check(clicked) {
  if (clicked) btn.classList.add('spin');
  try {
    const html = await (await fetch(fresh(), { cache: 'no-store' })).text();
    const next = +(html.match(/name="built" content="(\\d+)"/) || [])[1];
    if (next > built) {
      try { sessionStorage.setItem('scroll', scrollY); } catch {}
      return location.replace(fresh() + location.hash);
    }
    if (clicked) btn.innerHTML = '&#10003; Up to date';
  } catch { if (clicked) btn.textContent = 'Offline'; }
  btn.classList.remove('spin');
  if (clicked) setTimeout(() => (btn.innerHTML = '<span>&#8635;</span> Refresh'), 2500);
}
try { const y = sessionStorage.getItem('scroll'); if (y) { sessionStorage.removeItem('scroll'); scrollTo(0, +y); } } catch {}
btn.onclick = () => check(true);
showAgo(); setInterval(showAgo, 1000);
document.addEventListener('visibilitychange', () => !document.hidden && check(false));

// Player sheet: tap any player to see, in plain English, if he plays, when, how he's been doing, and news.
const P = JSON.parse(document.getElementById('pdata').textContent);
const sheet = document.getElementById('sheet'), body = sheet.querySelector('.sheet-body');
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function render(p) {
  const max = Math.max(1, ...p.games.map(g => g.pts ?? 0));
  return '<div class="sh-top">' + (document.querySelector('[data-pid="' + p.id + '"] .pic')?.outerHTML ?? '') +
    '<div><div class="sh-name">' + e(p.name) + '</div><div class="meta">' + e(p.posName) + ' &middot; ' + e(p.teamName) + '</div><div class="tag">' + e(p.owner) + '</div></div></div>' +
    '<div class="sh-q ' + p.play[0] + '"><small>Will he play this week?</small><b>' + e(p.play[1]) + '</b>' + (p.game ? '<span>' + e(p.game) + '</span>' : '') + '</div>' +
    (p.advice ? '<div class="sh-q ' + p.advice[0] + '"><small>What to do</small><b>' + e(p.advice[1]) + '</b></div>' : '') +
    '<div class="stat">' +
      '<div><b>' + e(p.proj) + '</b><small>expected this week' + (p.ceiling ? ' (up to ' + e(p.ceiling) + ')' : '') + '</small></div>' +
      '<div><b>' + e(p.avg) + '</b><small>points per game this season</small></div>' +
      '<div><b>' + e(p.rank) + '</b><small>rank at his position</small></div>' +
      '<div><b>' + e(p.started) + '</b><small>of ESPN managers start him</small></div></div>' +
    (p.trend ? '<p class="why"><b>' + e(p.trend) + '</b></p>' : '') +
    (p.games.length ? '<div class="group">Last games (fantasy points)</div><div class="bars">' + p.games.map(g =>
      '<div><i style="height:' + (g.pts == null ? 0 : Math.max(4, g.pts / max * 64)) + 'px"></i><b>' + (g.pts == null ? e(g.note) : g.pts.toFixed(1)) + '</b><small>wk ' + g.wk + '</small></div>').join('') + '</div>' : '') +
    '<div class="group">Bye week</div><p class="why" style="margin:0">' + e(p.byeText) + '</p>' +
    (p.news.length ? '<div class="group">Latest news</div>' + p.news.map(x => '<a class="news" href="' + e(x.url) + '" target="_blank" rel="noopener"><b>' + e(x.h) + '</b><small>' + e(x.when) + ' &rsaquo;</small></a>').join('') : '') +
    (p.id > 0 ? '<a class="news" href="https://www.espn.com/nfl/player/_/id/' + p.id + '" target="_blank" rel="noopener"><b>Full stats and news on ESPN</b><small>opens ESPN &rsaquo;</small></a>' : '');
}
function openSheet(id) { const p = P[id]; if (!p) return; body.innerHTML = render(p); sheet.hidden = false; body.scrollTop = 0; document.body.style.overflow = 'hidden'; }
function closeSheet() { sheet.hidden = true; document.body.style.overflow = ''; }
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-close]')) return closeSheet();
  const el = !ev.target.closest('.sheet-body') && ev.target.closest('[data-pid]');
  if (el) openSheet(el.dataset.pid);
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') closeSheet();
  if (ev.key === 'Enter' && ev.target.dataset?.pid) openSheet(ev.target.dataset.pid);
});
</script></body></html>`;

// --- Player sheet data, for every player the page shows
const ids = [...shown.keys()];
const card = new Map();
for (let i = 0; i < ids.length; i += 50) {
  const d = await get(`${LEAGUE}?view=kona_playercard&scoringPeriodId=${week}`, {
    players: { filterIds: { value: ids.slice(i, i + 50) }, filterStatsForTopScoringPeriodIds: { value: week, additionalValue: [`00${SEASON}`] } },
  });
  for (const x of d.players) card.set(x.player.id, x.player);
}
const news = new Map(await Promise.all(ids.filter(id => id > 0).map(async id => {
  try {
    const r = await fetch(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=6&playerId=${id}`);
    const last = (shown.get(id).name.split(' ').filter(w => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop() ?? '').toLowerCase();
    // player notes (his name in the headline) before general articles that only mention him
    const items = ((await r.json()).feed ?? []).filter(x => x.headline && (x.headline + ' ' + (x.story ?? '')).toLowerCase().includes(last))
      .sort((a, b) => b.headline.toLowerCase().includes(last) - a.headline.toLowerCase().includes(last)).slice(0, 2);
    return [id, items.map(x => ({ h: x.headline, url: x.links?.web?.href || `https://www.espn.com/nfl/player/_/id/${id}`, when: new Date(x.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))];
  } catch { return [id, []]; }
})));
const owner = new Map(teams.flatMap(t => t.roster.map(p => [p.id, t])));
const gameText = p => {
  const g = pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0];
  if (!g) return '';
  const home = g.homeProTeamId === p.proTeamId;
  return `${home ? 'Home vs' : 'Away at'} ${proName[home ? g.awayProTeamId : g.homeProTeamId]}, ${new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })} ET. Your lineup locks for him when that game starts.`;
};
const pdata = {};
for (const [id, p] of shown) {
  const c = card.get(id), inj = p.inj ?? (c?.injuryDetails && { type: c.injuryDetails.type, season: c.injuryDetails.outForSeason, back: c.injuryDetails.expectedReturnDate && new Date(c.injuryDetails.expectedReturnDate[0], c.injuryDetails.expectedReturnDate[1] - 1, c.injuryDetails.expectedReturnDate[2]) });
  const hurtType = inj?.type && inj.type !== 'Undisclosed' ? ` (${inj.type.toLowerCase()})` : '';
  const back = inj?.back && inj.back > Date.now() ? ` Expected back around ${dateStr(inj.back)}.` : '';
  const play = inj?.season ? ['no', `No. He's out for the season${hurtType}.`]
    : p.bye === week ? ['no', 'No. His team has no game this week (bye week).']
    : ['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(p.status) ? ['no', `No. ${STATUS[p.status][0]}${hurtType}.${back}`]
    : p.status === 'DOUBTFUL' ? ['no', `Probably not${hurtType}. Plan to bench him.`]
    : p.status === 'QUESTIONABLE' ? ['maybe', `Maybe, about 50/50${hurtType}. Teams say who's out about 90 minutes before kickoff, so check then.`]
    : ['yes', 'Yes, he\'s expected to play.'];
  const t = owner.get(id), mine = t === me;
  const advice = !mine ? null : inj?.season ? ['no', 'Drop him. He won\'t play again this season, so he\'s wasting a roster spot.'] : p.slot === 'IR' ? ['maybe', 'He\'s in your IR spot, so he doesn\'t use a bench spot. Leave him there until he\'s healthy.']
    : bestIds.has(id) ? (p.slot === 'Bench' ? ['yes', 'Start him. He\'s one of your best options this week.'] : ['yes', 'Keep him in your lineup.'])
    : p.slot !== 'Bench' ? ['no', 'Bench him. Someone on your team is expected to score more.'] : ['maybe', 'Keep him on the bench this week.'];
  const games = [];
  for (let wk = Math.max(1, week - 5); wk < week; wk++) {
    const s = c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 0 && x.statSplitTypeId === 1 && x.scoringPeriodId === wk);
    games.push({ wk, pts: s?.appliedTotal ?? null, note: p.bye === wk ? 'bye' : '–' });
  }
  const played = games.filter(g => g.pts != null).slice(-3);
  const recent = played.length ? played.reduce((s, g) => s + g.pts, 0) / played.length : null;
  const trend = recent == null || !p.avg || played.length < 2 ? '' : recent > p.avg * 1.25 ? `Hot: ${n(recent)} per game over his last ${played.length} games, better than his season average.`
    : recent < p.avg * 0.75 ? `Cold: ${n(recent)} per game over his last ${played.length} games, worse than his season average.` : '';
  pdata[id] = {
    id, name: p.name, posName: POS_NAME[p.pos] ?? p.pos, teamName: p.teamName,
    owner: mine ? 'On your team' : t ? `On ${t.name}` : 'Free: nobody in your league has him',
    play, advice, game: p.bye === week ? '' : gameText(p), proj: n(p.proj), ceiling: p.ceiling > (p.proj ?? 0) + 1 ? Math.round(p.ceiling) : null,
    avg: n(p.avg), rank: p.rank ? `${ordinal(p.rank)}` : '-', started: c?.ownership?.percentStarted != null ? `${Math.round(c.ownership.percentStarted)}%` : '-',
    trend, games, news: news.get(id) ?? [],
    byeText: !p.bye ? 'No bye listed.' : p.bye < week ? `Week ${p.bye}, already done. He plays every week from now on.` : p.bye === week ? 'This week. He won\'t play.' : `Week ${p.bye}. He won't play that week, so you'll need someone else.`,
  };
  // a defense is a whole team: "they", not "he"
  if (p.pos === 'D/ST') for (const k of ['play', 'advice']) if (pdata[id][k]) pdata[id][k] = [pdata[id][k][0], pdata[id][k][1].replace(/\bhe's\b/gi, 'they\'re').replace(/\bHe\b/g, 'They').replace(/\bhim\b/g, 'them')];
  if (p.pos === 'D/ST') pdata[id].byeText = pdata[id].byeText.replace(/He plays/, 'They play').replace(/He won't/g, 'They won\'t').replace(/he won't/g, 'they won\'t');
}
html = html.replace('__PDATA__', JSON.stringify(pdata).replace(/</g, '\\u003c'));

fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), html);
// App icons (Home Screen, browser tab) and the manifest that names the installed app
fs.cpSync(path.join(dir, 'icons'), path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'manifest.json'), JSON.stringify({
  name: me.name, short_name: 'Fantasy', start_url: '.', display: 'standalone', background_color: '#0b1530', theme_color: '#0b1530',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}));
console.log(`Wrote site/index.html for ${me.name}, week ${week}. vs ${opp?.name}: ${n(myProj)}-${n(oppProj)}`);
todo.forEach(([l, t]) => console.log(`[${l}] ${t}`));
