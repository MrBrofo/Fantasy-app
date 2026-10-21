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

// --- Second opinions, so one site's guess doesn't decide everything. Any that fail are left out (and named on the page).
// Players are matched by name + NFL team (positions differ between sites); defenses by team.
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv|v)$/, '').trim();
const TEAM = t => ({ WSH: 'WAS' }[t?.toUpperCase()] ?? t?.toUpperCase());
const pkey = (name, pos, team) => (pos === 'D/ST' ? `dst|${TEAM(team)}` : `${norm(name)}|${TEAM(team)}`);
// Sources that failed this run; the page shows a warning banner listing them
const down = [];
// Sleeper's projections for this week (made by Rotowire, not ESPN), half-point PPR like this league
const sleeper = new Map();
const slp = []; // every player in this week's projections, incl. injured ones with no points
try {
  const r = await fetch(`https://api.sleeper.app/projections/nfl/${SEASON}/${week}?season_type=regular&${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position[]=${p}`).join('&')}`);
  for (const x of await r.json()) {
    const pos = x.player?.position === 'DEF' ? 'D/ST' : x.player?.position;
    const name = `${x.player?.first_name} ${x.player?.last_name}`;
    if (['QB', 'RB', 'WR', 'TE'].includes(pos)) slp.push({ k: pkey(name, pos, x.team), name, pos, team: TEAM(x.team), pts: x.stats?.pts_half_ppr ?? null, inj: x.player?.injury_status ?? null });
    if (x.stats?.pts_half_ppr != null) sleeper.set(pkey(`${x.player.first_name} ${x.player.last_name}`, pos, x.team), x.stats.pts_half_ppr);
  }
} catch (err) { console.warn('Sleeper projections skipped:', err.message); }
if (!sleeper.size) down.push('Rotowire');
// CBS Sports' projections. CBS has no free API, so this reads their stats pages, which can break when they
// redesign. To go easy on them it's fetched at most once an hour; the copy is saved on the published site
// (cbs.json) and the next run reuses it. (FantasyPros was tried first: it hides all but the top 10 without a login.)
const cbs = new Map();
let cbsSaved = null;
try {
  const old = await (await fetch(`https://mrbrofo.github.io/Fantasy-app/cbs.json?t=${Date.now()}`)).json();
  if (old.week === week && Date.now() - old.at < 3600e3) cbsSaved = old;
} catch {}
// Reads every CBS page for one time span (a week number, or 'restofseason') into [name, pos, team, points] rows.
// The last number in each row is the points (the week's total, or per game for rest of season).
async function cbsRows(span) {
  const half = new Map(); // key -> row; CBS has PPR and no-PPR pages, half PPR is the average
  // Defenses are skipped: CBS scores them much higher than this league does (Texans: CBS 15, Rotowire 9).
  for (const scoring of ['ppr', 'nonppr']) for (const pos of ['QB', 'RB', 'WR', 'TE', 'K']) {
    const r = await fetch(`https://www.cbssports.com/fantasy/football/stats/${pos}/${SEASON}/${span}/projections/${scoring}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${r.status} on ${pos}`);
    for (const tr of (await r.text()).split('<tr class="TableBase-bodyTr').slice(1)) {
      const row = tr.split('</tr>')[0];
      // full name link, then <span class="CellPlayerName-team"> LAR
      const name = row.match(/CellPlayerName--long[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1];
      const team = row.match(/CellPlayerName-team">\s*([A-Z]+)/)?.[1];
      const pts = Number([...row.matchAll(/--number[^>]*>\s*([-\d.]+)\s*</g)].pop()?.[1]);
      if (!name || !team || Number.isNaN(pts)) continue;
      const k = pkey(name, pos, team), prev = half.get(k);
      half.set(k, prev ? [name, pos, team, (prev[3] + pts) / 2] : [name, pos, team, pts]);
    }
  }
  if (half.size < 200) throw new Error(`only ${half.size} players found, page layout probably changed`);
  return [...half.values()];
}
if (!cbsSaved) try {
  cbsSaved = { week, at: Date.now(), rows: await cbsRows(week) };
} catch (err) { console.warn('CBS projections skipped:', err.message); down.push('CBS'); }
for (const [name, pos, team, pts] of cbsSaved?.rows ?? []) cbs.set(pkey(name, pos, team), pts);
// Rest of season: points per game each source expects from this week to the end. Used for anything
// longer than this week (season pickups, trades, bye fill-ins). Rotowire's comes from Sleeper one week
// at a time (12 big downloads), so like CBS it's refreshed at most once an hour and saved as ros.json.
let rosSaved = null;
try {
  const old = await (await fetch(`https://mrbrofo.github.io/Fantasy-app/ros.json?t=${Date.now()}`)).json();
  if (old.week === week && Date.now() - old.at < 3600e3 && old.practice) rosSaved = old;
} catch {}
if (!rosSaved) {
  rosSaved = { week, at: Date.now(), roto: [], cbs: [] };
  try {
    const sum = new Map(); // key -> [points, games]
    for (let wk = week; wk <= 18; wk++) {
      const r = await fetch(`https://api.sleeper.app/projections/nfl/${SEASON}/${wk}?season_type=regular&${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position[]=${p}`).join('&')}`);
      for (const x of await r.json()) {
        const pos = x.player?.position === 'DEF' ? 'D/ST' : x.player?.position, pts = x.stats?.pts_half_ppr;
        if (pts == null || !x.stats?.gp) continue; // no game that week (bye)
        const k = pkey(`${x.player.first_name} ${x.player.last_name}`, pos, x.team), t = sum.get(k) ?? [0, 0];
        sum.set(k, [t[0] + pts, t[1] + 1]);
      }
    }
    rosSaved.roto = [...sum].map(([k, [pts, games]]) => [k, pts / games]);
  } catch (err) { console.warn('Rotowire rest-of-season skipped:', err.message); }
  // Games so far (Sleeper results): points each defense has given up per game to each position,
  // and each player's points so far, to know who a team's usual starters are
  try {
    const allowed = {}, usual = new Map(); // allowed[pos][team] = [points, Set of weeks]
    for (let wk = 1; wk < week; wk++) {
      const r = await fetch(`https://api.sleeper.app/stats/nfl/${SEASON}/${wk}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`);
      for (const x of await r.json()) {
        const pos = x.player?.position, pts = x.stats?.pts_half_ppr ?? 0;
        if (!x.stats?.gp || !x.opponent) continue;
        const a = ((allowed[pos] ??= {})[TEAM(x.opponent)] ??= [0, new Set()]);
        a[0] += pts; a[1].add(wk);
        const name = `${x.player.first_name} ${x.player.last_name}`, k = pkey(name, pos, x.team), u = usual.get(k) ?? [k, name, pos, TEAM(x.team), 0];
        u[4] += pts; usual.set(k, u);
      }
    }
    rosSaved.allowed = Object.fromEntries(Object.entries(allowed).map(([pos, t]) => [pos, Object.fromEntries(Object.entries(t).map(([team, [pts, wks]]) => [team, pts / wks.size]))]));
    rosSaved.usual = [...usual.values()];
  } catch (err) { console.warn('Matchup data skipped:', err.message); rosSaved.allowed = {}; rosSaved.usual = []; }
  // Official NFL injury report (NFL.com): each listed player's latest practice this week. Tables are per team,
  // headed by the nickname ("Seahawks"); columns are player, position, injury, practice status, game status.
  try {
    const r = await fetch(`https://www.nfl.com/injuries/league/${SEASON}/reg${week}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${r.status}`);
    const nick = Object.fromEntries(pro.filter(t => t.id).map(t => [t.name, t.abbrev]));
    const text = s => s.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
    rosSaved.practice = [];
    for (const part of (await r.text()).split('<div class="d3-o-section-sub-title"><span>').slice(1)) {
      const team = nick[text(part.slice(0, part.indexOf('</span>')))];
      if (!team) continue;
      for (const tr of part.split('<tr>').slice(1)) {
        const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
        const pr = /^Full/.test(td[3]) ? 'Full' : /^Limited/.test(td[3]) ? 'Limited' : /^Did Not/.test(td[3]) ? 'DNP' : null;
        if (pr) rosSaved.practice.push([pkey(td[0], td[1], team), pr]);
      }
    }
  } catch (err) { console.warn('NFL injury report skipped:', err.message); rosSaved.practice = []; }
  try {
    rosSaved.cbs = (await cbsRows('restofseason')).map(([name, pos, team, ppg]) => [pkey(name, pos, team), ppg]);
  } catch (err) { console.warn('CBS rest-of-season skipped:', err.message); }
}
if (!rosSaved.roto.length) down.push('Rotowire rest-of-season');
if (!rosSaved.cbs.length) down.push('CBS rest-of-season');
const rosRoto = new Map(rosSaved.roto), rosCbs = new Map(rosSaved.cbs), practice = new Map(rosSaved.practice);
// Chance a hurt player plays. Footballguys Injury Index (QBs, RBs, WRs, TEs): by final practice, 2017-2023;
// questionable 70.7% and doubtful 6.9% overall, 2017-2024. Practice is the strongest clue, so it's used when NFL.com has it.
const PLAY_ODDS = { any: { Full: 86, Limited: 71, DNP: 29 }, concussion: { Full: 85, Limited: 57, DNP: 29 }, knee: { Full: 92, Limited: 81, DNP: 28 }, hamstring: { Full: 73, Limited: 62, DNP: 20 } };
const PRACTICED = { Full: 'he practiced fully', Limited: 'he was limited in practice', DNP: 'he didn\'t practice' };
function playOdds(p, type) {
  if (p.status === 'DOUBTFUL') return { pct: 7, why: 'only about 7 in 100 doubtful players end up playing' };
  if (p.status !== 'QUESTIONABLE') return null;
  const pr = practice.get(pkey(p.name, p.pos, p.team));
  if (!pr) return { pct: 71, why: 'no practice report yet this week; about 71 in 100 questionable players end up playing' };
  const kind = ['concussion', 'knee', 'hamstring'].find(k => new RegExp(k, 'i').test(type ?? '')) ?? 'any';
  return { pct: PLAY_ODDS[kind][pr], why: `${PRACTICED[pr]}${kind === 'any' ? '' : ` (${kind} injury)`}, and players like that played ${PLAY_ODDS[kind][pr]}% of the time` };
}
// Vegas lines (DraftKings, from ESPN's public scoreboard): points each NFL team is expected to score
const vegas = {};
try {
  const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${SEASON}`)).json();
  for (const ev of d.events ?? []) {
    const c = ev.competitions[0], o = c.odds?.[0];
    if (!o?.overUnder || o.spread == null) continue;
    const home = c.competitors.find(x => x.homeAway === 'home'), away = c.competitors.find(x => x.homeAway === 'away');
    // spread is the home team's line: -3 means home is favored by 3
    vegas[TEAM(home.team.abbreviation)] = (o.overUnder - o.spread) / 2;
    vegas[TEAM(away.team.abbreviation)] = (o.overUnder + o.spread) / 2;
  }
} catch (err) { console.warn('Vegas lines skipped:', err.message); down.push('Vegas lines'); }
const vegasAvg = Object.values(vegas).reduce((s, v) => s + v, 0) / Math.max(1, Object.keys(vegas).length);
// "Experts disagree" = the highest and lowest projection are 5+ points and 35%+ apart
const split = v => v.length > 1 && Math.max(...v) - Math.min(...v) >= 5 && Math.max(...v) - Math.min(...v) >= 0.35 * Math.max(...v);

// statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season, 1 = one week.
// Stats also include last season's totals, so filter by seasonId.
const stat = (p, src, split) => p.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === split && (split === 0 || s.scoringPeriodId === week));

// ratings[0] = season-long; positionalRanking = e.g. 14th-best QB so far
function row(p, ratings) {
  const season = stat(p, 0, 0);
  const proj = stat(p, 1, 1);
  const pos = POS[p.defaultPositionId] ?? '?', team = proAbbr[p.proTeamId] ?? 'FA';
  // expected points = average of ESPN, Rotowire and CBS, whichever have a number (none if ESPN has none, e.g. bye)
  const espn = proj?.appliedTotal ?? null, k = pkey(p.fullName, pos, team);
  const roto = espn == null ? null : sleeper.get(k) ?? null, cb = espn == null ? null : cbs.get(k) ?? null;
  const all = [espn, roto, cb].filter(v => v != null);
  // ESPN's rest-of-season projection is statSourceId 1, statSplitTypeId 0 (per game = appliedAverage)
  const rosBy = [stat(p, 1, 0)?.appliedAverage ?? null, rosRoto.get(k) ?? null, rosCbs.get(k) ?? null];
  const rosAll = rosBy.filter(v => v != null);
  return {
    id: p.id, name: p.fullName, pos, proTeamId: p.proTeamId,
    team, teamName: proName[p.proTeamId] ?? 'No team', bye: proBye[p.proTeamId] ?? null,
    status: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    pts: season?.appliedTotal ?? null, avg: season?.appliedAverage ?? null, ceiling: proj?.appliedTotalCeiling ?? null,
    proj: all.length ? all.reduce((s, v) => s + v, 0) / all.length : null, espn, roto, cbs: cb, split: split(all), vegas: vegas[TEAM(team)] ?? null,
    ros: rosAll.length ? rosAll.reduce((s, v) => s + v, 0) / rosAll.length : null, rosBy,
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
// Once a player's game kicks off, ESPN locks him for the week: a starter stays in, anyone else can't be put in
const kickoff = p => pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0]?.date ?? null;
const locked = p => { const k = kickoff(p); return k != null && k <= Date.now(); };
const isStarter = p => p.slot !== 'Bench' && p.slot !== 'IR' && p.slot !== 'FA';
const weekValue = p => (playable(p) && !(locked(p) && !isStarter(p)) ? p.proj ?? 0 : 0);
// Long-term value: rest-of-season points per game (average of the sources), else his average so far
const rate = p => p.ros ?? p.avg ?? 0;
const seasonValue = p => (playable(p) ? rate(p) : 0);
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
// locked starters can't be moved, so they always stay in the best lineup
const best = bestLineup(me.roster, p => weekValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0));
best.total = best.lineup.reduce((t, x) => t + weekValue(x.player), 0);
const bestIds = new Set(best.lineup.map(x => x.player.id));
const benchIn = best.lineup.map(x => x.player).filter(p => !starters(me).includes(p));
const sitOut = starters(me).filter(p => !bestIds.has(p.id));
// This week's best total with game locks: locked starters stay in, everyone else counts as weekValue says
const weekScore = players => bestLineup(players, p => weekValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0)).lineup.reduce((t, x) => t + weekValue(x.player), 0);

// --- Waiver pickups: add each free agent, drop whichever player hurts least.
// Injured players are never suggested as drops (they come back), unless out for the season.
// A this-week pickup also pays for any season-long points it costs, so a star on bye is never the drop.
const weakness = p => (p.inj?.season ? -1 : rate(p)); // tie-break: drop out-for-season players first
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

// --- Trades. Managers judge a player by "value over replacement": how much better he is than the
// best player free on waivers at his position. A great tight end is rare, so he's worth more than
// his raw points say; raw points alone made swapping an elite TE for a RB look fair when it isn't.
const healthyFa = pos => (fa[pos] ?? []).filter(p => !HURT.includes(p.status)).map(rate).sort((a, b) => b - a);
const repl = Object.fromEntries(Object.keys(FA_SLOT).map(pos => [pos, healthyFa(pos)[1] ?? healthyFa(pos)[0] ?? 0]));
const vor = p => Math.max(0, rate(p) - (repl[p.pos] ?? 0));
// Who would start at a position (best by season average) in a roster
const starterAt = (roster, pos) => bestLineup(roster, seasonValue).lineup.map(x => x.player).filter(p => p.pos === pos).sort((a, b) => rate(b) - rate(a))[0];
// Effect of a trade on both teams. give = players I send, take = players I get.
function judge(give, take, them) {
  const mineAfter = [...me.roster.filter(p => !give.includes(p)), ...take];
  const theirsAfter = [...them.roster.filter(p => !take.includes(p)), ...give];
  return {
    mine: score(mineAfter, seasonValue) - score(me.roster, seasonValue),
    // this week: a starter of mine whose game has kicked off already scored for me, traded or not; a player
    // I'd get counts like a bench player (0 once his game has kicked off)
    mineWeek: weekScore([...me.roster.filter(p => !give.includes(p) || (locked(p) && isStarter(p))), ...take.map(p => ({ ...p, slot: 'Bench' }))]) - weekScore(me.roster),
    theirs: score(theirsAfter, seasonValue) - score(them.roster, seasonValue),
    vorGive: give.reduce((s, p) => s + vor(p), 0), vorTake: take.reduce((s, p) => s + vor(p), 0),
    after: mineAfter,
  };
}

// Trade ideas: 1-for-1, worth 2+ points a week to me, and fair to them on value over replacement.
// ponytail: 1-for-1 only; add 2-for-1 if this gets used a lot.
const tradeable = p => playable(p) && !['K', 'D/ST'].includes(p.pos) && rate(p) > 0;
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
const moves = [], pendingTx = new Map(), intel = new Map(), othersPending = new Map(), myFailed = [];
const involvesMe = tx => tx.items.some(i => i.toTeamId === me.id || i.fromTeamId === me.id);
for (let wk = Math.max(1, week - 2); wk <= week; wk++) {
  const d = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${wk}`);
  for (const tx of d.transactions ?? []) {
    // old weeks keep stale "PENDING" rows; only this week's with isPending are real
    if (wk === week && tx.isPending && tx.status === 'PENDING' && ['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && involvesMe(tx)) pendingTx.set(tx.id, tx);
    // trades between two other teams that are waiting (offered, or accepted and in league review)
    else if (wk === week && tx.isPending && tx.type.startsWith('TRADE') && !involvesMe(tx) && tx.items.some(i => i.type === 'TRADE')) othersPending.set(tx.id, tx);
    else if (tx.type === 'WAIVER' && tx.status?.startsWith('FAILED') && tx.teamId === me.id) myFailed.push(tx);
    else if (tx.status !== 'EXECUTED' && tx.status !== 'PENDING' && ['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && !involvesMe(tx)) intel.set(tx.id, tx);
    if (tx.status !== 'EXECUTED' || !['FREEAGENT', 'WAIVER', 'TRADE_ACCEPT'].includes(tx.type)) continue;
    for (const it of tx.items) if (['ADD', 'DROP', 'TRADE'].includes(it.type)) moves.push({ date: tx.processDate ?? tx.proposedDate, type: it.type, playerId: it.playerId, team: it.type === 'DROP' ? it.fromTeamId : it.toTeamId, from: it.fromTeamId });
  }
}
// Full player rows for everyone mentioned (rostered, free agents, or looked up)
const byId = new Map([...teams.flatMap(t => t.roster), ...allFa].map(p => [p.id, p]));
const txIds = [...pendingTx.values(), ...intel.values(), ...othersPending.values()].flatMap(tx => tx.items.map(i => i.playerId));
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

// Start from the roster as it will be once my pending waiver claims go through, so the plan doesn't
// suggest a second pickup for the same hole, or a player I've already claimed.
const claims = pending.filter(m => m.kind === 'waiver');
const baseRoster = [...me.roster.filter(p => !claims.some(m => m.drop.some(d => d.id === p.id))), ...claims.flatMap(m => m.add.map(a => ({ ...a, slot: 'Bench' })))];
// One plan, done in order: each step is applied before picking the next, so every step
// drops a different player and players added earlier in the plan are never dropped.
const plan = [];
{
  let roster = [...baseRoster];
  const used = new Set(claims.flatMap(m => m.add.map(a => a.id)));
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
  roster = [...baseRoster];
  for (const s of plan) {
    const value = s.kind === 'week' ? weekValue : seasonValue;
    const next = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
    s.gain = score(next, value) - score(roster, value);
    roster = next;
  }
}
const weekPlanGain = plan.filter(s => s.kind === 'week').reduce((t, s) => t + s.gain, 0);

// --- Trade partners: what each team is short on and has extra of.
// "Short" = their worst starter at a position is below the league's typical (median) starter there.
// "Extra" = a bench player at a position who'd be a decent starter (85% of that median or better).
const TRADE_POS = ['QB', 'RB', 'WR', 'TE'];
const lineups = new Map(teams.map(t => [t, bestLineup(t.roster, seasonValue).lineup]));
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// only the position's own slots count (a TE playing FLEX is not the team's TE)
const typical = Object.fromEntries(TRADE_POS.map(pos => [pos, median([...lineups.values()].flat().filter(x => x.slot === pos).map(x => rate(x.player)))]));
const depth = t => {
  const starters = lineups.get(t).map(x => x.player);
  const short = TRADE_POS.filter(pos => { const s = lineups.get(t).filter(x => x.slot === pos).map(x => x.player); return !s.length || Math.min(...s.map(rate)) < typical[pos]; });
  const extra = TRADE_POS.map(pos => [pos, t.roster.filter(p => p.pos === pos && playable(p) && !starters.includes(p) && rate(p) >= 0.85 * typical[pos])]).filter(([, ps]) => ps.length);
  const count = Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map(pos => [pos, t.roster.filter(p => p.pos === pos && p.slot !== 'IR').length]));
  return { t, short, extra, count };
};
const myDepth = depth(me);
const partners = teams.filter(t => t !== me).map(depth).map(d => ({
  ...d,
  theyHave: d.extra.filter(([pos]) => myDepth.short.includes(pos)), // what they can give you
  youHave: myDepth.extra.filter(([pos]) => d.short.includes(pos)), // what you can give them
})).sort((a, b) => (b.theyHave.length && b.youHave.length) - (a.theyHave.length && a.youHave.length) || b.theyHave.length - a.theyHave.length);

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
// "ESPN 12.3, Rotowire 6.1, CBS 9.0" for whichever sources have a number
const srcText = p => [['ESPN', p.espn], ['Rotowire', p.roto], ['CBS', p.cbs]].filter(([, v]) => v != null).map(([s, v]) => `${s} ${n(v)}`).join(', ');
const todo = [];
for (const p of starters(me)) {
  if (p.bye === week) todo.push(['urgent', `Take ${p.name} out of your lineup`, `His team (${p.teamName}) has no game this week, so he'll score 0.`]);
  else if (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && !locked(p)) todo.push(['urgent', `Take ${p.name} out of your lineup`, `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`]);
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
const afterPlan = [...baseRoster.filter(p => !plan.some(s => s.drop === p)), ...plan.map(s => s.add)];
for (let wk = week + 1; wk <= lastWeek; wk++) {
  for (const pos of ['QB', 'TE', 'K', 'D/ST']) {
    if (afterPlan.some(p => p.pos === pos && !HURT.includes(p.status) && p.slot !== 'IR' && p.bye !== wk)) continue;
    const sub = fa[pos].filter(p => p.bye !== wk && !HURT.includes(p.status)).sort((a, b) => rate(b) - rate(a))[0];
    todo.push(['later', `Week ${wk}: get a ${POS_NAME[pos].toLowerCase()}`, `None of yours play that week.${sub ? ` Best one available: ${sub.name} (${sub.teamName}, expected ${n(rate(sub))} per game).` : ''}`]);
  }
}

// --- Phone alerts. Each alert has a key; keys already sent are remembered in state/alerts.json, which the
// workflow carries from run to run (Actions cache), so the every-minute runs don't repeat them. The published
// site's copy is only a fallback: GitHub's CDN can serve it up to 10 minutes stale, which once re-sent everything.
// Urgent alerts also go out during quiet hours (11pm-8am ET).
const VAPID_PUBLIC = 'BARgoktdqvKVCNGSMWSNgihh0VeG29ic9R9phwQIM2C0cb5tzZj6CQfoeigkrXC0-7rQ9BXE6IHjN_ua-akcKEw';
const etNow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
const etHour = Number(etNow.find(x => x.type === 'hour').value), etDay = etNow.find(x => x.type === 'weekday').value;
const notStarted = p => kickoff(p) > Date.now();
const soon = (p, hours) => notStarted(p) && kickoff(p) - Date.now() < hours * 3600e3;
// memo.sent = key -> when sent; memo.q = my players who were questionable last run; memo.downSince = source -> since when
let memo = { sent: {}, q: {}, downSince: {} }, memoOk = false;
const memoFile = path.join(dir, 'state', 'alerts.json');
if (fs.existsSync(memoFile)) { memo = { ...memo, ...JSON.parse(fs.readFileSync(memoFile, 'utf8')) }; memoOk = true; }
else try {
  const r = await fetch(`https://mrbrofo.github.io/Fantasy-app/alerts.json?t=${Date.now()}`);
  if (r.status === 404) memoOk = true; // first run ever
  else if (r.ok) { memo = { ...memo, ...await r.json() }; memoOk = true; }
} catch {}
const alerts = []; // [key, title, body, urgent]
if (process.env.PUSH_SUB) alerts.push([`hello:${JSON.parse(process.env.PUSH_SUB).endpoint.slice(-16)}`, 'Alerts are on', 'You\'ll get a notification when something on your team needs you.', true]);
// A questionable player's status gets decided about 90 minutes before kickoff
const decided = new Set();
for (const p of me.roster) {
  if (!memo.q[p.id] || p.status === 'QUESTIONABLE' || p.slot === 'IR' || !notStarted(p)) continue;
  decided.add(p.id);
  const starting = p.slot !== 'Bench';
  alerts.push(!p.status
    ? [`q:${week}:${p.id}`, `${p.name} is playing`, bestIds.has(p.id) ? (starting ? 'He\'s in your lineup. Keep him there.' : 'Start him: he\'s in your best lineup.') : (starting ? 'He\'s playing, but someone on your bench is expected to score more. Check your to-do list.' : 'Keep him on your bench.'), true]
    : [`q:${week}:${p.id}`, `${p.name} ${p.status === 'DOUBTFUL' ? 'probably won\'t play' : p.status === 'OUT' ? 'is out' : 'won\'t play'}`, starting ? 'He\'s in your lineup, so swap him out now in the ESPN app.' : 'He\'s on your bench, so there\'s nothing to do.', true]);
}
memo.q = Object.fromEntries(me.roster.filter(p => p.status === 'QUESTIONABLE' && notStarted(p)).map(p => [p.id, 1]));
// Starter who won't play (bye, out, doubtful, IR, suspended)
for (const p of starters(me)) {
  const bye = p.bye === week;
  if (decided.has(p.id) || !(bye || (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && notStarted(p)))) continue;
  alerts.push([`out:${week}:${p.id}`, `Bench ${p.name}`, `${bye ? 'His team has no game this week, so he\'d score 0.' : `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`} Your to-do list shows who to start instead.`, !bye && soon(p, 3)]);
}
// Better lineup, within 2.5 hours of kickoff, when both players can still be moved
for (const [i, p] of benchIn.entries()) {
  const out = sitOut[i];
  if ((out && !playable(out)) || decided.has(p.id)) continue; // the alerts above already cover it
  if (!notStarted(p) || (out && !notStarted(out)) || !(soon(p, 2.5) || (out && soon(out, 2.5)))) continue;
  if (p.proj - (out ? weekValue(out) : 0) < 2) continue;
  alerts.push([`start:${week}:${p.id}:${out?.id}`, `Start ${p.name}`, out ? `He's expected to score ${n(p.proj)}, more than ${out.name} (${n(weekValue(out))}). Games start soon.` : `You have an empty lineup spot. He's expected to score ${n(p.proj)}.`, true]);
}
// Trade offers to me
[...pendingTx.values()].forEach((tx, i) => {
  const m = pending[i];
  if (m.kind !== 'trade' || m.mineOffer) return;
  alerts.push([`trade:${tx.id}`, `Trade offer from ${m.them.name}`, `You'd give ${m.give.map(p => p.name).join(', ')} for ${m.take.map(p => p.name).join(', ')}. ${m.mine >= 0 ? 'Looks good for you' : 'Looks bad for you'} (${m.mine >= 0 ? '+' : ''}${n(m.mine)} points a week). Details in the app under Pending.`, false]);
});
// My waiver claims that failed in the last 3 days
for (const tx of myFailed) {
  if (Date.now() - (tx.processDate ?? 0) > 3 * 864e5) continue;
  const add = tx.items.find(i => i.type === 'ADD');
  alerts.push([`wfail:${tx.id}`, 'Waiver claim didn\'t go through', `You didn't get ${names[add?.playerId] ?? byId.get(add?.playerId)?.name ?? 'the player you claimed'}. Open the app for other pickups.`, false]);
}
// Waiver reminder Tuesday evening, before claims process overnight
const wplan = plan.find(x => x.add.wa);
if (etDay === 'Tue' && etHour >= 18 && wplan) {
  const s = wplan;
  alerts.push([`wrem:${week}`, 'Waivers run tonight', `Claim ${s.add.name} and drop ${s.drop.name}: ${s.kind === 'week' ? `about ${n(s.gain)} more points this week` : `about ${n(s.gain)} more points per week`}. More ideas in the app.`, false]);
}
// A source that's been down for 6+ hours (one alert per outage)
for (const src of Object.keys(memo.downSince)) if (!down.includes(src)) delete memo.downSince[src];
for (const src of down) {
  const since = (memo.downSince[src] ??= Date.now());
  if (Date.now() - since >= 6 * 3600e3) alerts.push([`down:${src}:${since}`, `${src} has been down for 6 hours`, 'Expected points are using the other sources. If it lasts another day, ask Claude to check it.', false]);
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
    out.push(`<span class="chip ${s[1]}">${s[0]}${p.inj?.type && p.inj.type !== 'Undisclosed' ? ` (${esc(p.inj.type.toLowerCase())})` : ''}${p.status === 'QUESTIONABLE' ? '' : when}${playOdds(p, p.inj?.type) ? ` &middot; ${playOdds(p, p.inj?.type).pct}% plays` : ''}</span>`);
  }
  if (p.split && !out.length) out.push(`<span class="chip warn">Experts disagree: ${srcText(p)}</span>`);
  return out.join(' ');
}
const ordinal = k => k + { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(k)];

// --- Why a player's numbers are what they are: injured teammates, depth chart, matchups. These explain the
// experts' projections (which already include all of this); they don't change any number, so nothing counts twice.
const slpBy = new Map(slp.map(x => [x.k, x]));
const POS_PL = { QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends' };
const usualBy = new Map();
for (const [k, name, pos, team, pts] of rosSaved.usual ?? []) (usualBy.get(`${team}|${pos}`) ?? usualBy.set(`${team}|${pos}`, []).get(`${team}|${pos}`)).push({ k, name, pos, pts });
for (const list of usualBy.values()) list.sort((a, b) => b.pts - a.pts);
// a team's usual starters = most points so far: 1 QB, 1 RB, 2 WR, 1 TE
const usualStarters = team => Object.entries({ QB: 1, RB: 1, WR: 2, TE: 1 }).flatMap(([pos, c]) => (usualBy.get(`${team}|${pos}`) ?? []).slice(0, c));
const qbThisWeek = team => slp.filter(x => x.team === team && x.pos === 'QB' && x.pts != null).sort((a, b) => b.pts - a.pts)[0];
// 1 = gives up the most points to that position
const defRank = (pos, team) => { const t = rosSaved.allowed?.[pos]; return t?.[team] == null ? null : Object.values(t).filter(v => v > t[team]).length + 1; };
const oppId = (p, wk) => { const g = pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[wk]?.[0]; return g && (g.homeProTeamId === p.proTeamId ? g.awayProTeamId : g.homeProTeamId); };
// Injury status: ESPN's (the league's own) wins when ESPN has the player; Sleeper's otherwise.
// Sleeper sometimes keeps last week's "Out" for days, so when the two disagree the note says so instead.
const SLP_OUT = ['Out', 'IR', 'Doubtful', 'Sus', 'PUP', 'COV'];
const ESPN_WORD = { OUT: 'is out', INJURY_RESERVE: 'is on IR', SUSPENSION: 'is suspended', DOUBTFUL: 'probably won\'t play', QUESTIONABLE: 'might not play' };
const SLP_WORD = { Questionable: 'might not play', Doubtful: 'probably won\'t play', IR: 'is on IR', Sus: 'is suspended' };
const espnStatus = new Map([...teams.flatMap(t => t.roster), ...allFa].map(p => [pkey(p.name, p.pos, p.team), p.status]));
function statusOf(k) {
  const e = espnStatus.get(k), sl = slpBy.get(k)?.inj ?? null;
  if (e === undefined) return { out: SLP_OUT.includes(sl), maybe: sl === 'Questionable', word: SLP_WORD[sl] ?? 'is out' };
  const out = [...HURT, 'DOUBTFUL'].includes(e);
  return { out, maybe: e === 'QUESTIONABLE', word: ESPN_WORD[e] ?? 'is healthy', espnSays: e,
    disagree: SLP_OUT.includes(sl) && !out ? `Injury reports disagree: ESPN says he ${ESPN_WORD[e] ?? 'is healthy'}, but Sleeper still lists him as ${sl === 'IR' ? 'on IR' : sl.toLowerCase()}. Check again before kickoff; teams announce who's out about 90 minutes before the game.` : null };
}
function notes(p) {
  const team = TEAM(p.team), k = pkey(p.name, p.pos, p.team), out = [], me_ = statusOf(k);
  if (me_.out) {
    const still = [['ESPN', p.espn], ['Rotowire', p.roto], ['CBS', p.cbs]].filter(([, v]) => v != null && v >= 3);
    if (still.length) out.push(`Experts haven't caught up: he ${me_.word}, but ${still.map(([src, v]) => `${src} still expects ${n(v)}`).join(' and ')}. ${HURT.includes(p.status) ? 'The site counts him as 0 this week.' : 'Don\'t start him unless that changes.'}`);
  } else if (me_.disagree) out.push(me_.disagree);
  if (!POS_PL[p.pos]) return out;
  if (p.pos === 'QB') {
    const q = qbThisWeek(team);
    if (q && q.k !== k && (slpBy.get(k)?.pts ?? 0) < q.pts / 2) out.push(`Not expected to start this week: ${q.name} is the starting QB.`);
  }
  for (const st of usualStarters(team)) {
    const now = statusOf(st.k);
    if (st.k === k || !(now.out || now.maybe)) continue;
    const sure = now.out, status = now.word;
    const lag = sure && (slpBy.get(st.k)?.pts ?? 0) >= 3 ? ` Experts still project ${st.name} as if he plays, so ${p.name}'s number may not reflect this yet.` : '';
    if (st.pos === 'QB' && p.pos !== 'QB') {
      const q = qbThisWeek(team);
      out.push(`His usual QB, ${st.name}, ${status}.${sure && q && q.k !== st.k ? ` ${q.name} is expected to start instead. A backup QB usually means fewer points for his teammates.` : ''}${lag}`);
    } else if (st.pos === p.pos) {
      out.push(`${st.name}, one of the team's usual starting ${POS_PL[p.pos]}, ${status}. ${sure ? 'That' : 'If he sits, that'} should mean more work for ${p.name}.${lag}`);
    } else if (p.pos === 'QB' && ['WR', 'TE'].includes(st.pos)) {
      out.push(`${st.name}, one of his usual top targets, ${status}.${lag}`);
    }
  }
  const teamsRanked = Object.keys(rosSaved.allowed?.[p.pos] ?? {}).length;
  const most = r => (r === 1 ? 'the most' : `the ${ordinal(r)}-most`), fewest = r => (r === 1 ? 'the fewest' : `the ${ordinal(r)}-fewest`);
  const o = p.bye === week ? null : oppId(p, week), r = o && defRank(p.pos, TEAM(proAbbr[o]));
  if (r && r <= 8) out.push(`Easy matchup this week: the ${proName[o]} give up ${most(r)} points to ${POS_PL[p.pos]}.`);
  else if (r && r > teamsRanked - 8) out.push(`Tough matchup this week: the ${proName[o]} give up ${fewest(teamsRanked - r + 1)} points to ${POS_PL[p.pos]}.`);
  const next = [1, 2, 3, 4].map(i => oppId(p, week + i)).filter(Boolean).map(id => defRank(p.pos, TEAM(proAbbr[id]))).filter(Boolean);
  const easy = next.filter(x => x <= 10).length, hard = next.filter(x => x > teamsRanked - 10).length;
  if (next.length >= 3 && easy >= 3) out.push(`Easy schedule ahead: ${easy} of his next ${next.length} games are against defenses that give up lots of points to ${POS_PL[p.pos]}.`);
  else if (next.length >= 3 && hard >= 3) out.push(`Tough schedule ahead: ${hard} of his next ${next.length} games are against defenses that give up few points to ${POS_PL[p.pos]}.`);
  return out;
}
// Tapping a player opens his detail sheet; every player shown is remembered so the sheet data
// (recent games, news, game time) is fetched for exactly those after the page is built.
// rank = how he compares at his position this season
const shown = new Map();
const player = (p, extra = '') => { shown.set(p.id, p); return `<div class="player" data-pid="${p.id}" role="button" tabindex="0">${pic(p)}<div class="who">
  <div class="name">${esc(p.name)} <span class="more">&rsaquo;</span></div>
  <div class="meta"><span class="pos pos-${p.pos.replace('/', '')}">${p.pos}</span> ${esc(p.teamName)}${p.bye ? ` &middot; bye wk ${p.bye}` : ''}</div>
  ${p.rank ? `<div class="rank">${ordinal(p.rank)}-best ${POS_NAME[p.pos]?.toLowerCase()} this season</div>` : ''}${chip(p)}${extra}</div></div>`; };
// a tappable player name in running text
const lnk = p => { shown.set(p.id, p); return `<span data-pid="${p.id}" class="lnk">${esc(p.name)}</span>`; };
// Top starter / starter / below starter: compared with what the league's starters at that position score. "Starter" = would
// start on a typical team here (16 teams x starting spots, FLEX split across RB/WR/TE); "top starter" = top third of those.
const tierPool = [...teams.flatMap(t => t.roster), ...allFa];
const startersAt = pos => teams.length * ((slotCounts[FA_SLOT[pos]] ?? 1) + (['RB', 'WR', 'TE'].includes(pos) ? (slotCounts[23] ?? 0) / 3 : 0));
const tierCut = {};
for (const kind of ['week', 'season']) for (const pos of Object.keys(FA_SLOT)) {
  const vals = tierPool.filter(p => p.pos === pos).map(kind === 'week' ? weekValue : seasonValue).sort((a, b) => b - a), k = startersAt(pos);
  tierCut[`${kind}|${pos}`] = [vals[Math.max(0, Math.floor(k / 3) - 1)] ?? Infinity, vals[Math.max(0, Math.floor(k) - 1)] ?? 0];
}
const tier = (v, p, kind) => { const c = p && tierCut[`${kind}|${p.pos}`]; return !c || !(v > 0) ? null : v >= c[0] ? ['good', 'top starter'] : v >= c[1] ? ['avg', 'starter'] : ['weak', 'below starter']; };
const big = (v, label, ceiling, p, kind) => { const t = tier(v, p, kind); return `<div class="big"><b${t ? ` class="t-${t[0]}"` : ''}>${n(v)}</b>${t ? `<small class="tw t-${t[0]}">${t[1]}</small>` : ''}<small>${label}</small>${ceiling > v + 1 ? `<small class="up">up to ${Math.round(ceiling)}</small>` : ''}</div>`; };

const myRank = [...teams].sort((a, b) => b.w - a.w || b.pf - a.pf).indexOf(me) + 1;
const standings = [...teams].sort((a, b) => b.w - a.w || b.pf - a.pf);
const cutWins = standings[playoffTeams - 1]?.w ?? 0;
const playoffLine = myRank <= playoffTeams ? `You're in a playoff spot. Top ${playoffTeams} make it.`
  : `Top ${playoffTeams} make the playoffs. ${cutWins - me.w <= 0 ? 'You have as many wins as the last playoff team, so it comes down to points.' : `You're ${cutWins - me.w} win${cutWins - me.w > 1 ? 's' : ''} behind.`}`;
const myProj = lineupProj(me);
const oppProj = opp ? lineupProj(opp) : 0;
// Win chance from the averaged projections. Each starter's score is treated as a bell curve around his
// projection, spread 65% of it (typical for one week). Once games start, ESPN's live estimate takes over.
// ponytail: fixed spread per player and no live per-player scores; ESPN's live number covers game time.
const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); return Math.sign(x) * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const spread = t => starters(t).reduce((s, p) => s + (0.65 * weekValue(p)) ** 2, 0);
const isLive = !!opp && (mySide.totalPointsLive > 0 || oppSide.totalPointsLive > 0);
const winPct = !opp ? 0 : isLive ? Math.round((mySide.winProbability ?? 0) * 100)
  : Math.round(50 * (1 + erf((myProj - oppProj) / Math.sqrt(2 * (spread(me) + spread(opp) || 1)))));
const fixedProj = best.total;
// projected score after pending claims and the to-do list (best lineup from that roster)
const planProj = score(baseRoster, weekValue) + weekPlanGain;
const lineupRows = [...me.roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
const levelName = { urgent: 'Do now', week: 'This week', later: 'Plan ahead' };

// Plain status words, shared by the "what changed" snapshot and the Claude facts
const statusWords = p => p.inj?.season ? 'out for the season' : p.bye === week ? 'on bye this week' : (STATUS[p.status] ? STATUS[p.status][0][0].toLowerCase() + STATUS[p.status][0].slice(1) : 'healthy');
// Snapshot of my roster; the page compares it with what you last marked as seen (kept in your browser)
const snap = Object.fromEntries(me.roster.map(p => [p.id, { n: p.name, s: statusWords(p), slot: p.slot === 'Bench' ? 'bench' : p.slot === 'IR' ? 'IR' : 'starting', pr: Math.round((p.proj ?? 0) * 10) / 10 }]));

// Everything Claude needs to answer questions about this team, as plain text to paste
const line = p => `${p.name} (${p.pos}, ${p.teamName}, bye wk ${p.bye ?? '?'}): expected ${n(weekValue(p))} this week${p.roto != null || p.cbs != null ? ` (${srcText(p)})` : ''}${p.vegas ? `, Vegas expects his team to score ${n(p.vegas)}` : ''}, ${n(p.avg)} per game so far, ${n(p.ros)} per game expected rest of season, ${statusWords(p)}${playOdds(p, p.inj?.type) ? ` (${playOdds(p, p.inj?.type).pct}% chance he plays: ${playOdds(p, p.inj?.type).why})` : ''}${p.rank ? `, ${ordinal(p.rank)} at ${p.pos}` : ''}${notes(p).length ? `. Notes: ${notes(p).join(' ')}` : ''}`;
const facts = [
  `My ESPN fantasy football league "${league.settings.name}": ${teams.length} teams, half-point PPR, lineup = ${Object.entries(slotCounts).filter(([id, k]) => k > 0 && SLOT_POS[id]).map(([id, k]) => `${k} ${SLOT[id]}`).join(', ')}, ${slotCounts[20]} bench, ${slotCounts[21] ?? 0} IR. Top ${playoffTeams} make the playoffs. It's week ${week}. "Expected" points average ESPN's, Rotowire's and CBS Sports' projections. Facts from ESPN, Sleeper (Rotowire), CBS Sports and DraftKings betting lines as of ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET.`,
  `My team: ${me.name}, ${me.w}-${me.l}, ${ordinal(myRank)} of ${teams.length}, ${ordinal(pfRank)} in points scored. I pick ${ordinal(me.waiver)} on waivers.`,
  opp ? `This week vs ${opp.name} (${opp.w}-${opp.l}): projected ${n(myProj)} to ${n(oppProj)}, win chance ${winPct}%${isLive ? ' (ESPN live estimate)' : ''}.` : '',
  `Starters:\n${starters(me).map(p => `- ${p.slot}: ${line(p)}`).join('\n')}`,
  `Bench:\n${me.roster.filter(p => p.slot === 'Bench').map(p => `- ${line(p)}`).join('\n')}`,
  me.roster.some(p => p.slot === 'IR') ? `IR:\n${me.roster.filter(p => p.slot === 'IR').map(p => `- ${line(p)}`).join('\n')}` : '',
  pending.length ? `Pending moves:\n${pending.map(m => m.kind === 'waiver' ? `- Waiver claim: add ${m.add.map(p => p.name).join(', ')}, drop ${m.drop.map(p => p.name).join(', ')}`
    : `- Trade ${m.mineOffer ? 'I offered' : 'offered to me by'} ${m.them.name}: I give ${m.give.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}; I get ${m.take.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}`).join('\n')}` : '',
  `Best free agents (points per game expected rest of season, expected this week):\n${Object.entries(fa).map(([pos, list]) => `- ${pos}: ${[...list].filter(p => !HURT.includes(p.status)).sort((a, b) => rate(b) - rate(a)).slice(0, 4).map(p => `${p.name} ${n(rate(p))}/g ahead, ${n(p.proj)} exp`).join('; ')}`).join('\n')}`,
  ahead.length ? `My remaining schedule: ${ahead.map(g => `wk ${g.week} ${g.t.name} (${g.t.w}-${g.t.l}, ${n(g.avg)} pts/wk)`).join('; ')}.` : '',
  '__NEWSFACTS__',
  'Explain things simply, I\'m new to football. My question:',
].filter(Boolean).join('\n\n');

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
--good:#12a150;--goodbg:#e3f6ea;--warn:#b26b00;--warnbg:#fff3d6;--bad:#d92d20;--badbg:#fde8e6;--chip:#f1f3f8;--glass:rgba(255,255,255,.62);--glassline:rgba(255,255,255,.7)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0f1c;--card:#141b2d;--fg:#eef1f7;--muted:#98a2b3;--line:#232c42;
--good:#3ccf7a;--goodbg:#10301f;--warn:#f5b84a;--warnbg:#33270d;--bad:#ff6b5e;--badbg:#3a1714;--chip:#1c2540;--glass:rgba(28,37,64,.55);--glassline:rgba(255,255,255,.12)}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:calc(env(safe-area-inset-top) + 12px)}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:0 16px calc(96px + env(safe-area-inset-bottom))}
body::before{content:'';position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top);z-index:6;background:var(--glass);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
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
/* Bottom bar, frosted glass like iOS. Fixed so it's always one tap away. */
nav{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 8px);max-width:696px;margin:0 auto;z-index:10;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:6px;border-radius:999px;background:var(--glass);border:1px solid var(--glassline);box-shadow:0 8px 30px rgba(0,0,0,.18);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
nav::-webkit-scrollbar{display:none}
nav a{flex:none;padding:9px 14px;border-radius:999px;color:var(--fg);text-decoration:none;font-weight:600;font-size:13px;transition:background .2s,color .2s}
nav a.on{background:var(--brand2);color:#fff}
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
.chip.bad{background:var(--badbg);color:var(--bad)}.chip.good{background:var(--goodbg);color:var(--good)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.row{display:flex;align-items:center;gap:10px}
.slot{flex:none;width:44px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase}
.big{flex:none;text-align:right}.big b{display:block;font-size:20px;font-weight:800;line-height:1.1}.big small{display:block;font-size:11px;color:var(--muted)}
.big small.up{color:var(--good);font-weight:600}
.big .t-good{color:var(--good)}.big .t-weak{color:var(--warn)}.big small.tw{font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:10px}
.rank{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{background:var(--brand2);color:#fff;border:0;border-radius:12px;padding:11px 16px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer;width:100%;margin-top:10px}
.ask{display:grid;gap:2px}
.chg{padding:8px 10px;border-radius:10px;margin-bottom:6px;font-size:14px;font-weight:600;background:var(--chip)}
.chg.good{background:var(--goodbg);color:var(--good)}.chg.bad{background:var(--badbg);color:var(--bad)}
.lnk{text-decoration:underline dotted;text-underline-offset:3px;color:var(--fg)}
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
  const live = isLive;
  const [a, b] = live ? [mySide.totalProjectedPointsLive, oppSide.totalProjectedPointsLive] : [myProj, oppProj];
  const wp = winPct;
  return `<div class="match"><h3>This week vs ${esc(opp.name)}${live ? '<span class="live">LIVE</span>' : ''}</h3>
  <div class="wp"><b style="color:${wp >= 50 ? 'var(--good)' : 'var(--bad)'}">${wp}%</b><span>chance you win <span class="tag">(${live ? 'ESPN live estimate' : 'from the averaged projections'})</span></span></div>
  ${live ? `<div class="tag" style="margin-bottom:8px">Score right now: <b>${n(mySide.totalPointsLive)}</b> to <b>${n(oppSide.totalPointsLive)}</b>. Final guess below.</div>` : ''}
  <div class="vs">
  <div class="t">You</div><div class="p">${n(a)}</div><div class="bar"><i style="width:${Math.min(100, a / Math.max(a, b, 1) * 100)}%;background:var(--brand2)"></i></div>
  <div class="t">${esc(opp.name)}</div><div class="p">${n(b)}</div><div class="bar"><i style="width:${Math.min(100, b / Math.max(a, b, 1) * 100)}%;background:var(--muted)"></i></div>
</div><div class="verdict">${a >= b ? `<b style="color:var(--good)">You're expected to win</b> by ${n((Math.round(a * 10) - Math.round(b * 10)) / 10)} points.` : `<b style="color:var(--bad)">You're expected to lose</b> by ${n((Math.round(b * 10) - Math.round(a * 10)) / 10)} points.`}
${!live && planProj > myProj + 0.5 ? ` ${claims.length ? (plan.length ? 'Your pending claims plus the to-do list get' : 'Your pending claims get') : 'Doing the to-do list below gets'} you to about <b>${n(planProj)}</b>.` : ''}</div>
<div class="tag" style="margin-top:6px">${esc(playoffLine)}</div></div>`;
})() : ''}
${down.length ? `<div class="card" style="background:var(--warnbg);border-color:var(--warn)"><b style="color:var(--warn)">&#9888; ${esc(down.join(' and '))} didn't load this time.</b>
<div class="tag">${down.includes('Vegas lines') && down.length === 1 ? 'Player notes won\'t say how many points Vegas expects his team to score.' : '"Expected" points use only the sources that worked, so they\'re a bit less reliable.'} It usually fixes itself on a later update. If this stays for a day, ask Claude to check it.</div></div>` : ''}

<nav><a href="#todo">To-do</a><a href="#news">News</a><a href="#lineup">My team</a><a href="#pickups">Pickups</a><a href="#pending">Pending</a><a href="#partners">Partners</a><a href="#trades">Trades</a><a href="#season">Season</a><a href="#league">League</a><a href="#help">How it works</a></nav>

<section id="changes" hidden><h2>What changed</h2><p class="sub">Since you last tapped "Got it".</p>
<div class="card"><div id="changelist"></div><button type="button" id="seen" class="btn">Got it</button></div></section>

<section id="ask"><div class="card ask"><div><b>Ask Claude about your team</b><p class="tag" style="margin:2px 0 0">Copies all your team's facts. Paste them into Claude, then type your question.</p></div>
<button type="button" id="askbtn" class="btn">Copy facts &amp; open Claude</button></div></section>

<section id="alerts" hidden><div class="card"><b>Phone alerts</b>
<p class="tag" style="margin:2px 0 0">Get a notification when a starter won't play, a hurt player's status is decided before kickoff, a trade offer comes in, and more.</p>
<button type="button" id="alertbtn" class="btn">Turn on alerts</button>
<div id="alertcode" hidden><p class="tag">Last step: copy this code, then in GitHub open your Fantasy-app repo &rsaquo; Settings &rsaquo; Secrets and variables &rsaquo; Actions &rsaquo; New repository secret. Name it <b>PUSH_SUB</b> and paste the code. You'll get an "Alerts are on" notification within a few minutes.</p>
<textarea id="alerttext" readonly rows="4" style="width:100%;font:12px monospace"></textarea>
<button type="button" id="alertcopy" class="btn">Copy code</button></div></div></section>

<section id="todo"><h2>To-do list</h2><p class="sub">Most important first. Do these in the ESPN app.</p>
${todo.length ? todo.map(([lvl, title, why]) => `<div class="card todo"><span class="lvl ${lvl}">${levelName[lvl]}</span><div><b>${esc(title)}</b><p>${esc(why)}</p></div></div>`).join('') : '<div class="card empty">You\'re all set this week.</div>'}
</section>

<section id="news"><h2>News</h2><p class="sub">Latest updates on your players and pickups, from Rotowire via ESPN. Tap a name for details.</p>
<div class="list">__NEWS__</div></section>

<section id="lineup"><h2>My team</h2><p class="sub">Big number = points he's expected to score this week (average of ESPN, Rotowire and CBS). Top starter, starter or below starter compares him with the players who start at his position across your league. Green "up to" = his score if he has a great game. Tap any player to see if he plays, when, his last games and news.</p>
${[['Starting', p => p.slot !== 'Bench' && p.slot !== 'IR'], ['Bench', p => p.slot === 'Bench'], ['Injured reserve', p => p.slot === 'IR']].map(([label, f]) => {
  const ps = lineupRows.filter(f);
  return ps.length ? `<div class="group">${label}</div><div class="list">${ps.map(p => `<div class="card row"><span class="slot">${p.slot === 'Bench' || p.slot === 'IR' ? '' : p.slot}</span>${player(p)}${big(weekValue(p), 'this week', weekValue(p) > 0 ? p.ceiling : null, p, 'week')}</div>`).join('')}</div>` : '';
}).join('')}
</section>

<section id="pickups"><h2>Pickup plan</h2><p class="sub">Do these in order. Each step swaps one player for one free player nobody in your league has. In ESPN: Players &rarr; find him &rarr; Add.</p>
<div class="card"><div class="vhead"><span class="group" style="margin:0">Waiver order</span><span class="verdict-meh">You pick ${ordinal(me.waiver)} of ${teams.length}</span></div>
<div class="worder">${[...teams].sort((a, b) => a.waiver - b.waiver).map(t => `<span class="${t === me ? 'me' : t.waiver < me.waiver ? 'ahead' : ''}">${t.waiver}. ${esc(t.name)}</span>`).join('')}</div>
<p class="tag" style="margin-bottom:0">When two teams claim the same player, the one higher on this list gets him. ${me.waiver > 1 ? `${me.waiver - 1} team${me.waiver > 2 ? 's' : ''} pick before you.` : 'You pick first.'} Free agents (not on waivers) go to whoever adds them first.</p></div>
${plan.length ? plan.map((s, i) => { const wk = s.kind === 'week'; return `<div class="card">
  <div class="group" style="margin:0 0 10px">Step ${i + 1} &middot; ${wk ? 'helps this week' : 'helps rest of season'}</div>
  <div class="row">${player(s.add)}${big(wk ? s.add.proj : rate(s.add), wk ? 'this week' : 'per game, rest of season', null, s.add, wk ? 'week' : 'season')}</div>
  <p class="why"><span class="gain">+${n(s.gain)}</span> ${wk ? 'more points this week' : 'more points per week'}. To make room, drop <b>${esc(s.drop.name)}</b> (${n(wk ? weekValue(s.drop) : rate(s.drop))} ${wk ? 'this week' : 'per game, rest of season'}).<br>
  <span class="tag">${s.add.wa ? 'On waivers: your claim goes through in about a day.' : 'Free agent: yours right away.'}</span>
  ${s.add.wa ? (() => { const r = rivalsFor(s.add, wk ? weekValue : seasonValue); return r.length
    ? `<br><span class="tag" style="color:var(--warn)">${r.length} team${r.length > 1 ? 's' : ''} that pick${r.length > 1 ? '' : 's'} before you could use him too: ${r.slice(0, 3).map(t => esc(t.name)).join(', ')}${r.length > 3 ? '&hellip;' : ''}.</span>`
    : '<br><span class="tag" style="color:var(--good)">No team that picks before you needs him, so you\'ll probably get him.</span>'; })() : ''}
  ${notes(s.add).map(t => `<br><span class="tag">&#9432; ${esc(t)}</span>`).join('')}
  ${s.alts.length ? `<br><span class="tag">If someone else gets him first, take ${s.alts.map(a => `<b>${esc(a.add.name)}</b> (${n(wk ? a.add.proj : rate(a.add))})`).join(' or ')} instead.</span>` : ''}</p></div>`; }).join('')
  : `<div class="card empty">Nobody out there beats what you have${claims.length ? ', counting your pending claims (see Pending)' : ''}.</div>`}
${trending.length ? `<div class="group">Trending: being picked up fast in other leagues</div><div class="list">${trending.slice(0, 5).map(p => `<div class="card row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
<p class="tag">Often means news broke (an injury ahead of him, a bigger role). Not always worth it for you, but worth a look.</p>` : ''}
</section>

<section id="pending"><h2>Your pending moves</h2><p class="sub">Waiver claims and trade offers that haven't gone through yet, checked with the same math as everything else.</p>
${pending.length ? pending.map(m => {
  if (m.kind === 'waiver') {
    const v = m.week >= 1 || m.season >= 1 ? ['good', 'Good claim'] : m.week <= -1 || m.season <= -1 ? ['bad', 'Bad claim, cancel it'] : ['meh', 'Barely matters'];
    return `<div class="card"><div class="vhead"><span class="tag">Waiver claim</span><span class="verdict-${v[0]}">${v[1]}</span></div>
    <div class="swap">${m.add.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}<div class="arrow">drop</div>${m.drop.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
    <p class="why"><b>${Math.abs(m.week) < 0.5 ? 'No change this week' : `${m.week > 0 ? 'Adds' : 'Costs'} about ${n(Math.abs(m.week))} points this week`}${Math.abs(m.season) < 0.5 ? ', about the same after that.' : `, and ${m.season > 0 ? 'adds' : 'costs'} about ${n(Math.abs(m.season))} a week after that.`}</b></p></div>`;
  }
  const v = m.mine >= 1 ? ['good', m.mineOffer ? 'Good for you' : 'Good for you: accept'] : m.mine <= -1 ? ['bad', m.mineOffer ? 'Bad for you: cancel it' : 'Bad for you: decline'] : ['meh', 'About even'];
  const lost = [...new Set(m.give.map(p => p.pos))].map(pos => { const s = starterAt(m.after, pos); return s && !m.give.includes(s) ? `your ${POS_NAME[pos]?.toLowerCase()} would be ${esc(s.name)} (${n(rate(s))})` : `you'd have no ${POS_NAME[pos]?.toLowerCase()}`; });
  return `<div class="card"><div class="vhead"><span class="tag">${m.mineOffer ? 'You offered' : 'Offered to you by'} <b>${esc(m.them.name)}</b></span><span class="verdict-${v[0]}">${v[1]}</span></div>
  <div class="swap"><div class="arrow">you give</div>${m.give.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}
  <div class="arrow">you get</div>${m.take.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
  <p class="why"><b style="color:var(--${v[0] === 'meh' ? 'fg' : v[0]})">${Math.abs(m.mine) < 1 ? 'About even for you' : `You'd ${m.mine > 0 ? 'gain' : 'lose'} about ${Math.round(Math.abs(m.mine))} point${Math.round(Math.abs(m.mine)) === 1 ? '' : 's'} a week`} for the rest of the season.</b>
  ${Math.abs(m.mineWeek) >= 1 ? `This week alone: ${m.mineWeek > 0 ? '+' : ''}${n(m.mineWeek)} points.` : ''} They'd ${Math.abs(m.theirs) < 1 ? 'come out about even' : `${m.theirs > 0 ? 'gain' : 'lose'} about ${Math.round(Math.abs(m.theirs))} a week`}.
  ${m.mineWeek > 2 && m.mine < -1 ? '<br><b>Trap:</b> it only helps this week (your players are on bye or hurt). After that you\'re worse off.' : ''}
  ${lost.length ? `<br>After the trade, ${lost.join('; ')}.` : ''}
  ${m.vorTake < m.vorGive * 0.7 ? '<br>You\'re giving up more real value than you get back.' : m.vorTake > m.vorGive * 1.3 ? '<br>You get more real value than you give.' : ''}</p></div>`;
}).join('') : '<div class="card empty">Nothing pending right now.</div>'}
</section>

<section id="partners"><h2>Trade partners</h2><p class="sub">Who's short at a position and who has extra. The best trades are with teams that have extra of what you're short on, and are short on what you have extra of.</p>
<div class="card"><div class="group" style="margin:0 0 6px">Your team</div>
<p class="why" style="margin:0">Short on: <b>${myDepth.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}</b>. Extra: <b>${myDepth.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(p => esc(p.name)).join(', ')})`).join('; ') || 'nothing'}</b>.</p></div>
<div class="list">${partners.map(d => `<div class="card"><div class="vhead"><b>${esc(d.t.name)}</b>${d.theyHave.length && d.youHave.length ? '<span class="verdict-good">Good match</span>' : d.theyHave.length ? '<span class="verdict-meh">Has what you need</span>' : ''}</div>
  <div class="worder" style="margin:0 0 6px"><span>Has:</span>${Object.entries(d.count).map(([pos, k]) => `<span>${k} ${pos}${k === 1 ? '' : 's'}</span>`).join('')}</div>
  <p class="tag" style="margin:0">Short on: ${d.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}.
  ${d.extra.length ? `Extra: ${d.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(lnk).join(', ')})`).join('; ')}.` : 'No extra starters.'}
  ${d.theyHave.length && d.youHave.length ? `<br><b style="color:var(--good)">Pitch:</b> your extra ${d.youHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')} for their extra ${d.theyHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')}.` : ''}</p></div>`).join('')}</div>
</section>

<section id="trades"><h2>Trade ideas</h2><p class="sub">Swaps worth 2+ points a week to you that the other team could see as fair. "Value" counts how hard a player is to replace, so stars at scarce spots like tight end count extra. Offer them in ESPN under Trade.</p>
${topTrades.length ? topTrades.map(t => { const s = starterAt(t.after, t.give.pos); return `<div class="card"><div class="tag" style="margin-bottom:8px">with <b>${esc(t.team.name)}</b></div><div class="swap">
  <div class="row">${player(t.give, '')}${big(rate(t.give), 'per game, rest of season', null, t.give, 'season')}</div>
  <div class="arrow">for</div>
  <div class="row">${player(t.take, '')}${big(rate(t.take), 'per game, rest of season', null, t.take, 'season')}</div></div>
  <p class="why"><span class="gain">+${n(t.mine)}</span> points per week for you. You get a ${POS_NAME[t.take.pos].toLowerCase()}; they get a ${POS_NAME[t.give.pos].toLowerCase()}${t.theirs > 0.2 ? `, which helps them too (+${n(t.theirs)})` : ''}.
  <br>Your ${POS_NAME[t.give.pos].toLowerCase()} after: ${s ? `${esc(s.name)} (${n(rate(s))} per game, rest of season)` : 'nobody, so you\'d need to pick one up'}.</p></div>`; }).join('') : '<div class="card empty">No trades right now that clearly help you and look fair to the other team.</div>'}
</section>

<section id="season"><h2>Season outlook</h2><p class="sub">How you've really played, and who's coming up.</p>
<div class="card"><div class="group" style="margin:0 0 10px">Luck check</div><div class="stat">
  <div><b>${me.w}-${me.l}</b><small>your real record</small></div>
  <div><b>${apW} of ${apW + apL}</b><small>matchups you'd have won if you played every team every week</small></div>
  <div><b>${ordinal(pfRank)}</b><small>most points of ${teams.length} teams</small></div>
  <div><b>${Math.round(me.pf / gamesPlayed)}</b><small>your points per week (league average: ${Math.round(leagueAvg)})</small></div></div>
  <p class="why">${apPct > realPct + 0.08 ? 'You\'ve been <b>unlucky</b>: you\'ve played better than your record shows, so wins should come.'
    : apPct < realPct - 0.08 ? 'You\'ve been <b>lucky</b>: your record is better than your points. Keep improving the lineup.'
    : 'Your record matches how you\'ve played.'}${pfRank > teams.length / 2 ? ' Your team scores less than most, so pickups and trades matter.' : ''}</p></div>
${ahead.length ? `<div class="card"><div class="group" style="margin:0 0 4px">Your schedule ahead</div><table>
${ahead.map(g => `<tr><td class="num" style="text-align:left">Wk ${g.week}</td><td>${esc(g.t.name)} <span class="tag">${g.t.w}-${g.t.l}</span></td><td class="num">scores ~${Math.round(g.avg)}/wk</td><td style="text-align:right"><span class="lv ${g.level}">${g.level}</span></td></tr>`).join('')}</table>
<p class="tag">Hard = they score a lot more than average. Easy weeks are the ones you should win.</p></div>` : ''}
</section>

<section id="league"><h2>League</h2><p class="sub">Dashed line = playoff cutoff. Waiver # = who gets first pick of new players (1 goes first).</p>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">W-L</td><td class="num">Points</td><td class="num">Waiver #</td></tr>
${standings.map((t, i) => `<tr class="${t === me ? 'me' : ''} ${i + 1 === playoffTeams ? 'cut' : ''}"><td class="num" style="text-align:left">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.w}-${t.l}</td><td class="num">${Math.round(t.pf)}</td><td class="num">${t.waiver}</td></tr>`).join('')}</table></div>
${intel.size || othersPending.size ? `<div class="card"><details open><summary>Behind the scenes: offers and claims that didn't happen</summary>
<p class="tag" style="margin-top:0">The ESPN app doesn't show these. A team that offered a player in a trade is shopping him; a team that tried to claim someone needs that position.</p><table>
${[...othersPending.values(), ...[...intel.values()].sort((a, b) => b.proposedDate - a.proposedDate)].slice(0, 20).map(tx => {
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
<dt>Expected points</dt><dd>How many points a player should score this week: the average of ESPN's, Rotowire's and CBS's guesses. It's a guess, not a promise, but it's the best simple way to decide who to start.</dd>
<dt>Top starter, starter, below starter</dt><dd>How a number compares with the players who start at that position across your league. <b>Top starter</b>: top third of them. <b>Starter</b>: good enough to start on a typical team. <b>Below starter</b>: less than that. You may still have to start him if he is your best option.</dd>
<dt>"Up to" number</dt><dd>What he'd score if he has a great game. A big gap between expected and "up to" means he's boom-or-bust.</dd>
<dt>Win chance</dt><dd>How likely you are to win this week, worked out from the same averaged projections (ESPN, Rotowire, CBS) as the scores. Once games start it switches to ESPN's live estimate, which follows the real score.</dd>
<dt>Points per game</dt><dd>How many points he's actually scored each week on average this season.</dd>
<dt>Per game, rest of season</dt><dd>How many points per game ESPN, Rotowire and CBS expect from him for the rest of the season, averaged. Season pickups and trades use this, because it accounts for injuries, new roles and schedule, not just past games.</dd>
<dt>Bye week</dt><dd>Each NFL team gets one week off. A player on bye scores 0, so never start him that week.</dd>
<dt>Injury tags</dt><dd><b>Might not play</b> (questionable): about 7 in 10 of these players end up playing. The % on each player uses his practices this week from the official NFL injury report: 86% play after a full practice, 71% after a limited one, 29% after none. <b>Probably won't play</b> (doubtful): only about 1 in 15 play. (From Footballguys' count of QB, RB, WR and TE injury reports, 2017 to 2024.) <b>Out</b>: won't play. <b>IR</b>: hurt for weeks; move him to your IR spot so he doesn't take up a bench spot.</dd>
<dt>Waivers vs free agents</dt><dd>Recently dropped players go on <b>waivers</b> for about a day. Everyone can claim them, and the team with the best waiver # gets him. After that he's a <b>free agent</b>: first to add him gets him.</dd>
<dt>Scoring in this league</dt><dd>Half-point PPR: players get half a point for every catch, on top of points for yards and touchdowns.</dd>
<dt>Where these tips come from</dt><dd>"Expected" points are the average of ESPN's, Rotowire's and CBS Sports' projections, and Vegas betting lines show which games should be high-scoring. Season stats come from ESPN. Breaking news can take a while to reach these sources, so for big decisions it's worth a second opinion.</dd>
</dl></div></section>

<footer>Updated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET &middot; new data about every 3 minutes &middot; this page checks for it every minute</footer>
</div>
<div id="sheet" hidden><div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true"><button class="sheet-x" type="button" data-close aria-label="Close">&times;</button><div class="sheet-body"></div></div></div>
<script type="application/json" id="pdata">__PDATA__</script>
<script type="application/json" id="snap">${JSON.stringify(snap).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="facts">${JSON.stringify(facts).replace(/</g, '\\u003c')}</script>
<script>
// Load the newest build when there is one: on the button, every minute, and when you come back to the app.
// GitHub caches pages ~10 min, so a timestamped URL is used to skip the cache.
const built = +document.querySelector('meta[name=built]').content;
const btn = document.getElementById('refresh'), ago = document.getElementById('ago');
const fresh = () => location.pathname + '?t=' + Date.now();
// cron-job.org starts a run on each 3-minute mark and it takes ~90s to publish, so the next
// update is the mark after the one that made this build, plus 90s. GitHub can run late; then "any moment".
const STEP = 3 * 60000, PUBLISH = 90000;
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
    (p.sources ? '<div class="group">Where "expected" comes from</div><p class="why" style="margin:0">' + e(p.sources) + '</p>' : '') +
    (p.notes.length ? '<div class="group">What&rsquo;s affecting him</div>' + p.notes.map(t => '<p class="why" style="margin:0 0 6px">' + e(t) + '</p>').join('') : '') +
    (p.rosText ? '<div class="group">Rest of the season</div><p class="why" style="margin:0">' + e(p.rosText) + '</p>' : '') +
    (p.games.length ? '<div class="group">Last games (fantasy points)</div><div class="bars">' + p.games.map(g =>
      '<div><i style="height:' + (g.pts == null ? 0 : Math.max(4, g.pts / max * 64)) + 'px"></i><b>' + (g.pts == null ? e(g.note) : g.pts.toFixed(1)) + '</b><small>wk ' + g.wk + '</small></div>').join('') + '</div>' : '') +
    '<div class="group">Bye week</div><p class="why" style="margin:0">' + e(p.byeText) + '</p>' +
    (p.news.length ? '<div class="group">Latest news</div>' + p.news.map(x => '<a class="news" href="' + e(x.url) + '" target="_blank" rel="noopener"><b>' + e(x.h) + '</b><small>' + e(x.when) + ' &rsaquo;</small></a>').join('') : '') +
    (p.id > 0 ? '<a class="news" href="https://www.espn.com/nfl/player/_/id/' + p.id + '" target="_blank" rel="noopener"><b>Full stats and news on ESPN</b><small>opens ESPN &rsaquo;</small></a>' : '');
}
function openSheet(id) { const p = P[id]; if (!p) return; body.innerHTML = render(p); sheet.hidden = false; body.scrollTop = 0; document.body.style.overflow = 'hidden'; }
// Highlight the bottom-bar button for the section on screen
const navLinks = [...document.querySelectorAll('nav a')];
const spy = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  navLinks.forEach(a => a.classList.toggle('on', a.hash === '#' + e.target.id));
  const on = navLinks.find(a => a.classList.contains('on'));
  const bar = on && on.parentNode;
  if (on) bar.scrollTo({ left: on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
}), { rootMargin: '-30% 0px -60% 0px' });
navLinks.forEach(a => { const t = document.querySelector(a.hash); if (t) spy.observe(t); });
function closeSheet() { sheet.hidden = true; document.body.style.overflow = ''; }

// What changed since you last tapped "Got it". The last-seen copy lives only in this browser.
const SNAP = JSON.parse(document.getElementById('snap').textContent);
let seenSnap = null;
try { seenSnap = JSON.parse(localStorage.getItem('seenSnap')); } catch {}
const saveSeen = () => { try { localStorage.setItem('seenSnap', JSON.stringify(SNAP)); } catch {} };
if (!seenSnap) saveSeen();
else {
  const out = [];
  for (const [id, now] of Object.entries(SNAP)) {
    const was = seenSnap[id];
    if (!was) { out.push(['good', now.n + ' joined your team']); continue; }
    if (was.s !== now.s) out.push([now.s === 'healthy' ? 'good' : 'bad', now.n + ': ' + was.s + ' → ' + now.s]);
    if (was.slot !== now.slot) out.push(['meh', now.n + ': ' + was.slot + ' → ' + now.slot]);
    if (Math.abs(was.pr - now.pr) >= 3) out.push([now.pr > was.pr ? 'good' : 'bad', now.n + ': expected points ' + was.pr + ' → ' + now.pr]);
  }
  for (const [id, was] of Object.entries(seenSnap)) if (!SNAP[id]) out.push(['meh', was.n + ' left your team']);
  if (out.length) {
    document.getElementById('changelist').innerHTML = out.map(([k, t]) => '<div class="chg ' + k + '">' + e(t) + '</div>').join('');
    document.getElementById('changes').hidden = false;
  }
}
document.getElementById('seen').onclick = () => { saveSeen(); document.getElementById('changes').hidden = true; };

// Ask Claude: copy the facts, then open Claude to paste them
// Phone alerts: work in the Home Screen app (iPhone needs iOS 16.4+). The code it shows goes into GitHub as the PUSH_SUB secret.
if ('serviceWorker' in navigator && 'PushManager' in window) {
  const btn = document.getElementById('alertbtn');
  const show = sub => { document.getElementById('alerttext').value = JSON.stringify(sub); document.getElementById('alertcode').hidden = false; };
  navigator.serviceWorker.register('sw.js');
  // the card only shows until this phone is signed up (it comes back by itself if the app is reinstalled)
  navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => { if (!s) document.getElementById('alerts').hidden = false; });
  btn.onclick = async () => {
    if (await Notification.requestPermission() !== 'granted') { btn.textContent = 'Alerts are blocked. Turn them on in iPhone Settings > Notifications'; return; }
    const key = Uint8Array.from(atob('${VAPID_PUBLIC}'.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    show(await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  };
  document.getElementById('alertcopy').onclick = async () => {
    const t = document.getElementById('alerttext');
    try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
    document.getElementById('alertcopy').textContent = '✓ Copied';
  };
}
document.getElementById('askbtn').onclick = async () => {
  const facts = JSON.parse(document.getElementById('facts').textContent);
  const b = document.getElementById('askbtn');
  try { await navigator.clipboard.writeText(facts); b.textContent = '✓ Copied! Paste it in Claude'; }
  catch { prompt('Copy this, then paste it into Claude:', facts); }
  window.open('https://claude.ai/new', '_blank', 'noopener');
  setTimeout(() => (b.innerHTML = 'Copy facts &amp; open Claude'), 4000);
};
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
// Plain-English tag for a Rotowire player update, read from its headline. First match wins, so "ruled out" beats "questionable".
const NEWS_TAGS = [
  ['Out for season', 'bad', /season-ending|out for the (rest of the )?season|miss the rest of the season|\btorn (acl|achilles|patellar)|\btore (his )?((left|right) )?(acl|achilles|patellar)/i],
  ['Out', 'bad', /ruled out|won't play|will not play|\bis inactive\b|placed on (injured reserve|ir)\b|won't suit up/i],
  ['Starting', 'good', /will start|expected to start|in line to start|named (the )?starter|take over as the starter/i],
  ['Playing', 'good', /\b(is|listed as) active\b|will play|in line to play|expected to play|cleared to play|good to go|off the injury report|activated/i],
  ["Didn't practice", 'bad', /did not practice|didn't practice|not practicing|sat out practice|held out of practice|absent from practice/i],
  ['Limited in practice', 'warn', /limited/i],
  ['Full practice', 'good', /full participant|practiced fully|full practice|full participation/i],
  ['Hurt in game', 'bad', /\bleft .*(game|contest)\b.*injur|\bexited\b|injured (in|during)/i],
  ['Doubtful', 'bad', /doubtful/i],
  ['Questionable', 'warn', /questionable/i],
  ['Roster move', 'warn', /traded|released|waived|signed|claimed/i],
];
const newsTag = h => NEWS_TAGS.find(([, , re]) => re.test(h)) ?? null;
const blurbs = new Map(); // player id -> his Rotowire updates: { id, h (headline), t (published ms), tag }
const news = new Map(await Promise.all(ids.filter(id => id > 0).map(async id => {
  try {
    const r = await fetch(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=6&playerId=${id}`);
    const feed = (await r.json()).feed ?? [];
    blurbs.set(id, feed.filter(x => x.type === 'Rotowire' && x.headline).map(x => ({ id: x.id, h: x.headline, t: Date.parse(x.published), tag: newsTag(x.headline) })));
    const last = (shown.get(id).name.split(' ').filter(w => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop() ?? '').toLowerCase();
    // player notes (his name in the headline) before general articles that only mention him
    const items = feed.filter(x => x.headline && (x.headline + ' ' + (x.story ?? '')).toLowerCase().includes(last))
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
const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60e3)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const myIds = new Set(me.roster.map(p => p.id)), watchIds = new Set([...plan.map(s => s.add.id), ...claims.flatMap(m => m.add.map(a => a.id))]);
const feedItems = [...blurbs].filter(([id]) => myIds.has(id) || watchIds.has(id))
  .flatMap(([id, xs]) => xs.map(x => ({ ...x, p: shown.get(id) }))).filter(x => x.p && Date.now() - x.t < 7 * 864e5).sort((a, b) => b.t - a.t).slice(0, 15);
html = html.replace('__NEWS__', () => feedItems.length ? feedItems.map(x => `<div class="card"><div class="vhead">${lnk(x.p)}${x.tag ? `<span class="chip ${x.tag[1]}" style="margin:0">${x.tag[0]}</span>` : ''}</div>
  <p class="why" style="margin:6px 0 2px">${esc(x.h)}</p><span class="tag">${ago(x.t)}${watchIds.has(x.p.id) && !myIds.has(x.p.id) ? ' &middot; pickup' : ''}</span></div>`).join('') : '<div class="card empty">No news on your players in the last week.</div>');
// ...and for Claude
const newsFacts = feedItems.length ? `Recent news on my players and pickups (Rotowire):\n${feedItems.map(x => `- ${x.p.name}, ${ago(x.t)}: ${x.h}`).join('\n')}` : 'No news on my players in the last week.';
html = html.replace('__NEWSFACTS__', () => JSON.stringify(newsFacts).slice(1, -1).replace(/</g, '\\u003c'));
// 3. Breaking news on my players (last 6 hours, once each): ruled out, starting, or playing after being in doubt
const NEWS_SAYS = { Out: 'is out', 'Out for season': 'is out for the season', Starting: 'is starting', Playing: 'is playing' };
for (const p of me.roster) for (const x of blurbs.get(p.id) ?? []) {
  if (!x.tag || !NEWS_SAYS[x.tag[0]] || Date.now() - x.t > 6 * 3600e3 || decided.has(p.id)) continue;
  if (x.tag[0] === 'Playing' && !['QUESTIONABLE', 'DOUBTFUL'].includes(p.status)) continue; // only news if he was in doubt
  const act = x.tag[1] === 'bad' && isStarter(p) && !locked(p);
  alerts.push([`news:${x.id}`, `${p.name} ${NEWS_SAYS[x.tag[0]]}`, `${x.h}${act ? ' He\'s in your lineup, so check your to-do list.' : ''}`, act]);
}
const pdata = {};
for (const [id, p] of shown) {
  const c = card.get(id), inj = p.inj ?? (c?.injuryDetails && { type: c.injuryDetails.type, season: c.injuryDetails.outForSeason, back: c.injuryDetails.expectedReturnDate && new Date(c.injuryDetails.expectedReturnDate[0], c.injuryDetails.expectedReturnDate[1] - 1, c.injuryDetails.expectedReturnDate[2]) });
  const hurtType = inj?.type && inj.type !== 'Undisclosed' ? ` (${inj.type.toLowerCase()})` : '';
  const back = inj?.back && inj.back > Date.now() ? ` Expected back around ${dateStr(inj.back)}.` : '';
  const play = inj?.season ? ['no', `No. He's out for the season${hurtType}.`]
    : p.bye === week ? ['no', 'No. His team has no game this week (bye week).']
    : ['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(p.status) ? ['no', `No. ${STATUS[p.status][0]}${hurtType}.${back}`]
    : p.status === 'DOUBTFUL' ? ['no', `Probably not${hurtType}: ${playOdds(p, inj?.type).pct}% chance he plays. ${playOdds(p, inj?.type).why[0].toUpperCase()}${playOdds(p, inj?.type).why.slice(1)}, so plan to bench him.`]
    : p.status === 'QUESTIONABLE' ? ['maybe', `${playOdds(p, inj?.type).pct >= 60 ? 'Probably' : playOdds(p, inj?.type).pct >= 40 ? 'Maybe' : 'Probably not'}${hurtType}: ${playOdds(p, inj?.type).pct}% chance he plays. ${playOdds(p, inj?.type).why[0].toUpperCase()}${playOdds(p, inj?.type).why.slice(1)}. Teams say who's out about 90 minutes before kickoff, so check then.`]
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
  const sources = [
    p.roto != null || p.cbs != null ? `${srcText(p)}. We use the average. ${p.split ? 'They disagree a lot, so he\'s a riskier start than the number looks.' : 'They mostly agree.'}` : p.espn != null ? `Only ESPN has a number for him (${n(p.espn)}).` : '',
    p.vegas && p.pos !== 'D/ST' && p.bye !== week ? `Vegas expects his team to score about ${Math.round(p.vegas)} points, ${p.vegas >= vegasAvg + 3 ? 'one of the higher totals this week. Good for him.' : p.vegas <= vegasAvg - 3 ? 'one of the lower totals this week. Bad for him.' : 'about average this week.'}` : '',
  ].filter(Boolean).join(' ');
  pdata[id] = {
    id, name: p.name, posName: POS_NAME[p.pos] ?? p.pos, teamName: p.teamName,
    owner: mine ? 'On your team' : t ? `On ${t.name}` : 'Free: nobody in your league has him',
    play, advice, game: p.bye === week ? '' : gameText(p), proj: n(p.proj), ceiling: p.ceiling > (p.proj ?? 0) + 1 ? Math.round(p.ceiling) : null,
    avg: n(p.avg), rank: p.rank ? `${ordinal(p.rank)}` : '-', started: c?.ownership?.percentStarted != null ? `${Math.round(c.ownership.percentStarted)}%` : '-',
    trend, sources, games, notes: notes(p),
    rosText: p.ros == null ? '' : `Expected ${n(p.ros)} points per game from here on (${[['ESPN', p.rosBy[0]], ['Rotowire', p.rosBy[1]], ['CBS', p.rosBy[2]]].filter(([, v]) => v != null).map(([src, v]) => `${src} ${n(v)}`).join(', ')}). Season pickups and trades use this.`, news: news.get(id) ?? [],
    byeText: !p.bye ? 'No bye listed.' : p.bye < week ? `Week ${p.bye}, already done. He plays every week from now on.` : p.bye === week ? 'This week. He won\'t play.' : `Week ${p.bye}. He won't play that week, so you'll need someone else.`,
  };
  // a defense is a whole team: "they", not "he"
  if (p.pos === 'D/ST') for (const k of ['play', 'advice']) if (pdata[id][k]) pdata[id][k] = [pdata[id][k][0], pdata[id][k][1].replace(/\bhe's\b/gi, 'they\'re').replace(/\bHe\b/g, 'They').replace(/\bhim\b/g, 'them')];
  if (p.pos === 'D/ST') pdata[id].sources = sources.replace(/he's a riskier/, 'they\'re a riskier').replace(/for him \(/, 'for them (');
  if (p.pos === 'D/ST') pdata[id].byeText = pdata[id].byeText.replace(/He plays/, 'They play').replace(/He won't/g, 'They won\'t').replace(/he won't/g, 'they won\'t');
}
html = html.replace('__PDATA__', JSON.stringify(pdata).replace(/</g, '\\u003c'));

fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), html);
// App icons (Home Screen, browser tab) and the manifest that names the installed app
fs.cpSync(path.join(dir, 'icons'), path.join(dir, 'site'), { recursive: true });
if (cbsSaved) fs.writeFileSync(path.join(dir, 'site', 'cbs.json'), JSON.stringify(cbsSaved));
fs.writeFileSync(path.join(dir, 'site', 'ros.json'), JSON.stringify(rosSaved));
fs.copyFileSync(path.join(dir, 'sw.js'), path.join(dir, 'site', 'sw.js'));

// Send new alerts. Needs GitHub secrets PUSH_SUB (code from the app's "Turn on alerts") and VAPID_PRIVATE.
if (process.env.PUSH_SUB && process.env.VAPID_PRIVATE) {
  // Without the memory of what was sent, every alert would go out again, so stop and keep the old page instead
  if (!memoOk) throw new Error('Could not read alerts.json, so alerts were not sent (this run is skipped)');
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails('https://mrbrofo.github.io/Fantasy-app/', VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const awake = etHour >= 8 && etHour < 23;
  for (const [key, title, body, urgent] of alerts) {
    if (memo.sent[key] || !(urgent || awake)) continue;
    try { await webpush.sendNotification(JSON.parse(process.env.PUSH_SUB), JSON.stringify({ title, body, tag: key })); memo.sent[key] = Date.now(); console.log(`Alert sent: ${title}`); }
    catch (err) { console.warn(`Alert not sent (${err.statusCode ?? err.message}): ${title}`); }
  }
}
for (const [k, t] of Object.entries(memo.sent)) if (Date.now() - t > 21 * 864e5) delete memo.sent[k]; // forget after 3 weeks
fs.writeFileSync(path.join(dir, 'site', 'alerts.json'), JSON.stringify(memo));
fs.mkdirSync(path.dirname(memoFile), { recursive: true });
fs.writeFileSync(memoFile, JSON.stringify(memo));
// TEMP: league settings and last week's box score shape, to build the waiver reminder and weekly recap. Remove after.
try {
  const bx = await get(`${LEAGUE}?view=mBoxscore&view=mMatchupScore&scoringPeriodId=${week - 1}`);
  const g = bx.schedule.find(x => x.matchupPeriodId === week - 1 && (x.home?.teamId === me.id || x.away?.teamId === me.id));
  const side = g && (g.home.teamId === me.id ? g.home : g.away);
  fs.writeFileSync(path.join(dir, 'site', 'debug.json'), JSON.stringify({
    acq: league.settings.acquisitionSettings, sched: league.settings.scheduleSettings,
    sideKeys: side && Object.keys(side), rosterKeys: side && Object.keys(side).filter(k => /roster/i.test(k)).map(k => [k, Object.keys(side[k] ?? {})]),
    entries: side && (side.rosterForCurrentScoringPeriod ?? side.rosterForMatchupPeriod)?.entries?.slice(0, 3).map(e => ({ slot: e.lineupSlotId, keys: Object.keys(e), ppeKeys: Object.keys(e.playerPoolEntry ?? {}), applied: e.playerPoolEntry?.appliedStatTotal, name: e.playerPoolEntry?.player?.fullName, pos: e.playerPoolEntry?.player?.defaultPositionId })),
    total: side?.totalPoints,
  }));
} catch (err) { fs.writeFileSync(path.join(dir, 'site', 'debug.json'), JSON.stringify({ err: err.message })); }
// Small summary for the iPhone Home Screen widget (Scriptable).
fs.writeFileSync(path.join(dir, 'site', 'widget.json'), JSON.stringify({
  week, me: me.name, opp: opp?.name ?? null, myProj: n(myProj), oppProj: n(oppProj), win: winPct, live: isLive, updated: Date.now(),
  todo: todo.map(([lvl, title]) => ({ lvl, title })),
}));
fs.writeFileSync(path.join(dir, 'site', 'manifest.json'), JSON.stringify({
  name: me.name, short_name: 'Fantasy', start_url: '.', display: 'standalone', background_color: '#0b1530', theme_color: '#0b1530',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}));
console.log(`Wrote site/index.html for ${me.name}, week ${week}. vs ${opp?.name}: ${n(myProj)}-${n(oppProj)}`);
todo.forEach(([l, t]) => console.log(`[${l}] ${t}`));
