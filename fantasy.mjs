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
const SLOT = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR', 23: 'FLEX' };
const SLOT_POS = { 0: ['QB'], 2: ['RB'], 3: ['RB', 'WR'], 4: ['WR'], 5: ['WR', 'TE'], 6: ['TE'], 7: ['QB', 'RB', 'WR', 'TE'], 16: ['D/ST'], 17: ['K'], 23: ['RB', 'WR', 'TE'] };
const FA_SLOT = { QB: 0, RB: 2, WR: 4, TE: 6, K: 17, 'D/ST': 16 };
const HURT = ['OUT', 'INJURY_RESERVE', 'SUSPENSION'];

const league = await get(`${LEAGUE}?view=mSettings&view=mTeam&view=mRoster&view=mStatus`);
const week = league.status?.currentMatchupPeriod ?? league.scoringPeriodId;
const pro = (await get(`${BASE}?view=proTeamSchedules_wl`)).settings.proTeams;
const proAbbr = Object.fromEntries(pro.map(t => [t.id, t.abbrev]));
const proBye = Object.fromEntries(pro.map(t => [t.id, t.byeWeek]));
const slotCounts = league.settings.rosterSettings.lineupSlotCounts;

// statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season, 1 = one week.
// Stats also include last season's totals, so filter by seasonId.
const stat = (p, src, split) => p.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === split && (split === 0 || s.scoringPeriodId === week));

function row(p) {
  const season = stat(p, 0, 0);
  return {
    id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] ?? '?',
    team: proAbbr[p.proTeamId] ?? 'FA', bye: proBye[p.proTeamId] ?? null,
    status: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    pts: season?.appliedTotal ?? null, avg: season?.appliedAverage ?? null, proj: stat(p, 1, 1)?.appliedTotal ?? null,
    owned: p.ownership?.percentOwned ?? null,
  };
}

const names = {};
const teams = league.teams.map(t => {
  const roster = t.roster.entries.map(e => {
    const p = e.playerPoolEntry.player;
    names[p.id] = p.fullName;
    return { ...row(p), slot: SLOT[e.lineupSlotId] ?? e.lineupSlotId };
  });
  const r = t.record.overall;
  return { id: t.id, name: t.name.trim(), owners: t.owners, w: r.wins, l: r.losses, pf: r.pointsFor, pa: r.pointsAgainst, waiver: t.waiverRank, roster };
});
const teamName = Object.fromEntries(teams.map(t => [t.id, t.name]));
const me = teams.find(t => t.owners?.includes(SWID));

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

// Free agents + waivers: top 40 by ownership at each position
const fa = {};
for (const [pos, slot] of Object.entries(FA_SLOT)) {
  const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, {
    players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [slot] }, limit: 40, sortPercOwned: { sortPriority: 1, sortAsc: false } },
  });
  fa[pos] = d.players.map(x => { names[x.player.id] = x.player.fullName; return { ...row(x.player), wa: x.status === 'WAIVERS', slot: 'FA' }; });
}
const allFa = Object.values(fa).flat();

// --- Start / sit: best lineup by this week's projections vs what's set now
const best = bestLineup(me.roster, weekValue);
const starting = me.roster.filter(p => p.slot !== 'Bench' && p.slot !== 'IR');
const currentTotal = starting.reduce((s, p) => s + weekValue(p), 0);
const bestIds = new Set(best.lineup.map(x => x.player.id));
const benchIn = best.lineup.map(x => x.player).filter(p => !starting.includes(p));
const sitOut = starting.filter(p => !bestIds.has(p.id));

// --- Waiver pickups: add each free agent, drop whichever player hurts least.
// Injured players are never suggested as drops (they come back). A this-week pickup
// also pays for any season-long points it costs, so a star on bye is never the drop.
function bestSwap(roster, value) {
  const base = score(roster, value);
  const seasonBase = score(roster, seasonValue);
  const drops = roster.filter(p => p.slot !== 'IR' && !HURT.includes(p.status));
  const out = [];
  for (const add of allFa) {
    if (value(add) <= 0) continue;
    let top = null;
    for (const drop of drops) {
      const next = [...roster.filter(p => p !== drop), add];
      const gain = score(next, value) - base + (value === seasonValue ? 0 : Math.min(0, score(next, seasonValue) - seasonBase));
      // on a tie, drop the weaker player
      if (!top || gain > top.gain + 0.05 || (gain > top.gain - 0.05 && (drop.avg ?? 0) < (top.drop.avg ?? 0))) top = { add, drop, gain };
    }
    if (top && top.gain > 0.3) out.push(top);
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, 8);
}
const pickupsWeek = bestSwap(me.roster, weekValue);
const pickupsSeason = bestSwap(me.roster, seasonValue);

