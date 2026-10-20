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

function row(p) {
  const season = stat(p, 0, 0);
  return {
    id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] ?? '?',
    team: proAbbr[p.proTeamId] ?? 'FA', teamName: proName[p.proTeamId] ?? 'No team', bye: proBye[p.proTeamId] ?? null,
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
const starters = t => t.roster.filter(p => p.slot !== 'Bench' && p.slot !== 'IR');
const lineupProj = t => starters(t).reduce((s, p) => s + weekValue(p), 0);

// This week's opponent
const game = league.schedule?.find(g => g.matchupPeriodId === week && (g.home?.teamId === me.id || g.away?.teamId === me.id));
const opp = game && teams.find(t => t.id === (game.home.teamId === me.id ? game.away?.teamId : game.home.teamId));

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
const bestIds = new Set(best.lineup.map(x => x.player.id));
const benchIn = best.lineup.map(x => x.player).filter(p => !starters(me).includes(p));
const sitOut = starters(me).filter(p => !bestIds.has(p.id));

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
  return out.sort((a, b) => b.gain - a.gain).slice(0, 5);
}
const pickupsWeek = bestSwap(me.roster, weekValue);
const pickupsSeason = bestSwap(me.roster, seasonValue).filter(s => !pickupsWeek.slice(0, 1).some(w => w.add === s.add));

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
  if (topTrades.filter(x => x.give === tr.give).length < 2 && topTrades.length < 6) topTrades.push(tr);
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