// --- Trade ideas: 1-for-1 swaps that raise my best-lineup average, roughly fair on
// season average (managers judge by that), and barely hurt or help their lineup.
// ponytail: 1-for-1 on season average only; add 2-for-1 / rest-of-season projections if this gets used a lot.
const tradeable = p => playable(p) && !['K', 'D/ST'].includes(p.pos) && (p.avg ?? 0) > 0;
const myBase = score(me.roster, seasonValue);
const trades = [];
for (const t of teams) {
  if (t === me) continue;
  const theirBase = score(t.roster, seasonValue);
  for (const give of me.roster.filter(tradeable)) for (const take of t.roster.filter(tradeable)) {
    if (give.avg < take.avg * 0.85) continue;
    const mine = score([...me.roster.filter(p => p !== give), take], seasonValue) - myBase;
    if (mine < 0.5) continue;
    const theirs = score([...t.roster.filter(p => p !== take), give], seasonValue) - theirBase;
    if (theirs >= -0.5) trades.push({ team: t.name, give, take, mine, theirs });
  }
}
trades.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs));
const topTrades = [];
for (const tr of trades) {
  // at most 2 ideas per player I give up, so the list isn't one name 10 times
  if (topTrades.filter(x => x.give === tr.give).length < 2 && topTrades.length < 10) topTrades.push(tr);
}

// --- Adds / drops / trades around the league, last 3 weeks
const moves = [];
for (let wk = Math.max(1, week - 2); wk <= week; wk++) {
  const d = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${wk}`);
  for (const tx of d.transactions ?? []) {
    if (tx.status !== 'EXECUTED' || !['FREEAGENT', 'WAIVER', 'TRADE_ACCEPT'].includes(tx.type)) continue;
    for (const it of tx.items) if (['ADD', 'DROP', 'TRADE'].includes(it.type)) moves.push({ date: tx.processDate ?? tx.proposedDate, type: it.type, playerId: it.playerId, team: it.type === 'DROP' ? it.fromTeamId : it.toTeamId, from: it.fromTeamId });
  }
}
const missing = [...new Set(moves.map(m => m.playerId))].filter(id => !names[id]);
if (missing.length) {
  const d = await get(`${LEAGUE}?view=kona_player_info`, { players: { filterIds: { value: missing } } });
  for (const x of d.players) names[x.player.id] = x.player.fullName;
}
moves.sort((a, b) => b.date - a.date);

// --- Warnings
const warn = [];
const irUsed = me.roster.filter(p => p.slot === 'IR').length;
for (const p of me.roster) {
  if (p.status === 'INJURY_RESERVE' && p.slot !== 'IR' && irUsed < (slotCounts[21] ?? 0)) warn.push(`${p.name} is on real IR but sits on your bench. Move him to your open IR slot to free a bench spot.`);
  if (p.slot !== 'Bench' && p.slot !== 'IR' && ['OUT', 'INJURY_RESERVE', 'DOUBTFUL'].includes(p.status)) warn.push(`${p.name} is in your starting lineup but is ${p.status}.`);
  if (p.slot !== 'Bench' && p.slot !== 'IR' && p.bye === week) warn.push(`${p.name} is starting but on bye this week.`);
}
const lastWeek = league.settings.scheduleSettings?.matchupPeriodCount ?? 14;
for (let wk = week + 1; wk <= lastWeek; wk++) {
  for (const pos of ['QB', 'TE', 'K', 'D/ST']) {
    if (!me.roster.some(p => p.pos === pos && playable(p) && p.bye !== wk)) warn.push(`Week ${wk}: you have no ${pos} who can play.`);
  }
}

// --- HTML
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = v => (v == null ? '-' : v.toFixed(1));
const who = p => `${esc(p.name)} <small>${p.pos} ${p.team}${p.status ? ` <span class="bad">${p.status}</span>` : ''}</small>`;
const table = (head, rows) => rows.length ? `<div class="scroll"><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>` : '<p><small>Nothing worth doing.</small></p>';
const standings = [...teams].sort((a, b) => b.w - a.w || b.pf - a.pf);

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Fantasy">
<title>${esc(league.settings.name)} Report</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--good:#0a7d32;--bad:#b00020;--card:#f6f6f6}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#999;--line:#333;--good:#4cd07d;--bad:#ff6b6b;--card:#1e1e1e}}
body{background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:1000px;padding:16px}
h1{margin:0}h2{margin-top:32px;border-bottom:2px solid var(--line);padding-bottom:4px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:600}
.bad{color:var(--bad)}.good{color:var(--good);font-weight:600}small{color:var(--muted)}
ul{padding-left:20px}li{margin:4px 0}details{margin:8px 0}summary{cursor:pointer;font-weight:600}</style></head><body>
<h1>${esc(me.name)}</h1><small>${esc(league.settings.name)} &middot; Week ${week} &middot; updated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</small>

<h2>Heads up</h2>${warn.length ? `<ul>${warn.map(w => `<li class="bad">${esc(w)}</li>`).join('')}</ul>` : '<p>Nothing to fix.</p>'}

<h2>Start / sit (week ${week})</h2>
${sitOut.length ? `<ul>${sitOut.map((p, i) => benchIn[i] ? `<li>Start <b>${esc(benchIn[i].name)}</b> (${n(benchIn[i].proj)} proj) instead of ${esc(p.name)} (${n(weekValue(p))})</li>`
  : `<li class="bad">Bench <b>${esc(p.name)}</b> (${n(weekValue(p))} proj). Nobody on your bench can replace him: pick someone up below.</li>`).join('')}</ul>
<p>Projected: your lineup <b>${n(currentTotal)}</b> &rarr; best lineup <b class="good">${n(best.total)}</b></p>` : `<p class="good">Your lineup is already the best one (${n(best.total)} projected).</p>`}
<details><summary>Best lineup</summary>${table(['Slot', 'Player', 'Proj'], best.lineup.map(x => [x.slot, who(x.player), n(x.player.proj)]))}</details>

<h2>Waiver pickups</h2>
<h3>Helps this week</h3>${table(['Add', 'Drop', 'Gain', ''], pickupsWeek.map(s => [who(s.add), who(s.drop), `<span class="good">+${n(s.gain)}</span>`, s.add.wa ? 'waivers' : 'free agent']))}
<h3>Helps rest of season</h3>${table(['Add', 'Drop', 'Gain/wk', ''], pickupsSeason.map(s => [who(s.add), who(s.drop), `<span class="good">+${n(s.gain)}</span>`, s.add.wa ? 'waivers' : 'free agent']))}
<small>Gain = how many more points your best lineup scores. Injured players are never suggested as drops.</small>

<h2>Trade ideas</h2>
${table(['Team', 'You give', 'You get', 'You gain/wk', 'They gain/wk'], topTrades.map(t => [esc(t.team), `${who(t.give)} ${n(t.give.avg)}`, `${who(t.take)} ${n(t.take.avg)}`, `<span class="good">+${n(t.mine)}</span>`, `${t.theirs >= 0 ? '+' : ''}${n(t.theirs)}`]))}
<small>1-for-1 swaps that make your lineup better by season average, where the players are close in value so the trade looks fair to the other team.</small>

<h2>My roster</h2>${table(['Slot', 'Player', 'Bye', 'Season pts', 'Avg', `Wk ${week} proj`],
  [...me.roster].sort((a, b) => (a.slot === 'Bench') - (b.slot === 'Bench') || (a.slot === 'IR') - (b.slot === 'IR'))
    .map(p => [p.slot, who(p), p.bye === week ? `<b class="bad">${p.bye}</b>` : p.bye, n(p.pts), n(p.avg), n(p.proj)]))}

<h2>Best available</h2>${Object.entries(fa).map(([pos, list]) => `<details><summary>${pos}</summary>${table(['Player', 'Bye', 'Avg', `Wk ${week} proj`, '% rostered'],
  [...list].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 10).map(p => [who(p), p.bye, n(p.avg), n(p.proj), n(p.owned)]))}</details>`).join('')}

<h2>Standings &amp; waiver order</h2>${table(['#', 'Team', 'Record', 'PF', 'PA', 'Waiver'],
  standings.map((t, i) => [i + 1, t === me ? `<b>&#9733; ${esc(t.name)}</b>` : esc(t.name), `${t.w}-${t.l}`, n(t.pf), n(t.pa), t.waiver]))}

<h2>League moves (last 3 weeks)</h2>${table(['Date', 'Team', 'Move', 'Player'],
  moves.map(m => [new Date(m.date).toLocaleDateString('en-US'), esc(teamName[m.team] ?? ''), m.type === 'TRADE' ? `trade from ${esc(teamName[m.from])}` : m.type.toLowerCase(), esc(names[m.playerId] ?? m.playerId)]))}
</body></html>`;

fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), html);
console.log(`Wrote site/index.html for ${me.name}, week ${week}.`);
warn.forEach(w => console.log('!', w));
console.log('Start/sit:', benchIn.map(p => p.name).join(', ') || 'none', '| sit:', sitOut.map(p => p.name).join(', ') || 'none');
console.log('Pickups (week):', pickupsWeek.slice(0, 4).map(s => `+${s.add.name} -${s.drop.name} (${s.gain.toFixed(1)})`).join('; '));
console.log('Pickups (season):', pickupsSeason.slice(0, 4).map(s => `+${s.add.name} -${s.drop.name} (${s.gain.toFixed(1)})`).join('; '));
console.log('Trades:', topTrades.slice(0, 5).map(t => `${t.give.name} -> ${t.take.name} w/ ${t.team} (+${t.mine.toFixed(1)}/+${t.theirs.toFixed(1)})`).join('; '));