// --- To-do list, most urgent first. Each item: [level, title, why]
const n = v => (v == null ? '-' : v.toFixed(1));
const todo = [];
for (const p of starters(me)) {
  if (p.bye === week) todo.push(['urgent', `Take ${p.name} out of your lineup`, `His team (${p.teamName}) has no game this week, so he'll score 0.`]);
  else if (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status)) todo.push(['urgent', `Take ${p.name} out of your lineup`, `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`]);
}
for (const [i, p] of benchIn.entries()) todo.push(['urgent', `Start ${p.name}`, `He's expected to score ${n(p.proj)}${sitOut[i] ? `, more than ${sitOut[i].name} (${n(weekValue(sitOut[i]))})` : ''}.`]);
if (pickupsWeek[0]) {
  const s = pickupsWeek[0];
  todo.push([sitOut.length > benchIn.length ? 'urgent' : 'week', `Pick up ${s.add.name}, drop ${s.drop.name}`, `Adds about ${n(s.gain)} points to your score this week. ${s.drop.name} is the least useful player on your bench.`]);
}
const irUsed = me.roster.filter(p => p.slot === 'IR').length;
for (const p of me.roster) {
  if (p.status === 'INJURY_RESERVE' && p.slot !== 'IR' && irUsed < (slotCounts[21] ?? 0)) todo.push(['week', `Move ${p.name} to your IR spot`, 'He\'s hurt long-term. Putting him in the IR spot frees a bench spot for free, without dropping him.']);
}
for (let wk = week + 1; wk <= lastWeek; wk++) {
  for (const pos of ['QB', 'TE', 'K', 'D/ST']) {
    if (me.roster.some(p => p.pos === pos && playable(p) && p.bye !== wk)) continue;
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
const chip = p => {
  if (p.bye === week) return '<span class="chip bad">No game this week</span>';
  const s = STATUS[p.status];
  return s ? `<span class="chip ${s[1]}">${s[0]}</span>` : '';
};
const player = (p, extra = '') => `<div class="player">${pic(p)}<div class="who"><div class="name">${esc(p.name)}</div>
  <div class="meta"><span class="pos pos-${p.pos.replace('/', '')}">${p.pos}</span> ${esc(p.teamName)}</div>${chip(p)}${extra}</div></div>`;
const big = (v, label) => `<div class="big"><b>${n(v)}</b><small>${label}</small></div>`;

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

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Fantasy"><meta name="theme-color" content="#0b1530">
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
.big{flex:none;text-align:right}.big b{display:block;font-size:20px;font-weight:800;line-height:1.1}.big small{font-size:11px;color:var(--muted)}
.list .card{margin-bottom:0;border-radius:0;border-bottom:none}.list .card:first-child{border-radius:16px 16px 0 0}.list .card:last-child{border-radius:0 0 16px 16px;border-bottom:1px solid var(--line)}
.list .card:only-child{border-radius:16px}
.group{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 8px}
.swap{display:grid;grid-template-columns:1fr;gap:10px}
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
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:32px}
</style></head><body>

<header><div class="wrap">
  <div class="league">${esc(league.settings.name)} &middot; Week ${week}</div>
  <h1>${esc(me.name)}</h1>
  <div class="record">${me.w}-${me.l} record &middot; ${myRank}${{ one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(myRank)]} of ${teams.length}</div>
</div></header>

<div class="wrap">
${opp ? `<div class="match"><h3>This week's matchup</h3><div class="vs">
  <div class="t">You</div><div class="p">${n(myProj)}</div><div class="bar"><i style="width:${Math.min(100, myProj / Math.max(myProj, oppProj, 1) * 100)}%;background:var(--brand2)"></i></div>
  <div class="t">${esc(opp.name)}</div><div class="p">${n(oppProj)}</div><div class="bar"><i style="width:${Math.min(100, oppProj / Math.max(myProj, oppProj, 1) * 100)}%;background:var(--muted)"></i></div>
</div><div class="verdict">${myProj >= oppProj ? `<b style="color:var(--good)">You're expected to win</b> by ${n(myProj - oppProj)} points.` : `<b style="color:var(--bad)">You're expected to lose</b> by ${n(oppProj - myProj)} points.`}
${fixedProj > myProj + 0.5 ? ` Doing the to-do list below gets you to about <b>${n(fixedProj + (pickupsWeek[0]?.gain ?? 0))}</b>.` : ''}</div>
<div class="tag" style="margin-top:6px">${esc(playoffLine)}</div></div>` : ''}

<nav><a href="#todo">To-do</a><a href="#lineup">My team</a><a href="#pickups">Pickups</a><a href="#trades">Trades</a><a href="#league">League</a><a href="#help">How it works</a></nav>

<section id="todo"><h2>To-do list</h2><p class="sub">Most important first. Do these in the ESPN app.</p>
${todo.length ? todo.map(([lvl, title, why]) => `<div class="card todo"><span class="lvl ${lvl}">${levelName[lvl]}</span><div><b>${esc(title)}</b><p>${esc(why)}</p></div></div>`).join('') : '<div class="card empty">You\'re all set this week.</div>'}
</section>

<section id="lineup"><h2>My team</h2><p class="sub">Big number = points ESPN expects him to score this week.</p>
${[['Starting', p => p.slot !== 'Bench' && p.slot !== 'IR'], ['Bench', p => p.slot === 'Bench'], ['Injured reserve', p => p.slot === 'IR']].map(([label, f]) => {
  const ps = lineupRows.filter(f);
  return ps.length ? `<div class="group">${label}</div><div class="list">${ps.map(p => `<div class="card row"><span class="slot">${p.slot === 'Bench' || p.slot === 'IR' ? '' : p.slot}</span>${player(p)}${big(weekValue(p), 'expected')}</div>`).join('')}</div>` : '';
}).join('')}
</section>

<section id="pickups"><h2>Pickups</h2><p class="sub">Players nobody in your league has. Add them in ESPN under Players &rarr; Add.</p>
${[['For this week (pick one)', pickupsWeek, 'more points this week', true], ['For the rest of the season', pickupsSeason, 'more points per week', false]].map(([label, list, unit, wk]) => `<div class="group">${label}</div>${list.length ? list.slice(0, 3).map(s => `<div class="card">
  <div class="row">${player(s.add)}${big(wk ? s.add.proj : s.add.avg, wk ? 'expected' : 'per game')}</div>
  <p class="why"><span class="gain">+${n(s.gain)}</span> ${unit}. Drop <b>${esc(s.drop.name)}</b> (${n(wk ? weekValue(s.drop) : s.drop.avg)} ${wk ? 'expected' : 'per game'}) to make room.<br>
  <span class="tag">${s.add.wa ? 'On waivers: your claim goes through in about a day.' : 'Free agent: yours right away.'}</span></p></div>`).join('') : '<div class="card empty">Nobody out there beats what you have.</div>'}`).join('')}
</section>

<section id="trades"><h2>Trade ideas</h2><p class="sub">Swaps that make your team better and look fair to the other team, so they might say yes. Offer them in ESPN under Trade.</p>
${topTrades.length ? topTrades.map(t => `<div class="card"><div class="tag" style="margin-bottom:8px">with <b>${esc(t.team)}</b></div><div class="swap">
  <div class="row">${player(t.give, '')}${big(t.give.avg, 'per game')}</div>
  <div class="arrow">for</div>
  <div class="row">${player(t.take, '')}${big(t.take.avg, 'per game')}</div></div>
  <p class="why"><span class="gain">+${n(t.mine)}</span> points per week for you. You get a ${POS_NAME[t.take.pos].toLowerCase()}; they get a ${POS_NAME[t.give.pos].toLowerCase()}${t.theirs > 0.2 ? `, which helps them too (+${n(t.theirs)})` : ''}.</p></div>`).join('') : '<div class="card empty">No fair trades that help you right now.</div>'}
</section>

<section id="league"><h2>League</h2><p class="sub">Dashed line = playoff cutoff. Waiver # = who gets first pick of new players (1 goes first).</p>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">W-L</td><td class="num">Points</td><td class="num">Waiver #</td></tr>
${standings.map((t, i) => `<tr class="${t === me ? 'me' : ''} ${i + 1 === playoffTeams ? 'cut' : ''}"><td class="num" style="text-align:left">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.w}-${t.l}</td><td class="num">${Math.round(t.pf)}</td><td class="num">${t.waiver}</td></tr>`).join('')}</table></div>
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
<dt>Points per game</dt><dd>How many points he's actually scored each week on average this season. Better for judging who's good long-term.</dd>
<dt>Bye week</dt><dd>Each NFL team gets one week off. A player on bye scores 0, so never start him that week.</dd>
<dt>Injury tags</dt><dd><b>Might not play</b> (questionable): about 50/50, usually plays. <b>Probably won't play</b> (doubtful). <b>Out</b>: won't play. <b>IR</b>: hurt for weeks; move him to your IR spot so he doesn't take up a bench spot.</dd>
<dt>Waivers vs free agents</dt><dd>Recently dropped players go on <b>waivers</b> for about a day. Everyone can claim them, and the team with the best waiver # gets him. After that he's a <b>free agent</b>: first to add him gets him.</dd>
<dt>Scoring in this league</dt><dd>Half-point PPR: players get half a point for every catch, on top of points for yards and touchdowns.</dd>
<dt>Where these tips come from</dt><dd>This page does the math on ESPN's projections and season stats. It doesn't know about news ESPN hasn't added yet, so for big decisions it's worth a second opinion.</dd>
</dl></div></section>

<footer>Updated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET &middot; refreshes every 3 hours</footer>
</div></body></html>`;

fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), html);
console.log(`Wrote site/index.html for ${me.name}, week ${week}. vs ${opp?.name}: ${n(myProj)}-${n(oppProj)}`);
todo.forEach(([l, t]) => console.log(`[${l}] ${t}`));
