// ESPN fantasy league report. Run: node fantasy.mjs  ->  writes site/index.html next to this file.
// Login comes from env ESPN_S2 / SWID / LEAGUE_ID (GitHub Actions) or league-config.json (local).
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { CSS } from './parts/page-css.mjs';
import { mainJs } from './parts/main-js.mjs';
import { TOOLS_JS } from './parts/tools-js.mjs';
import { MOVE_JS } from './parts/move-js.mjs';
import { lockPage } from './parts/lock-page.mjs';

// A source that hangs must not hold up the build: every fetch gives up after 30s unless it sets its own limit
const fetch0 = fetch;
globalThis.fetch = (u, o = {}) => fetch0(u, { signal: AbortSignal.timeout(30000), ...o });

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, 'league-config.json');
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const ESPN_S2 = process.env.ESPN_S2 || cfg.espn_s2;
const SWID = process.env.SWID || cfg.SWID;
const LEAGUE_ID = process.env.LEAGUE_ID || cfg.leagueId;
const MOVE_URL = 'https://fantasy-workers.drbrodydisick.workers.dev/';
// fingerprint of this code: a new build with the same code only changed data, so the open page can swap it in place
const CODE = crypto.createHash('sha256').update([fileURLToPath(import.meta.url), ...fs.readdirSync(path.join(dir, 'parts')).sort().map(f => path.join(dir, 'parts', f))].map(f => fs.readFileSync(f, 'utf8')).join('')).digest('hex').slice(0, 12);
const SEASON = Number(process.env.SEASON || cfg.season || new Date().getFullYear());
if (!ESPN_S2 || !SWID || !LEAGUE_ID) throw new Error('Missing ESPN_S2, SWID or LEAGUE_ID');

const H = { Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}` };
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}`;
const LEAGUE = `${BASE}/segments/0/leagues/${LEAGUE_ID}`;

const VAPID_PUBLIC = 'BARgoktdqvKVCNGSMWSNgihh0VeG29ic9R9phwQIM2C0cb5tzZj6CQfoeigkrXC0-7rQ9BXE6IHjN_ua-akcKEw';
// If ESPN rejects the login (the espn_s2 / SWID cookies expire), every update fails and the normal alerts never
// get to run, so tell the phone right here, at most once a day (remembered in the same state file as other alerts).
async function loginAlert() {
  if (!process.env.PUSH_SUB || !process.env.VAPID_PRIVATE) return;
  const f = path.join(dir, 'state', 'alerts.json');
  const memo = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  memo.sent ??= {};
  if (Date.now() - (memo.sent['espn-login'] ?? 0) < 864e5) return;
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails('https://mrbrofo.github.io/Fantasy-app/', VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  await webpush.sendNotification(JSON.parse(process.env.PUSH_SUB), JSON.stringify({ title: 'Your fantasy app stopped updating', body: 'ESPN rejected the login, so it probably expired. Ask Claude to help you copy new espn_s2 and SWID cookies into GitHub.', tag: 'espn-login' }));
  memo.sent['espn-login'] = Date.now();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(memo));
}

async function get(url, filter) {
  const headers = filter ? { ...H, 'x-fantasy-filter': JSON.stringify(filter) } : H;
  const r = await fetch(url, { headers });
  if ((r.status === 401 || r.status === 403) && !get.warned) { get.warned = true; await loginAlert().catch(err => console.warn('Login alert not sent:', err.message)); }
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
  INJURY_RESERVE: ['Hurt long-term (IR)', 'bad'], SUSPENSION: ['Suspended', 'bad'], DAY_TO_DAY: ['Day to day', 'warn'],
};

const league = await get(`${LEAGUE}?view=mSettings&view=mTeam&view=mRoster&view=mStatus&view=mMatchupScore`);
const week = league.status?.currentMatchupPeriod ?? league.scoringPeriodId;
const pro = (await get(`${BASE}?view=proTeamSchedules_wl`)).settings.proTeams;
const proAbbr = Object.fromEntries(pro.map(t => [t.id, t.abbrev]));
const proName = Object.fromEntries(pro.map(t => [t.id, t.id ? `${t.location} ${t.name}` : 'No team']));
const proBye = Object.fromEntries(pro.map(t => [t.id, t.byeWeek]));
const slotCounts = league.settings.rosterSettings.lineupSlotCounts;
const playoffTeams = league.settings.scheduleSettings?.playoffTeamCount ?? 0;
// Widget data sits outside the site lock, so with a password its file name is secret (derived from it)
const WIDGET = process.env.SITE_PASSWORD ? `widget-${crypto.createHmac('sha256', process.env.SITE_PASSWORD).update('widget').digest('hex').slice(0, 16)}.json` : 'widget.json';
const lastWeek = league.settings.scheduleSettings?.matchupPeriodCount ?? 14;

// --- Second opinions, so one site's guess doesn't decide everything. Any that fail are left out (and named on the page).
// Players are matched by name + NFL team (positions differ between sites); defenses by team.
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv|v)$/, '').trim();
const TEAM = t => ({ WSH: 'WAS', JAC: 'JAX' }[t?.toUpperCase()] ?? t?.toUpperCase());
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
} catch (err) { console.warn('Saved CBS numbers skipped:', err.message); }
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
// One player's game (Sleeper stats) as a weeks row: [% of his team's plays he was on, opponent, points, targets, carries,
// red-zone targets + carries, touchdowns, catches, his team's plays, passes thrown, interceptions thrown, position, name]
const weekRow = x => [x.stats.tm_off_snp ? Math.round((x.stats.off_snp ?? 0) / x.stats.tm_off_snp * 100) : null, TEAM(x.opponent), +(x.stats.pts_half_ppr ?? 0).toFixed(1),
  x.stats.rec_tgt ?? 0, x.stats.rush_att ?? 0, (x.stats.rec_rz_tgt ?? 0) + (x.stats.rush_rz_att ?? 0), (x.stats.rec_td ?? 0) + (x.stats.rush_td ?? 0),
  x.stats.rec ?? 0, x.stats.tm_off_snp ?? null, x.stats.pass_att ?? 0, x.stats.pass_int ?? 0, x.player.position, `${x.player.first_name} ${x.player.last_name}`];
// Kicker and defense games: K = ['K', opponent, points, field goal tries, made, made from 50+, extra point tries, made];
// DEF = ['DEF', opponent, points, points allowed, sacks, interceptions, fumbles recovered, defense + return touchdowns]
const kdRow = x => { const s = x.stats; return x.player.position === 'K' ? ['K', TEAM(x.opponent), +(s.pts_half_ppr ?? 0).toFixed(1), s.fga ?? 0, s.fgm ?? 0, s.fgm_50p ?? 0, s.xpa ?? 0, s.xpm ?? 0]
  : ['DEF', TEAM(x.opponent), +(s.pts_half_ppr ?? 0).toFixed(1), s.pts_allow ?? 0, s.sack ?? 0, s.int ?? 0, s.fum_rec ?? 0, (s.def_td ?? 0) + (s.def_st_td ?? 0)]; };
const kdKey = x => pkey(`${x.player.first_name} ${x.player.last_name}`, x.player.position === 'DEF' ? 'D/ST' : 'K', x.team);
const SLP_ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position[]=${p}`).join('&');
let rosSaved = null, rosPrev = null;
try {
  const old = rosPrev = await (await fetch(`https://mrbrofo.github.io/Fantasy-app/ros.json?t=${Date.now()}`)).json();
  if (old.week === week && Date.now() - old.at < 3600e3 && old.v === 5 && old.practice && old.weeks && old.depth && old.weather && old.scores && old.kd && old.tagHist) rosSaved = old;
} catch (err) { console.warn('Saved player numbers skipped:', err.message); }
if (!rosSaved) {
  rosSaved = { v: 5, week, at: Date.now(), roto: [], cbs: [] }; // v5: kicker and defense games (kd)
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
    const weeks = {}, kd = {}; // weeks[wk][player key] = weekRow(): who played, for whyWeek(), qbSplit() and luck(); kd[wk][key] = kdRow()
    for (let wk = 1; wk < week; wk++) {
      const r = await fetch(`https://api.sleeper.app/stats/nfl/${SEASON}/${wk}?season_type=regular&${SLP_ALL}`);
      for (const x of await r.json()) {
        const pos = x.player?.position, pts = x.stats?.pts_half_ppr ?? 0;
        if (!x.stats?.gp || !x.opponent) continue;
        if (pos === 'K' || pos === 'DEF') { (kd[wk] ??= {})[kdKey(x)] = kdRow(x); continue; }
        const a = ((allowed[pos] ??= {})[TEAM(x.opponent)] ??= [0, new Set()]);
        a[0] += pts; a[1].add(wk);
        const name = `${x.player.first_name} ${x.player.last_name}`, k = pkey(name, pos, x.team), u = usual.get(k) ?? [k, name, pos, TEAM(x.team), 0];
        u[4] += pts; usual.set(k, u);
        (weeks[wk] ??= {})[k] = weekRow(x);
      }
    }
    rosSaved.weeks = weeks; rosSaved.kd = kd;
    rosSaved.allowed = Object.fromEntries(Object.entries(allowed).map(([pos, t]) => [pos, Object.fromEntries(Object.entries(t).map(([team, [pts, wks]]) => [team, pts / wks.size]))]));
    rosSaved.usual = [...usual.values()];
  } catch (err) { console.warn('Matchup data skipped:', err.message); rosSaved.allowed = {}; rosSaved.usual = []; }
  // Final scores of past weeks (ESPN): scores[wk][team] = [his team's points, the other team's]
  try {
    rosSaved.scores = {};
    for (let wk = 1; wk < week; wk++) {
      const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${wk}&seasontype=2&dates=${SEASON}`)).json();
      for (const ev of sb.events ?? []) {
        const [a, b] = ev.competitions[0].competitors;
        if (ev.status?.type?.state !== 'post') continue;
        (rosSaved.scores[wk] ??= {})[TEAM(a.team.abbreviation)] = [+a.score, +b.score];
        rosSaved.scores[wk][TEAM(b.team.abbreviation)] = [+b.score, +a.score];
      }
    }
  } catch (err) { console.warn('Past scores skipped:', err.message); rosSaved.scores = {}; }
  // Official NFL injury report (NFL.com): each listed player's latest practice this week. Tables are per team,
  // headed by the nickname ("Seahawks"); columns are player, position, injury, practice status, game status.
  try {
    const r = await fetch(`https://www.nfl.com/injuries/league/${SEASON}/reg${week}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${r.status}`);
    const nick = Object.fromEntries(pro.filter(t => t.id).map(t => [t.name, t.abbrev]));
    const text = s => s.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
    rosSaved.practice = []; rosSaved.gameStatus = [];
    for (const part of (await r.text()).split('<div class="d3-o-section-sub-title"><span>').slice(1)) {
      const team = nick[text(part.slice(0, part.indexOf('</span>')))];
      if (!team) continue;
      for (const tr of part.split('<tr>').slice(1)) {
        const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
        const pr = /^Full/.test(td[3]) ? 'Full' : /^Limited/.test(td[3]) ? 'Limited' : /^Did Not/.test(td[3]) ? 'DNP' : null;
        if (pr) rosSaved.practice.push([pkey(td[0], td[1], team), pr]);
        const gs = /^(Out|Doubtful|Questionable)/.exec(td[4] ?? '')?.[1];
        if (gs) rosSaved.gameStatus.push([pkey(td[0], td[1], team), gs]);
      }
    }
  } catch (err) { console.warn('NFL injury report skipped:', err.message); rosSaved.practice = []; rosSaved.gameStatus = []; }
  const csv = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} on ${url.split('/').pop()}`);
    const [head, ...rows] = (await r.text()).trim().split('\n').map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(s => s.replace(/,$/, '').replace(/^"|"$/g, '')));
    return rows.map(f => Object.fromEntries(head.map((h, i) => [h, f[i]])));
  };
  // Air yards by game (nflverse, a day or two behind Sleeper): air[wk][player key]. Checked every 6 hours; a game it doesn't have yet is estimated in luck().
  if (rosPrev?.air && Date.now() - rosPrev.airAt < 216e5) Object.assign(rosSaved, { air: rosPrev.air, airAt: rosPrev.airAt });
  else try {
    const air = {};
    for (const x of await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${SEASON}.csv`))
      if (x.season_type === 'REG' && ['RB', 'WR', 'TE'].includes(x.position)) (air[x.week] ??= {})[pkey(x.player_display_name, x.position, x.team === 'LA' ? 'LAR' : x.team)] = +x.receiving_air_yards || 0;
    Object.assign(rosSaved, { air, airAt: Date.now() });
  } catch (err) { console.warn('Air yards skipped:', err.message); rosSaved.air = rosPrev?.air ?? {}; rosSaved.airAt = rosPrev?.airAt ?? 0; }
  // Each player's own record when listed questionable or doubtful (nflverse injury reports + snap counts, last 5 seasons):
  // tagHist[name|pos] = { Q: [times listed, times played], D: [...] }. Only changes once a week, so it's reused until then.
  if (rosPrev?.tagHist && rosPrev.tagHistWeek === week) Object.assign(rosSaved, { tagHist: rosPrev.tagHist, tagHistWeek: week });
  else try {
    const hist = {};
    for (let y = SEASON - 5; y <= SEASON; y++) {
      const nf = 'https://github.com/nflverse/nflverse-data/releases/download';
      const snaps = await csv(`${nf}/snap_counts/snap_counts_${y}.csv`), played = new Set(snaps.map(x => `${x.week}|${norm(x.player)}`)), done = new Set(snaps.map(x => x.week));
      for (const x of await csv(`${nf}/injuries/injuries_${y}.csv`)) {
        const s = { Questionable: 'Q', Doubtful: 'D' }[x.report_status];
        if (!s || !['QB', 'RB', 'WR', 'TE'].includes(x.position) || !done.has(x.week) || (y === SEASON && +x.week >= week)) continue;
        const h = ((hist[`${norm(x.full_name)}|${x.position}`] ??= {})[s] ??= [0, 0]);
        h[0]++; if (played.has(`${x.week}|${norm(x.full_name)}`)) h[1]++;
      }
    }
    Object.assign(rosSaved, { tagHist: hist, tagHistWeek: week });
  } catch (err) { console.warn('Injury tag history skipped:', err.message); rosSaved.tagHist = rosPrev?.tagHist ?? {}; }
  // Depth charts (Sleeper, every team, defense too): the top 2 at each spot (every spot for QB/RB/WR/TE/K, for
  // "3rd string" on player cards), with injury status. Sleeper asks
  // that its full player list be downloaded at most once a day, so the last one is reused for 24 hours.
  if (rosPrev?.depth && Date.now() - rosPrev.depthAt < 864e5) Object.assign(rosSaved, { depth: rosPrev.depth, depthAt: rosPrev.depthAt });
  else try {
    const all = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
    rosSaved.depth = {}; rosSaved.depthAt = Date.now();
    for (const x of Object.values(all)) if (x.team && x.depth_chart_position && (x.depth_chart_order <= 2 || ['QB', 'RB', 'WR', 'TE', 'K'].includes(x.position)))
      (rosSaved.depth[TEAM(x.team)] ??= []).push([x.depth_chart_position, x.depth_chart_order, x.full_name ?? `${x.first_name} ${x.last_name}`, x.injury_status ?? null]);
  } catch (err) { console.warn('Depth charts skipped:', err.message); rosSaved.depth = {}; }
  // This week's stadiums and weather, by team: ESPN says whether the game is indoors; Open-Meteo gives the
  // forecast at kickoff (wind, gusts, rain, temperature) for outdoor games.
  try {
    rosSaved.weather = {};
    const STATE = { AZ: 'Arizona', CA: 'California', CO: 'Colorado', FL: 'Florida', GA: 'Georgia', IL: 'Illinois', IN: 'Indiana', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', NC: 'North Carolina', NJ: 'New Jersey', NV: 'Nevada', NY: 'New York', OH: 'Ohio', PA: 'Pennsylvania', TN: 'Tennessee', TX: 'Texas', WA: 'Washington', WI: 'Wisconsin' };
    const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${SEASON}`)).json();
    for (const ev of sb.events ?? []) {
      // SoFi has a fixed roof with open sides; ESPN calls it outdoor, but the weather barely reaches the field
      const c = ev.competitions[0], v = c.venue ?? {}, w = { indoor: !!v.indoor || /SoFi/.test(v.fullName ?? ''), place: v.fullName ?? '' };
      if (!v.indoor && v.address?.city) try {
        const hits = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(v.address.city)}&count=10`)).json()).results ?? [];
        // match the state (US) or the country (games abroad: "Saint-Denis" alone finds the one on Réunion first)
        const g = v.address.state ? hits.find(r => r.admin1 === STATE[v.address.state]) ?? hits.find(r => r.country_code === 'US') : hits.find(r => r.country === v.address.country);
        if (g) {
          const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&hourly=wind_speed_10m,wind_gusts_10m,precipitation,temperature_2m&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC&forecast_days=16`)).json();
          const i = f.hourly?.time.indexOf(new Date(ev.date).toISOString().slice(0, 13) + ':00') ?? -1;
          if (i >= 0) Object.assign(w, { wind: Math.round(f.hourly.wind_speed_10m[i]), gust: Math.round(f.hourly.wind_gusts_10m[i]), rain: f.hourly.precipitation[i], temp: Math.round(f.hourly.temperature_2m[i]) });
        }
      } catch (err) { console.warn(`Weather for ${v.fullName} skipped:`, err.message); }
      for (const t of c.competitors) rosSaved.weather[TEAM(t.team.abbreviation)] = w;
    }
  } catch (err) { console.warn('Weather skipped:', err.message); rosSaved.weather = {}; }
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
// His own record then moves it: it counts as much as SELF_WEIGHT games at the league rate, so 3 past tags barely
// move it and 15 mostly decide it (9 of 11 played on a 71% base: (9 + 5 * 0.71) / (11 + 5) = 78%).
const SELF_WEIGHT = 5;
function leagueOdds(p, type) {
  if (p.status === 'DOUBTFUL') return { pct: 7, why: 'only 7 in 100 doubtful players play' };
  if (p.status !== 'QUESTIONABLE') return null;
  const pr = practice.get(pkey(p.name, p.pos, p.team));
  if (!pr) return { pct: 71, why: 'no practice report yet' };
  const kind = ['concussion', 'knee', 'hamstring'].find(k => new RegExp(k, 'i').test(type ?? '')) ?? 'any';
  return { pct: PLAY_ODDS[kind][pr], why: PRACTICED[pr] };
}
function playOdds(p, type) {
  const base = leagueOdds(p, type);
  const [tags, played] = base ? rosSaved.tagHist?.[`${norm(p.name)}|${p.pos}`]?.[p.status[0]] ?? [0, 0] : [0, 0];
  if (!tags) return base;
  const pct = Math.round((played + SELF_WEIGHT * base.pct / 100) / (tags + SELF_WEIGHT) * 100);
  return { pct, base: base.pct, tags, played, why: `${base.why}; he's played ${played} of ${tags} times listed ${p.status.toLowerCase()}` };
}
// Vegas lines (DraftKings, from ESPN's public scoreboard): points each NFL team is expected to score
const vegas = {}, gameNow = {}; // gameNow[team] = { state: 'pre' | 'in' | 'post', text: e.g. 'Q3 4:12' or 'Final' }
try {
  const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${SEASON}`)).json();
  for (const ev of d.events ?? []) {
    const c = ev.competitions[0], o = c.odds?.[0];
    for (const x of c.competitors) gameNow[TEAM(x.team.abbreviation)] = { id: ev.id, state: ev.status?.type?.state, text: ev.status?.type?.shortDetail, score: [+x.score, +c.competitors.find(y => y !== x).score] };
    if (!o?.overUnder || o.spread == null) continue;
    const home = c.competitors.find(x => x.homeAway === 'home'), away = c.competitors.find(x => x.homeAway === 'away');
    // spread is the home team's line: -3 means home is favored by 3
    vegas[TEAM(home.team.abbreviation)] = (o.overUnder - o.spread) / 2;
    vegas[TEAM(away.team.abbreviation)] = (o.overUnder + o.spread) / 2;
  }
} catch (err) { console.warn('Vegas lines skipped:', err.message); down.push('Vegas lines'); }
// This week's games so far (Sleeper), same rows as rosSaved.weeks, for the "why" of a game that's over
const weekNow = {}, kdNow = {};
if (Object.values(gameNow).some(g => g.state === 'post')) try {
  for (const x of await (await fetch(`https://api.sleeper.app/stats/nfl/${SEASON}/${week}?season_type=regular&${SLP_ALL}`)).json()) {
    if (!x.player || !x.stats?.gp || !x.opponent) continue;
    if (['K', 'DEF'].includes(x.player.position)) kdNow[kdKey(x)] = kdRow(x);
    else weekNow[pkey(`${x.player.first_name} ${x.player.last_name}`, x.player.position, x.team)] = weekRow(x);
  }
} catch (err) { console.warn('This week\'s stat lines skipped:', err.message); }
const vegasAvg = Object.values(vegas).reduce((s, v) => s + v, 0) / Math.max(1, Object.keys(vegas).length);
// "Experts disagree" = the highest and lowest projection are 5+ points and 35%+ apart
const split = v => v.length > 1 && Math.max(...v) - Math.min(...v) >= 5 && Math.max(...v) - Math.min(...v) >= 0.35 * Math.max(...v);

// statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season, 1 = one week.
// Stats also include last season's totals, so filter by seasonId.
// Why he scored what he did: ESPN's points per stat (appliedStats, this league's scoring) with the count behind it.
// STAT_LABEL[id] = [label, stat id holding the count (null = no count)]. Ids from ESPN's ffl stat list.
const STAT_LABEL = {
  3: ['Passing yards', 3], 5: ['Passing yards', 3], 6: ['Passing yards', 3], 7: ['Passing yards', 3], 8: ['Passing yards', 3],
  4: ['Passing touchdowns', 4], 19: ['2-point passes', 19], 20: ['Interceptions thrown', 20], 64: ['Times sacked', 64],
  15: ['40+ yard TD pass bonus', null], 16: ['50+ yard TD pass bonus', null], 17: ['300+ passing yards bonus', null], 18: ['400+ passing yards bonus', null],
  24: ['Rushing yards', 24], 27: ['Rushing yards', 24], 28: ['Rushing yards', 24], 29: ['Rushing yards', 24], 30: ['Rushing yards', 24],
  25: ['Rushing touchdowns', 25], 26: ['2-point runs', 26], 35: ['40+ yard TD run bonus', null], 36: ['50+ yard TD run bonus', null], 37: ['100+ rushing yards bonus', null], 38: ['200+ rushing yards bonus', null],
  42: ['Receiving yards', 42], 45: ['Receiving yards', 42], 46: ['Receiving yards', 42], 47: ['Receiving yards', 42], 48: ['Receiving yards', 42],
  43: ['Receiving touchdowns', 43], 44: ['2-point catches', 44], 53: ['Catches', 53], 58: ['Targets', 58],
  54: ['40+ yard TD catch bonus', null], 55: ['50+ yard TD catch bonus', null], 56: ['100+ receiving yards bonus', null], 57: ['200+ receiving yards bonus', null],
  68: ['Fumbles', 68], 72: ['Fumbles lost', 72], 63: ['Fumble recovered for a TD', 63],
  74: ['Field goals 50+ yards', 74], 77: ['Field goals 40-49 yards', 77], 80: ['Field goals under 40 yards', 80], 83: ['Field goals', 83],
  198: ['Field goals 50-59 yards', 198], 201: ['Field goals 60+ yards', 201],
  76: ['Missed field goals 50+ yards', 76], 79: ['Missed field goals 40-49 yards', 79], 82: ['Missed field goals under 40 yards', 82], 85: ['Missed field goals', 85],
  200: ['Missed field goals 50-59 yards', 200], 203: ['Missed field goals 60+ yards', 203], 86: ['Extra points', 86], 88: ['Missed extra points', 88],
  95: ['Interceptions', 95], 96: ['Fumbles recovered', 96], 97: ['Blocked kicks', 97], 98: ['Safeties', 98], 99: ['Sacks', 99], 106: ['Forced fumbles', 106],
  93: ['Blocked kick returned for a TD', 93], 94: ['Defensive touchdowns', 94], 101: ['Kickoff return touchdowns', 101], 102: ['Punt return touchdowns', 102],
  103: ['Interception return touchdowns', 103], 104: ['Fumble return touchdowns', 104], 105: ['Defense and special teams touchdowns', 105],
  ...Object.fromEntries([89, 90, 91, 92, 121, 122, 123, 124, 125, 126].map(i => [i, ['Points allowed', 120]])),
  ...Object.fromEntries([128, 129, 130, 131, 132, 133, 134, 135, 136].map(i => [i, ['Yards allowed', 127]])),
};
const unlabeled = new Set(); // stat ids with points but no label, reported in the run log so they can be named
function scoring(s) {
  const by = new Map();
  for (const [id, pts] of Object.entries(s?.appliedStats ?? {})) {
    if (!pts) continue;
    if (!STAT_LABEL[id]) unlabeled.add(id);
    const [label, from] = STAT_LABEL[id] ?? [`Other (ESPN stat ${id})`, null];
    const x = by.get(label) ?? { pts: 0, count: from == null ? null : s.stats?.[from] ?? null };
    x.pts += pts; by.set(label, x);
  }
  return [...by].sort((a, b) => Math.abs(b[1].pts) - Math.abs(a[1].pts))
    .map(([label, x]) => `${label}${x.count == null ? '' : `: ${+x.count.toFixed(1)}`} (${x.pts > 0 ? '+' : ''}${+x.pts.toFixed(1)})`);
}
const stat = (p, src, split) => p.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === split && (split === 0 || s.scoringPeriodId === week));

// Wind at kickoff, outdoor games: about 15 mph is where passing and kicking start to suffer, 20+ much more
// (fewer passes and worse efficiency; shorter, missed kicks). Sizes are rough, from betting and fantasy analysis
// (Covers, 4for4, Sharp Football). Runners aren't cut: windy games lean on the run.
// ponytail: a rough step, not a fitted model; a source that already priced the wind in gets it twice.
const WIND_CUT = { QB: [0.93, 0.85], WR: [0.93, 0.85], TE: [0.93, 0.85], K: [0.95, 0.88] };
const windFactor = (pos, w) => (!w || w.indoor || !(w.wind >= 15) || !WIND_CUT[pos] ? 1 : WIND_CUT[pos][w.wind >= 20 ? 1 : 0]);
// His points per game without his usual QB vs with him, this season (Sleeper results), pulled toward "no change"
// when there are few games: on average pass catchers barely change with a backup QB (FantasyPoints, 2023: -1%),
// but single players swing a lot (DJ Moore: -50%), so only his own games say which way he goes.
function qbSplit(k, qbK, weeks = rosSaved.weeks ?? {}) {
  const w = [], wo = [];
  for (const wd of Object.values(weeks)) if (wd[k]?.[2] != null) (wd[qbK] ? w : wo).push(wd[k][2]);
  if (w.length < 2 || wo.length < 2) return null;
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  if (!(avg(w) > 0)) return null;
  const raw = avg(wo) / avg(w), ratio = Math.min(1.3, Math.max(0.6, 1 + (raw - 1) * wo.length / (wo.length + 4)));
  return { ratio, games: wo.length, with: avg(w), without: avg(wo) };
}

// ratings[0] = season-long; positionalRanking = e.g. 14th-best QB so far
function row(p, ratings) {
  const season = stat(p, 0, 0);
  const proj = stat(p, 1, 1);
  const pos = POS[p.defaultPositionId] ?? '?', team = proAbbr[p.proTeamId] ?? 'FA';
  // expected points = average of ESPN, Rotowire, CBS and FantasyPros (weighted by past accuracy once there's enough), whichever have a number (none if ESPN has none, e.g. bye)
  const espn = proj?.appliedTotal ?? null, k = team === 'FA' && pos !== 'D/ST' ? [...sleeper.keys(), ...cbs.keys()].find(x => x.startsWith(`${norm(p.fullName)}|`)) ?? pkey(p.fullName, pos, team) : pkey(p.fullName, pos, team);
  const roto = espn == null ? null : sleeper.get(k) ?? null, cb = espn == null ? null : cbs.get(k) ?? null, fx = espn == null ? null : fp.get(k) ?? null;
  const all = [espn, roto, cb, fx?.[0]].filter(v => v != null), wind = windFactor(pos, rosSaved.weather?.[TEAM(team)]);
  // ESPN's rest-of-season projection is statSourceId 1, statSplitTypeId 0 (per game = appliedAverage)
  const rosBy = [stat(p, 1, 0)?.appliedAverage ?? null, rosRoto.get(k) ?? null, rosCbs.get(k) ?? null, fpRos.get(k)?.[0] ?? null];
  const rosAll = rosBy.filter(v => v != null);
  return {
    id: p.id, name: p.fullName, pos, proTeamId: p.proTeamId,
    team, teamName: proName[p.proTeamId] ?? 'No team', bye: proBye[p.proTeamId] ?? null,
    status: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    now: stat(p, 0, 1)?.appliedTotal ?? null, nowLine: scoring(stat(p, 0, 1)),
    pts: season?.appliedTotal ?? null, avg: season?.appliedAverage ?? null, ceiling: proj?.appliedTotalCeiling ?? null,
    proj: all.length ? blend([espn, roto, cb, fx?.[0] ?? null]) * wind : null, wind, espn, roto, cbs: cb, fp: fx?.[0] ?? null, experts: fx, rosRank: fpRos.get(k)?.[1] ?? null, split: split(all), vegas: vegas[TEAM(team)] ?? null,
    ros: rosAll.length ? rosAll.reduce((s, v) => s + v, 0) / rosAll.length : null, rosBy,
    owned: p.ownership?.percentOwned ?? null, trend: p.ownership?.percentChange ?? 0, rank: ratings?.[0]?.positionalRanking || null,
  };
}

// FantasyPros: this week's expert consensus (25 or so experts) from their rankings pages' own data: rank at the position,
// the best and worst any expert has him, a start/sit grade, and a half-PPR projection (a 4th source for expected points).
// Fetched at most once an hour (kept in ros.json). Defenses are skipped like CBS: their scoring differs from this league's.
// ponytail: scraped from their page, not an official feed; if they change it or block us, the other sources carry on
const fp = new Map(); // key -> [points, pos rank like "WR4", best rank, worst rank, grade, experts]
const FP_PAGE = { QB: 'qb', RB: 'half-point-ppr-rb', WR: 'half-point-ppr-wr', TE: 'half-point-ppr-te', K: 'k' };
if (!rosSaved.fp) try {
  const rows = [];
  for (const [pos, page] of Object.entries(FP_PAGE)) {
    const r = await fetch(`https://www.fantasypros.com/nfl/rankings/${page}.php`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${r.status} on ${pos}`);
    const d = JSON.parse((await r.text()).match(/var ecrData = (\{.*?\});/)?.[1] ?? 'null');
    if (!d?.players) throw new Error(`no rankings on ${pos}, page layout probably changed`);
    if (+d.week !== week) { console.warn(`FantasyPros skipped: their week is ${d.week}, this is week ${week}`); rows.length = 0; break; }
    for (const x of d.players) rows.push([x.player_name, pos, x.player_team_id, Number(x.r2p_pts), x.pos_rank, x.rank_min, x.rank_max, x.start_sit_grade ?? '', d.total_experts]);
  }
  if (rows.length) rosSaved.fp = rows;
} catch (err) { console.warn('FantasyPros skipped:', err.message); down.push('FantasyPros'); }
for (const [name, pos, team, ...rest] of rosSaved.fp ?? []) if (Number.isFinite(rest[0])) fp.set(pkey(name, pos, team), rest);
// Rest of season, from their rest-of-season rankings (fewer experts, about 6): the page gives a total through week 18,
// so per game = that total over his games left (this week to 18, less his bye). Checked against Rotowire: within 4%.
const fpRos = new Map(); // key -> [points per game, pos rank like "WR4"]
if (!rosSaved.fpRos) try {
  const rows = [];
  for (const [pos, page] of Object.entries(FP_PAGE)) {
    const r = await fetch(`https://www.fantasypros.com/nfl/rankings/ros-${page}.php`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${r.status} on ${pos}`);
    const d = JSON.parse((await r.text()).match(/var ecrData = (\{.*?\});/)?.[1] ?? 'null');
    if (!d?.players) throw new Error(`no rest-of-season rankings on ${pos}, page layout probably changed`);
    for (const x of d.players) {
      const games = Array.from({ length: Math.max(0, 19 - week) }, (_, i) => week + i).filter(w => w !== +x.player_bye_week).length;
      if (games) rows.push([x.player_name, pos, x.player_team_id, Number(x.r2p_pts) / games, x.pos_rank]);
    }
  }
  rosSaved.fpRos = rows;
} catch (err) { console.warn('FantasyPros rest of season skipped:', err.message); }
for (const [name, pos, team, ...rest] of rosSaved.fpRos ?? []) if (Number.isFinite(rest[0])) fpRos.set(pkey(name, pos, team), rest);

// Each source's projection and what the player then scored, to weight the sources by how close they've been.
// srcHist.weeks[wk][espnId] = [espn, roto, cbs, fp, actual], half PPR. Kept in state/ (Actions cache), with
// site/sources.json as the copy to fall back on if the cache is ever lost.
const histFile = path.join(dir, 'state', 'sources.json');
let srcHist = null;
try { srcHist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : await (await fetch(`https://mrbrofo.github.io/Fantasy-app/sources.json?t=${Date.now()}`)).json(); } catch {}
if (srcHist?.season !== SEASON) srcHist = { season: SEASON, weeks: {} };
// Past weeks it wasn't saving yet, filled in once: ESPN's public standard and PPR numbers (projection and actual,
// half PPR = their average), Rotowire's from Sleeper and FantasyPros' rankings for that week. CBS keeps no past weeks.
for (let wk = 1; wk < week; wk++) if (!srcHist.weeks[wk]) try {
  const f = { players: { filterSlotIds: { value: [0, 2, 4, 6, 17] }, sortPercOwned: { sortPriority: 1, sortAsc: false }, limit: 400, filterStatsForTopScoringPeriodIds: { value: 17, additionalValue: [`11${SEASON}${wk}`] } } }; // his last 17 games + that week's projection
  const [std, ppr] = await Promise.all([1, 3].map(async s => (await (await fetch(`${BASE}/segments/0/leaguedefaults/${s}?view=kona_player_info&scoringPeriodId=${wk}`, { headers: { 'x-fantasy-filter': JSON.stringify(f) } })).json()).players));
  const roto = new Map(), fpw = new Map();
  for (const x of await (await fetch(`https://api.sleeper.app/projections/nfl/${SEASON}/${wk}?season_type=regular&${['QB', 'RB', 'WR', 'TE', 'K'].map(p => `position[]=${p}`).join('&')}`)).json())
    if (x.stats?.pts_half_ppr != null) roto.set(pkey(`${x.player.first_name} ${x.player.last_name}`, x.player.position, x.team), x.stats.pts_half_ppr);
  for (const [pos, page] of Object.entries(FP_PAGE)) {
    const d = JSON.parse((await (await fetch(`https://www.fantasypros.com/nfl/rankings/${page}.php?week=${wk}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()).match(/var ecrData = (\{.*?\});/)?.[1] ?? 'null');
    if (+d?.week === wk) for (const x of d.players) fpw.set(pkey(x.player_name, pos, x.player_team_id), Number(x.r2p_pts));
  }
  const half = (p, src) => { const a = p.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === 1 && s.scoringPeriodId === wk)?.appliedTotal, b = std.find(y => y.player.id === p.id)?.player.stats?.find(s => s.seasonId === SEASON && s.statSourceId === src && s.statSplitTypeId === 1 && s.scoringPeriodId === wk)?.appliedTotal; return a == null ? null : Math.round((a + (b ?? a)) / 2 * 10) / 10; };
  const rows = {};
  for (const { player: p } of ppr) {
    const k = pkey(p.fullName, POS[p.defaultPositionId], proAbbr[p.proTeamId]), espn = half(p, 1), actual = half(p, 0), r = roto.get(k) ?? null, x = fpw.get(k) ?? null;
    if (espn != null && actual != null && (r != null || x != null)) rows[p.id] = [espn, r, null, Number.isFinite(x) ? x : null, actual];
  }
  srcHist.weeks[wk] = rows;
  console.log(`Source history: week ${wk} filled in, ${Object.keys(rows).length} players`);
} catch (err) { console.warn(`Source history for week ${wk} skipped:`, err.message); }
// Each source against ESPN on the same players (so a source missing some weeks or players is still compared fairly):
// weight = ESPN's average miss / its average miss. Starts once 3 past weeks have scores.
// ponytail: one weight per source for every position; per-position weights once there's a full season of rows
const srcWeights = (() => {
  const rows = Object.entries(srcHist.weeks).filter(([wk]) => +wk < week).flatMap(([, r]) => Object.values(r)).filter(r => r[4] != null && r[0] != null);
  if (new Set(Object.entries(srcHist.weeks).filter(([wk, r]) => +wk < week && Object.values(r).some(x => x[4] != null)).map(([wk]) => wk)).size < 3) return null;
  return [0, 1, 2, 3].map(i => {
    const both = rows.filter(r => r[i] != null), miss = j => Math.max(1, both.reduce((s, r) => s + Math.abs(r[j] - r[4]), 0) / both.length);
    return both.length < 100 ? 1 : miss(0) / miss(i);
  });
})();
if (srcWeights) console.log('Source weights (ESPN, Rotowire, CBS, FantasyPros):', srcWeights.map(w => w.toFixed(2)).join(', '));
const blend = v => { const w = v.map((x, i) => x == null ? 0 : srcWeights?.[i] ?? 1), tw = w.reduce((s, x) => s + x, 0); return tw ? v.reduce((s, x, i) => s + (x ?? 0) * w[i], 0) / tw : null; };

const names = {};
const teams = league.teams.map(t => {
  const roster = t.roster.entries.map(e => {
    const p = e.playerPoolEntry.player;
    names[p.id] = p.fullName;
    return { ...row(p, e.playerPoolEntry.ratings), slot: SLOT[e.lineupSlotId] ?? e.lineupSlotId };
  });
  const r = t.record.overall;
  return { id: t.id, name: t.name.trim(), owners: t.owners, w: r.wins, l: r.losses, ties: r.ties ?? 0, div: t.divisionId ?? 0, pf: r.pointsFor, pa: r.pointsAgainst, waiver: t.waiverRank, roster };
});
const teamName = Object.fromEntries(teams.map(t => [t.id, t.name]));
const me = teams.find(t => t.owners?.includes(SWID));
// the managers' real names (ESPN members), so Ask knows "Rosalie" is a team in this league
const mgrName = t => (t.owners ?? []).map(id => league.members?.find(m => m.id === id)).filter(Boolean).map(m => [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.displayName).filter(Boolean).join(' & ');

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
// expected points this week, times his chance to play when he's questionable or doubtful (71% plays = 71% of his points)
const weekValue = p => (playable(p) && !(locked(p) && !isStarter(p)) ? (p.proj ?? 0) * ((playOdds(p, p.inj?.type)?.pct ?? 100) / 100) : 0);
// Long-term value: rest-of-season points per game (average of the sources), else his average so far
const rate = p => p.ros ?? p.avg ?? 0;
// out this week isn't out for the season: only IR or out-for-season takes him to 0 (his rest-of-season projection covers the rest)
const outLong = p => p.slot === 'IR' || p.status === 'INJURY_RESERVE' || !!p.inj?.season;
const seasonValue = p => (outLong(p) ? 0 : rate(p));
const score = (players, value) => bestLineup(players, value).total;
const starters = t => t.roster.filter(p => p.slot !== 'Bench' && p.slot !== 'IR');
// A questionable player is a fine start when a healthy bench player at his position plays at the same time or later:
// teams name their inactives 90 minutes before kickoff, so you swap then if he sits (the "is playing" alert covers it).
// Counting only 71% of his points benched good players who usually play.
// ponytail: checks the bench as set now, not the bench the best lineup leaves.
const pivot = p => p.status === 'QUESTIONABLE' && !locked(p) && me.roster.some(b => b !== p && b.slot === 'Bench' && b.pos === p.pos && b.status !== 'QUESTIONABLE' && weekValue(b) > 0 && kickoff(b) >= kickoff(p));
const startValue = p => (pivot(p) ? (p.proj ?? 0) : weekValue(p));
// What a team should score this week. Mine: lineup as set (the to-do list says what to fix). Everyone else: their best
// lineup, since managers bench players on bye or out before kickoff; counting those as 0 made my win chance too high.
const weekLine = t => (t === me ? starters(t) : bestLineup(t.roster, p => weekValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0)).lineup.map(x => x.player));
const lineupProj = t => weekLine(t).reduce((s, p) => s + weekValue(p), 0);

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

// Experts lagging on a QB injury: the team's starting QB (depth chart) is out, but a source still projects
// him 3+ points (as if he plays), so his receivers' numbers likely still assume him too. Then a WR or TE
// with enough games both ways this season gets his own with/without-QB ratio. Nobody else changes.
{
  const espnOf = new Map([...teams.flatMap(t => t.roster), ...allFa].map(p => [pkey(p.name, p.pos, p.team), p]));
  const slpOf = new Map(slp.map(x => [x.k, x]));
  for (const p of [...teams.flatMap(t => t.roster), ...allFa]) {
    if (!['WR', 'TE'].includes(p.pos) || !(p.proj > 0)) continue;
    const qb = (rosSaved.depth?.[TEAM(p.team)] ?? []).find(([d, o]) => d === 'QB' && o === 1);
    if (!qb) continue;
    const qk = pkey(qb[2], 'QB', p.team), e = espnOf.get(qk), sl = slpOf.get(qk);
    const out = e ? ['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'DOUBTFUL'].includes(e.status) : ['Out', 'IR', 'Doubtful', 'Sus', 'PUP'].includes(sl?.inj);
    const lag = (e?.espn ?? 0) >= 3 || (sl?.pts ?? 0) >= 3;
    const sp = out && lag && qbSplit(pkey(p.name, p.pos, p.team), qk);
    if (sp) { p.qbAdj = { qb: qb[2], from: p.proj, ...sp }; p.proj *= sp.ratio; }
  }
}

// Next week's projection, for picking bye-week fill-ins. Only ESPN projects that far ahead, so this one is ESPN alone.
const nextProj = new Map();
if (week < lastWeek) {
  const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week + 1}`, { players: { filterIds: { value: [...me.roster, ...allFa].map(p => p.id) } } });
  for (const x of d.players) {
    const s = x.player.stats?.find(s => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === week + 1);
    if (s) nextProj.set(x.player.id, s.appliedTotal);
  }
}
// Every later regular-season week, for Compare. ESPN only, one download per week, so it's refreshed with ros.json (hourly).
if (rosSaved.future?.week !== week) {
  rosSaved.future = { week, by: {} };
  const ids = [...new Set([...teams.flatMap(t => t.roster), ...allFa].map(p => p.id))];
  for (let w = week + 1; w <= lastWeek; w++) {
    try {
      const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${w}`, { players: { filterIds: { value: ids } } });
      for (const x of d.players) {
        const st = x.player.stats?.find(s => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === w);
        (rosSaved.future.by[x.player.id] ??= [])[w - week - 1] = st ? +st.appliedTotal.toFixed(1) : null;
      }
    } catch (err) { console.warn(`Week ${w} projections skipped:`, err.message); }
  }
}

// Available players being added fastest across all ESPN leagues
const trending = (await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, {
  players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: Object.values(FA_SLOT) }, limit: 8, sortPercChanged: { sortPriority: 1, sortAsc: false } },
})).players.map(x => ({ ...row(x.player, x.ratings), wa: x.status === 'WAIVERS', slot: 'FA' })).filter(p => p.trend > 0);

// --- Start / sit: best lineup by this week's projections vs what's set now
// locked starters can't be moved, so they always stay in the best lineup
// a starter keeps his spot unless someone beats him by a full point: smaller gaps are coin flips, not moves
const best = bestLineup(me.roster, p => startValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0) + (isStarter(p) && weekValue(p) > 0 ? 0.99 : 0));
best.total = best.lineup.reduce((t, x) => t + weekValue(x.player), 0);
const bestIds = new Set(best.lineup.map(x => x.player.id));
const benchIn = best.lineup.map(x => x.player).filter(p => !starters(me).includes(p));
const sitOut = starters(me).filter(p => !bestIds.has(p.id));
// who each new starter replaces: the benched starter from the same lineup spot, else same position
const replaces = new Map();
{
  const left = [...sitOut];
  for (const p of benchIn) {
    const slot = best.lineup.find(x => x.player === p).slot;
    const k = [left.findIndex(o => o.slot === slot), left.findIndex(o => o.pos === p.pos), 0].find(i => i >= 0 && i < left.length);
    if (k != null) replaces.set(p, left.splice(k, 1)[0]);
  }
}
// This week's best total with game locks: locked starters stay in, everyone else counts as weekValue says
const weekScore = players => bestLineup(players, p => weekValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0)).lineup.reduce((t, x) => t + weekValue(x.player), 0);

// --- Waiver pickups: add each free agent, drop whichever player hurts least.
// Injured players are never suggested as drops (they come back), unless out for the season.
// A this-week pickup also pays for any season-long points it costs, so a star on bye is never the drop.
// tie-break: drop out-for-season players first, then a spare kicker or defense (one you'd never start: a third kicker
// only matters if both others are off, while a backup RB/WR/TE covers injuries), then the lowest per game
// (a backup kicker's 8 a game beat a backup running back's 4 here, so a third kicker was kept over him)
const weakness = (p, roster = me.roster) => { if (p.inj?.season) return -1;
  const same = ['K', 'D/ST'].includes(p.pos) ? roster.filter(x => x.pos === p.pos && x.slot !== 'IR').sort((a, b) => rate(b) - rate(a)) : [];
  return same.indexOf(p) >= (slotCounts[FA_SLOT[p.pos]] || 1) ? -0.5 + rate(p) / 1000 : rate(p); };
// A long-term keeper: 1.5+ a game better rest of season than the best free agent at his position, so he'd be
// hard to get back. Never dropped for a one-week gain (pickup plan, and the check on pending claims).
const isKeeper = p => { const o = faBest.find(o => o.pos === p.pos); return seasonValue(p) >= (o ? seasonValue(o) : 0) + 1.5; };
// A move's worth, week by week for the rest of the regular season: this week as weekScore counts it, each later week
// with ESPN's projection for that week (0 on bye), else his rest-of-season number. So a pickup that's great this week
// and worse after, or a trade that costs this week and wins later, is judged on both. now = this week,
// later = average a week after, total = every week added up, weeks = each week's gain (for the playoff chance).
// ponytail: playoff weeks aren't counted, and later weeks assume no other moves (a streamer could be swapped again)
const futureWeeks = Array.from({ length: Math.max(0, lastWeek - week) }, (_, i) => week + 1 + i);
const weekPts = w => p => (p.bye === w || outLong(p) ? 0 : rosSaved.future?.by?.[p.id]?.[w - week - 1] ?? rate(p));
const futureScores = r => futureWeeks.map(w => score(r, weekPts(w)));
function horizon(after, before, nowBase = weekScore(before), laterBase = futureScores(before), now = weekScore(after) - nowBase) {
  const weeks = [now, ...futureScores(after).map((x, i) => x - laterBase[i])], later = weeks.slice(1).reduce((t, x) => t + x, 0);
  return { now, later: futureWeeks.length ? later / futureWeeks.length : 0, total: now + later, weeks };
}
// a step that's mostly this week's points is a this-week pickup; gain is what its card leads with
const kindOf = s => Object.assign(s, s.later * futureWeeks.length >= s.now ? { kind: 'season', gain: s.later } : { kind: 'week', gain: s.now });
// "+6.0 this week · +2.0 a week after"
const sign = v => `${v >= 0 ? '+' : ''}${n(v)}`;
const gainText = (now, later) => `${sign(now)} this week${futureWeeks.length ? ` · ${sign(later)} a week after` : ''}`;
function bestSwap(roster, used = new Set()) {
  const nowBase = weekScore(roster), laterBase = futureScores(roster);
  // the league locks transactions: a player whose game has kicked off can't be added or dropped until next week
  const drops = roster.filter(p => p.slot !== 'IR' && (!HURT.includes(p.status) || p.inj?.season) && !used.has(p.id) && !locked(p));
  const out = [];
  for (const add of allFa) {
    if ((weekValue(add) <= 0 && seasonValue(add) <= 0) || used.has(add.id) || locked(add)) continue;
    let top = null;
    for (const drop of drops) {
      const g = horizon([...roster.filter(p => p !== drop), add], roster, nowBase, laterBase);
      // a long-term keeper is only dropped for someone a point a week better after this week
      if (g.later < 1 && isKeeper(drop)) continue;
      // on a tie, drop the weaker player
      if (!top || g.total > top.total + 0.05 || (g.total > top.total - 0.05 && weakness(drop, roster) < weakness(top.drop, roster))) top = { add, drop, ...g };
    }
    // under a point, this week or a week after, isn't worth a roster move
    if (top && top.total > 0 && Math.max(top.now, top.later) >= 1) out.push(kindOf(top));
  }
  return out.sort((a, b) => b.total - a.total).slice(0, 5);
}

// --- Trades. Managers judge a player by "value over replacement": how much better he is than the
// best player free on waivers at his position. A great tight end is rare, so he's worth more than
// his raw points say; raw points alone made swapping an elite TE for a RB look fair when it isn't.
const healthyFa = pos => (fa[pos] ?? []).filter(p => !HURT.includes(p.status)).map(rate).sort((a, b) => b - a);
const repl = Object.fromEntries(Object.keys(FA_SLOT).map(pos => [pos, healthyFa(pos)[1] ?? healthyFa(pos)[0] ?? 0]));
const vor = p => Math.max(0, rate(p) - (repl[p.pos] ?? 0));
// Who would start at a position (best by season average) in a roster
const myStartersAt = (roster, pos) => bestLineup(roster, seasonValue).lineup.map(x => x.player).filter(p => p.pos === pos).sort((a, b) => rate(b) - rate(a));
// "Stefon Diggs (9.4), Jakobi Meyers (9.1) and Malik Washington (8.2)"
const startersText = ps => ps.map(p => `${esc(p.name)} (${n(rate(p))})`).join(', ').replace(/, (?=[^,]*$)/, ' and ');
// A team that ends a trade with fewer players (2 for 1) fills the open roster spot with the best free agent.
// Counted for the other team only (see judge): my own trades have to stand on the players in them.
const faBest = allFa.filter(playable).sort((a, b) => seasonValue(b) - seasonValue(a));
const refill = (after, before) => (after.length < before.length ? [...after, ...faBest.slice(0, before.length - after.length)] : after);
// Effect of a trade on both teams. give = players I send, take = players I get.
let myLater; // my lineup's later weeks as is, worked out once
function judge(give, take, them) {
  const mineAfter = [...me.roster.filter(p => !give.includes(p)), ...take];
  const theirsAfter = [...them.roster.filter(p => !take.includes(p)), ...give];
  // this week: a starter of mine whose game has kicked off already scored for me, traded or not; a player
  // I'd get counts like a bench player (0 once his game has kicked off)
  const mineWeek = weekScore([...me.roster.filter(p => !give.includes(p) || (locked(p) && isStarter(p))), ...take.map(p => ({ ...p, slot: 'Bench' }))]) - weekScore(me.roster);
  // my side isn't refilled with a free agent: the trade has to be good on its own players (the best free agent
  // is already its own pickup suggestion, and counting him made giving up a QB and a starting RB look like a win)
  const h = horizon(mineAfter, me.roster, 0, myLater ??= futureScores(me.roster), mineWeek);
  return {
    // per week over the rest of the season, this week included
    mine: h.total / (futureWeeks.length + 1),
    mineWeek, mineLater: h.later, weeks: h.weeks,
    theirs: score(refill(theirsAfter, them.roster), seasonValue) - score(them.roster, seasonValue),
    vorGive: give.reduce((s, p) => s + vor(p), 0), vorTake: take.reduce((s, p) => s + vor(p), 0),
    after: mineAfter,
  };
}

// 1-for-1 trades for the bench check (the best trade that sends a bench player away): worth 2+ a week to me
// and fair to them on value over replacement, or 1+ to me costing them up to 1.5. The Trade ideas page uses the
// fleece search below (1- or 2-for-1).
const tradeable = p => playable(p) && !['K', 'D/ST'].includes(p.pos) && rate(p) > 0;
const tradesOpen = !(league.settings.tradeSettings?.deadlineDate < Date.now());
const tradeOk = (j, strict) => (strict ? j.mine >= 2 && j.theirs >= -0.5 : j.mine >= 1 && j.theirs >= -1.5);
const trades = [];
for (const t of teams) {
  if (t === me || !tradesOpen) continue;
  for (const give of me.roster.filter(tradeable)) for (const take of t.roster.filter(tradeable)) {
    if (vor(give) < vor(take) * 0.85) continue;
    const j = judge([give], [take], t);
    if (tradeOk(j, false)) trades.push({ team: t, give, take, ...j, strict: tradeOk(j, true) });
  }
}
trades.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs));
// shared bits of the trade ideas and fleece lists (the page script shows/hides cards)
const poolEmpty = `<div class="card empty pool-empty" hidden>${tradesOpen ? 'Nothing here with this check. Try the looser check or another team.' : 'The trade deadline has passed.'}</div>`;
const poolMore = '<div class="tools2" style="margin-bottom:10px"><button type="button" class="btn" data-more>Show more</button><button type="button" class="btn" data-next>New batch</button></div>';

// --- Adds / drops / trades around the league, last 3 weeks. Also my pending claims and trade
// offers, and other teams' offers and claims that didn't happen (ESPN's app hides those).
const moves = [], pendingTx = new Map(), intel = new Map(), othersPending = new Map(), myFailed = [];
const involvesMe = tx => (tx.items ?? []).some(i => i.toTeamId === me.id || i.fromTeamId === me.id);
const waiverRuns = []; // when ESPN processed claims (ms), to show the real waiver time
// What's really still pending: my claims and offers, and trades between other teams (offered, or in league review)
for (const tx of (await get(`${LEAGUE}?view=mPendingTransactions`)).pendingTransactions ?? []) {
  if (!tx.isPending || tx.status !== 'PENDING') continue;
  if (['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && involvesMe(tx)) pendingTx.set(tx.id, tx);
  else if (tx.type.startsWith('TRADE') && !involvesMe(tx) && (tx.items ?? []).some(i => i.type === 'TRADE')) othersPending.set(tx.id, tx);
}
for (let wk = Math.max(1, week - 2); wk <= week; wk++) {
  const d = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${wk}`);
  for (const tx of d.transactions ?? []) {
    if (tx.type === 'WAIVER' && tx.status?.startsWith('FAILED') && tx.teamId === me.id) myFailed.push(tx);
    else if (tx.status !== 'EXECUTED' && tx.status !== 'PENDING' && ['WAIVER', 'TRADE_PROPOSAL'].includes(tx.type) && !involvesMe(tx)) intel.set(tx.id, tx);
    // only claims the nightly run decided (a canceled claim's date is when it was canceled)
    if (tx.type === 'WAIVER' && tx.processDate && !tx.isPending && (tx.status === 'EXECUTED' || tx.status?.startsWith('FAILED'))) waiverRuns.push(tx.processDate);
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
    const base = me.roster.filter(r => !drop.some(d => d.id === r.id));
    const gain = list => { const r = [...base, ...list.map(a => ({ ...a, slot: 'Bench' }))]; return { week: weekScore(r) - weekScore(me.roster), season: score(r, seasonValue) - score(me.roster, seasonValue) }; };
    const mine = gain(add);
    // same drop, any other free agent: is someone better than the player I claimed?
    const alt = add.length !== 1 ? null : allFa.filter(c => c.id !== add[0].id && !locked(c) && playable(c)).map(c => ({ c, ...gain([c]) })).sort((a, b) => b.season - a.season)[0];
    return { kind: 'waiver', id: tx.id, add, drop, ...mine, better: alt && alt.season > mine.season + 0.5 ? alt : null };
  }
  const them = teams.find(t => t.id === tx.items.map(i => (i.fromTeamId === me.id ? i.toTeamId : i.fromTeamId)).find(id => id !== me.id));
  const give = tx.items.filter(i => i.fromTeamId === me.id).map(i => me.roster.find(r => r.id === i.playerId) ?? p(i.playerId));
  const take = tx.items.filter(i => i.toTeamId === me.id).map(i => them.roster.find(r => r.id === i.playerId) ?? p(i.playerId));
  return { kind: 'trade', id: tx.id, mineOffer: tx.teamId === me.id, them, give, take, ...judge(give, take, them) };
});

// Start from the roster as it will be once my pending waiver claims go through, so the plan doesn't
// suggest a second pickup for the same hole, or a player I've already claimed.
// next week counts with next week's own projection (who's playing whom), later weeks with rest-of-season
const nextValue = p => (playable(p) ? nextProj.get(p.id) ?? rate(p) : 0);
// Teams ahead of me on waivers that are short at a position next week (too few healthy players without a bye)
const shortNextWeek = pos => teams.filter(t => t !== me && t.waiver < me.waiver && t.roster.filter(p => p.pos === pos && p.slot !== 'IR' && playable(p) && p.bye !== week + 1).length < (slotCounts[FA_SLOT[pos]] || 1));
// A waiver player is likely gone if as many rivals need his position as there are waiver players there they'd take first
// ponytail: assumes rivals claim by next week's projection; their real picks may differ
const lostOnWaivers = (c, taken) => {
  if (!c.wa) return false;
  const k = shortNextWeek(c.pos).length;
  return k > 0 && allFa.filter(o => o.wa && o.pos === c.pos && o.id !== c.id && !taken.has(o.id) && nextValue(o) > nextValue(c)).length < k;
};
const claims = pending.filter(m => m.kind === 'waiver');
for (const m of claims) {
  const a = m.add.length === 1 ? allFa.find(c => c.id === m.add[0].id) ?? m.add[0] : null;
  if (!a) continue;
  m.likelyLost = lostOnWaivers(a, new Set()) ? shortNextWeek(a.pos) : null;
  m.byeFor = me.roster.filter(p => p.pos === a.pos && p.slot !== 'IR' && p.bye === week + 1 && !m.drop.some(d => d.id === p.id));
  m.nextPts = nextProj.get(a.id) ?? null;
}
// what each claim does to next week's lineup (byes out, next week's projections)
const nextScore = r => score(r.filter(p => p.bye !== week + 1), nextValue);
for (const m of claims) m.nextGain = nextProj.size ? nextScore([...me.roster.filter(p => !m.drop.some(d => d.id === p.id)), ...m.add.map(a => ({ ...a, slot: 'Bench' }))]) - nextScore(me.roster) : 0;
// a claim I'll likely lose doesn't count: the plan should still fill that hole
const sureClaims = claims.filter(m => !m.likelyLost);
const baseRoster = [...me.roster.filter(p => !sureClaims.some(m => m.drop.some(d => d.id === p.id))), ...sureClaims.flatMap(m => m.add.map(a => ({ ...a, slot: 'Bench' })))];
const rosterSpots = Object.entries(slotCounts).filter(([id]) => +id !== 21).reduce((t, [, k]) => t + k, 0);
// A backup's worth = the points he'd add over the rest of the season, week by week with everyone's bye
// weeks taken out (a second kicker only helps on your kicker's bye; a defense helps when yours is off).
// Small extra for RB/WR/TE: they get hurt most, so a backup there covers injuries too.
// only the next 2 weeks: a bye further out can be covered by grabbing someone that week
const restWeeks = Array.from({ length: Math.max(0, Math.min(2, lastWeek - week)) }, (_, i) => week + 1 + i);
const byeScore = roster => restWeeks.reduce((t, w) => t + score(roster.filter(p => p.bye !== w), w === week + 1 && nextProj.size ? nextValue : seasonValue), 0);
const fills = [];
while (rosterSpots - baseRoster.filter(p => p.slot !== 'IR').length > 0 && fills.length < 5) {
  const taken = new Set([...claims.flatMap(m => m.add.map(a => a.id)), ...fills.map(f => f.add.id)]);
  const before = byeScore(baseRoster);
  const scored = allFa.filter(c => !taken.has(c.id) && !locked(c) && playable(c)).map(c => {
    const r = [...baseRoster, { ...c, slot: 'Bench' }];
    return { add: c, week: weekScore(r) - weekScore(baseRoster), season: score(r, seasonValue) - score(baseRoster, seasonValue), rest: byeScore(r) - before,
      worth: weekScore(r) - weekScore(baseRoster) + byeScore(r) - before + (['RB', 'WR', 'TE'].includes(c.pos) ? 0.5 * rate(c) : 0) - (c.wa ? 1 : 0) }; // waiver claims can be lost: -1
  }).sort((a, b) => b.worth - a.worth);
  const best = scored.find(s => !lostOnWaivers(s.add, taken));
  if (!best) break;
  // the better player we skipped because a team ahead of me on waivers will likely take him
  const lost = scored.find(s => s.add.pos === best.add.pos && s.worth > best.worth && lostOnWaivers(s.add, taken));
  if (lost) best.lost = { p: lost.add, rivals: shortNextWeek(lost.add.pos) };
  // a runner-up within half a point is a coin flip: say so instead of pretending one is clearly best
  const close = scored.find(s => s !== best && s.add.pos === best.add.pos && best.worth - s.worth < 0.5 && !lostOnWaivers(s.add, taken));
  if (close) best.close = close.add;
  best.byeFor = baseRoster.filter(p => p.pos === best.add.pos && p.slot !== 'IR' && p.bye === week + 1);
  best.alts = scored.filter(s => s !== best && s.add.pos === best.add.pos).slice(0, 3).map(s => s.add);
  fills.push(best);
  baseRoster.push({ ...best.add, slot: 'Bench' });
}
// A claim I'll likely lose, at a spot a free agent can fill now: add the free agent, and make the claim drop him.
// Win the claim and the better player replaces him; lose it and the hole is still covered.
for (const m of claims) if (m.likelyLost && !m.drop.length) {
  const f = fills.find(x => x.add.pos === m.add[0].pos && !x.add.wa && !x.claim);
  if (f) { f.claim = m; m.backupFill = f.add; }
}
// "Also considered: McLaughlin (9.2), Smack (9.1, waivers)." so a missing or better option is visible
const alsoText = (list, val) => (list.length ? ` Also considered: ${list.map(c => `${c.name} (${n(val(c))}${c.wa ? ', waivers' : ''})`).join(', ')}.` : '');
const fillValue = f => (f.byeFor.length && nextProj.size ? nextValue : rate); // what the fill is judged on: his bye week, or the rest of the season
const they = p => (p.pos === 'D/ST' ? 'they' : 'he'), They = p => (p.pos === 'D/ST' ? 'They' : 'He');
// "Dominic Zvada is on bye in week 8. Expected 9.2 that week (ESPN)." + who we skipped and why
const byeText = f => (f.byeFor.length && nextProj.has(f.add.id) ? ` ${f.byeFor.map(p => p.name).join(' and ')} ${f.byeFor.length > 1 ? 'are' : 'is'} on bye in week ${week + 1}. ${They(f.add)}'${f.add.pos === 'D/ST' ? 're' : 's'} expected ${n(nextProj.get(f.add.id))} that week (ESPN's projection).` : '')
  + (f.lost ? ` ${f.lost.p.name} is expected ${n(nextValue(f.lost.p))}, but ${they(f.lost.p)}'${f.lost.p.pos === 'D/ST' ? 're' : 's'} on waivers and ${f.lost.rivals.map(t => `${t.name} (${ordinal(t.waiver)})`).join(', ')} ${f.lost.rivals.length > 1 ? 'pick' : 'picks'} before you (${ordinal(me.waiver)}) and also ${f.lost.rivals.length > 1 ? 'need' : 'needs'} a ${POS_NAME[f.add.pos].toLowerCase()} that week, so you'd likely lose that claim.` : '')
  + (f.close ? ` Close call: ${f.close.name}${nextProj.has(f.close.id) && f.byeFor.length ? ` (${n(nextProj.get(f.close.id))} that week)` : ''} is about as good${f.close.wa ? ', but on waivers' : ''}, so either is fine.` : '')
  + alsoText(f.alts, fillValue(f));
// Better backups: a free player 2+ a game better (rest of season) than one of my bench players at the same spot.
// The best one also goes on the to-do list (a free upgrade); a backup only scores when a starter is out, so the gain is small.
const seasonStarterIds = new Set(bestLineup(baseRoster, seasonValue).lineup.map(x => x.player.id));
const benchTaken = new Set([...claims.flatMap(m => m.add.map(a => a.id)), ...fills.map(f => f.add.id)]);
const benchUps = baseRoster.filter(p => !seasonStarterIds.has(p.id) && p.slot !== 'IR' && ['QB', 'RB', 'WR', 'TE'].includes(p.pos))
  .map(p => { const c = allFa.filter(c => c.pos === p.pos && playable(c) && !locked(c) && !benchTaken.has(c.id)).sort((a, b) => rate(b) - rate(a)); return { drop: p, add: c[0], alts: c.slice(1, 4) }; })
  .filter(x => x.add && rate(x.add) - rate(x.drop) >= 2).sort((a, b) => rate(b.add) - rate(b.drop) - (rate(a.add) - rate(a.drop)));
// One plan, done in order: each step is applied before picking the next, so every step
// drops a different player and players added earlier in the plan are never dropped.
const plan = [];
{
  let roster = [...baseRoster];
  const used = new Set([...claims.flatMap(m => m.add.map(a => a.id)), ...fills.map(f => f.add.id)]);
  while (plan.length < 5) {
    const opts = bestSwap(roster, used);
    if (!opts.length) break;
    const s = opts[0];
    plan.push({ ...s, alts: opts.slice(1).filter(o => o.add.pos === s.add.pos).slice(0, 2) });
    used.add(s.add.id);
    roster = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
  }
  // Same set of drops, but paired with a same-position add where possible so steps read
  // naturally (defense for defense), then each step's gain is recounted in that order.
  // If the re-pairing leaves any step under a point, keep the original pairing (every step was 1+ there).
  const original = plan.map(s => s.drop), drops = [...original];
  for (const s of plan) { const k = drops.findIndex(d => d.pos === s.add.pos); s.drop = drops.splice(Math.max(k, 0), 1)[0]; }
  const recount = () => {
    roster = [...baseRoster];
    for (const s of plan) {
      const next = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
      kindOf(Object.assign(s, horizon(next, roster)));
      roster = next;
    }
  };
  recount();
  if (plan.some(s => s.total <= 0 || Math.max(s.now, s.later) < 1)) { plan.forEach((s, i) => { s.drop = original[i]; }); recount(); }
}
const weekPlanGain = plan.reduce((t, s) => t + s.now, 0);

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
  const extra = TRADE_POS.map(pos => [pos, t.roster.filter(p => p.pos === pos && playable(p) && !starters.includes(p) && !isStarter(p) && rate(p) >= 0.85 * typical[pos])]).filter(([, ps]) => ps.length);
  const count = Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map(pos => [pos, t.roster.filter(p => p.pos === pos && p.slot !== 'IR').length]));
  return { t, short, extra, count };
};
const myDepth = depth(me);
const partners = teams.filter(t => t !== me).map(depth).map(d => ({
  ...d,
  theyHave: d.extra.filter(([pos]) => myDepth.short.includes(pos)), // what they can give you
  youHave: myDepth.extra.filter(([pos]) => d.short.includes(pos)), // what you can give them
})).sort((a, b) => (b.theyHave.length && b.youHave.length) - (a.theyHave.length && a.youHave.length) || b.theyHave.length - a.theyHave.length);

// --- Fleece finder: trades that look fair on the number most managers check (points per game so far),
// but that the rest-of-season projections say clearly favor me. 1-for-1 and 2-for-1 (my two for their one).
// A trade only makes the list if there's a believable, true pitch for it (see pitches()).
// "Looser check" on the page also shows closer calls: 1+ a week to me, costing them 0.5+, a weaker pitch.
// ponytail: the other team's extra roster spot on a 2-for-1 isn't counted (they'd drop their worst bench player).
const f1 = v => (v ?? 0).toFixed(1); // (n() is defined further down)
const avgValue = p => (playable(p) ? p.avg ?? 0 : 0);
const fleece = [], ideas = [];
// For picking any player on the page: per player, my best offer that helps me and looks fair to them, fleece or not
const bestOffer = new Map();
for (const d of tradesOpen ? partners : []) {
  // "looks fair on points per game" means nothing for a player who hasn't played yet
  // and nobody ESPN projects at 0 this week while not on bye (benched): his old average won't sell him
  const mine = me.roster.filter(p => tradeable(p) && p.avg > 0 && !(p.espn === 0 && p.bye !== week)), theirs = d.t.roster.filter(p => tradeable(p) && p.avg > 0);
  const gives = [...mine.map(p => [p]), ...mine.flatMap((a, i) => mine.slice(i + 1).map(b => [a, b]))];
  for (const give of gives) for (const take of theirs) {
    // what they've actually scored this season has to back it up, not just the projections: 2 for 1 only for someone
    // better than each player I give (by points per game so far and rest of season), 1 for 1 not clearly worse so far
    const so = p => p.avg ?? 0;
    if (give.length > 1 ? give.some(g => so(take) < so(g) || rate(take) < rate(g)) : so(take) < so(give[0]) - 1.5) continue;
    const j = judge(give, [take], d.t);
    const best = bestOffer.get(take);
    if (j.mine <= 0 || j.mine < 1 && best && best.mine >= j.mine) continue;
    // what they'd see: their best lineup scored with season-so-far averages
    const looks = score([...d.t.roster.filter(p => p !== take), ...give], avgValue) - score(d.t.roster, avgValue);
    if (looks < -1) continue;
    const theirWeek = weekScore([...d.t.roster.filter(p => p !== take || (locked(p) && isStarter(p))), ...give.map(p => ({ ...p, slot: 'Bench' }))]) - weekScore(d.t.roster);
    const f = { d, give: [...give].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)), take, mine: j.mine, mineWeek: j.mineWeek, mineLater: j.mineLater, weeks: j.weeks, after: j.after, theirs: j.theirs, looks, theirWeek, strict: j.mine >= 2 && j.theirs <= -1 && looks >= 0 };
    if (!best || j.mine > best.mine) bestOffer.set(take, f);
    if (j.mine >= 1 && j.theirs <= -0.5) fleece.push(f);
    else if (j.mine >= 1) ideas.push(f); // fair by the projections too: an easy yes
  }
}
fleece.sort((a, b) => b.mine - b.theirs - (a.mine - a.theirs));
// up to 3 per team (the page picks the team and how many show), no player twice for the same team.
// A trade already pending on ESPN with the same players isn't shown again.
const tradeKey = (them, give, take) => `${them.id}|${give.map(p => p.id).sort()}|${take.map(p => p.id).sort()}`;
const offered = new Set(pending.filter(m => m.kind === 'trade').map(m => tradeKey(m.them, m.give, m.take)));
const fleecePool = [];
// Past that, "extra" cards (up to 3 per player I'd get) only show when I pick that player on the page.
for (const f of fleece) {
  if (offered.has(tradeKey(f.d.t, f.give, [f.take]))) continue;
  const same = fleecePool.filter(x => x.d === f.d), main = same.filter(x => !x.extra);
  const extra = main.length >= 3 || main.some(x => x.take === f.take || x.give.some(g => f.give.includes(g)));
  if (extra && same.filter(x => x.take === f.take).length >= 3) continue;
  const pitch = pitches(f);
  if (pitch) fleecePool.push({ ...f, extra, texts: pitch.texts, strict: f.strict && pitch.strength >= 4 });
}
// Trade ideas: good for me and they don't lose by the projections. Best for both first, up to 4 per team,
// a player I give at most twice; the normal check wants 2+ a week for me, the looser one 1+.
const ideaPool = [];
for (const f of ideas.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs))) {
  const same = ideaPool.filter(x => x.d === f.d);
  if (offered.has(tradeKey(f.d.t, f.give, [f.take])) || same.length >= 4 || f.give.some(g => same.filter(x => x.give.includes(g)).length >= 2)) continue;
  ideaPool.push({ ...f, texts: pitches(f, true).texts, strict: f.mine >= 2 });
}
// Every other player: my best offer for him (not a fleece), shown only when I pick him
const inPool = new Set(fleecePool.map(f => f.take));
for (const f of bestOffer.values()) {
  if (inPool.has(f.take) || offered.has(tradeKey(f.d.t, f.give, [f.take]))) continue;
  fleecePool.push({ ...f, extra: true, alt: true, texts: pitches(f, true).texts, strict: false });
}

// --- Bench check: does each bench player earn his spot? Needed = he'd start this week or in one of the next
// 4 weeks (byes, injuries), or he's the top backup at his spot and clearly better than any free player there.
// If not, his spot is free: the best waiver swap and the best trade that sends him away.
// ponytail: looks 4 weeks ahead; depth for the playoffs isn't counted.
const benchHorizon = [];
for (let w = week + 1; w <= Math.min(lastWeek, week + 4); w++) benchHorizon.push(w);
const futValue = w => p => (p.bye === w || !seasonValue(p) ? 0 : rosSaved.future?.by[p.id]?.[w - week - 1] ?? seasonValue(p));
const aheadScore = r => benchHorizon.reduce((s, w) => s + score(r, futValue(w)), 0);
const benchTakenAll = new Set([...benchTaken, ...plan.map(s => s.add.id)]);
const faFree = faBest.filter(o => !locked(o) && !benchTakenAll.has(o.id));
const benchCheck = baseRoster.filter(p => p.slot === 'Bench').map(p => {
  if (bestLineup(baseRoster, weekValue).lineup.some(x => x.player === p)) return { p, keep: 'He\'s in your best lineup this week.' };
  const w = benchHorizon.find(w => bestLineup(baseRoster, futValue(w)).lineup.some(x => x.player === p));
  if (w) {
    const off = baseRoster.find(x => x.pos === p.pos && x.bye === w && seasonStarterIds.has(x.id));
    return { p, keep: `He starts in week ${w}${off ? `, covering ${off.name}'s bye` : ''}.` };
  }
  const top = baseRoster.filter(x => x.pos === p.pos && x.slot !== 'IR' && !seasonStarterIds.has(x.id)).sort((a, b) => seasonValue(b) - seasonValue(a))[0];
  const fa = faFree.find(o => o.pos === p.pos);
  if (top === p && ['QB', 'RB', 'WR', 'TE'].includes(p.pos) && seasonValue(p) >= (fa ? seasonValue(fa) : 0) + 1.5)
    return { p, keep: `He's your top backup ${POS_NAME[p.pos].toLowerCase()} if a starter gets hurt, and the best free one${fa ? ` (${fa.name}, ${f1(rate(fa))} a game)` : ''} is clearly worse than his ${f1(rate(p))}.` };
  // spare: what the spot is worth instead (best free player per position, over the next 4 weeks)
  const others = baseRoster.filter(x => x !== p), now = aheadScore(baseRoster);
  let swap = null;
  for (const pos of Object.keys(FA_SLOT)) for (const o of faFree.filter(o => o.pos === pos).slice(0, 6)) {
    const gain = aheadScore([...others, { ...o, slot: 'Bench' }]) - now;
    if (gain >= 1 && (!swap || gain > swap.gain)) swap = { add: o, gain };
  }
  const trade = trades.filter(t => t.give === p).sort((a, b) => b.mine - a.mine)[0];
  const steal = trade ? null : fleece.filter(f => f.give.includes(p)).sort((a, b) => b.mine - a.mine)[0];
  return { p, swap, trade, steal, planned: plan.some(s => s.drop === p) || benchUps.some(x => x.drop === p) };
});
// Texts to send. Every fact is checked against the real numbers before it's used: season averages, who
// they start now, this week's projection, injury tags, bye weeks, and which spots each team is short or
// deep at. Only the framing is salesy. Returns null when there's no honest, believable pitch, so an
// obviously lopsided trade (worse player by every number they can see) never makes the list.
// Brody's texting voice, from his own iMessages: short, first letter capitalized, no period at the end,
// "?" on questions; casual slang (bro, deadass, tho, cuz, hella, kinda, rn, lmao, wtf); joins thoughts with "and"/"but"
// instead of new sentences; an occasional 😭 or 😢; hedges like "I'm pretty sure" / "I'm not saying it's bad but".
const VOICE = `short and casual, first letter capitalized, no period at the end of a message, "?" on questions. Slang I use: bro, deadass, tho, cuz, hella, kinda, rn, lmao, wtf (not every message). I join thoughts with "and" or "but" instead of new sentences, sometimes hedge ("I'm pretty sure", "I'm not saying it's bad but"), and rarely add 😭 or 😢. No "lmk", no "fair", nothing that sounds formal. Real examples of mine: "Bro deadass", "I haven't looked into it tho", "I gotta do my college stuff this week", "Lightroom is not the best but it's really good and it's used because it's good for editing", "Yeah Freiermuth is a no go. What would you want with Diggs for Jefferson?"`;
// plain: always return something (a bare "X for Y?" when there's no true selling point)
function pitches(f, plain) {
  const { give, take, d } = f, g = give[0], two = give.length > 1;
  const last = p => (p.pos === 'D/ST' ? p.name : p.name.replace(/ (Jr\.|Sr\.|II|III|IV|V)$/, '').split(' ').slice(-1)[0]);
  const posName = pos => POS_NAME[pos].toLowerCase(), both = give.map(last).join(' and '), sum = give.reduce((s, p) => s + (p.avg ?? 0), 0);
  const startable = p => (p.avg ?? 0) >= 0.8 * (typical[p.pos] ?? 0);
  const facts = []; // [how convincing, text]
  const weak = (lineups.get(d.t) ?? []).map(x => x.player).filter(p => p.pos === g.pos && p !== take).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))[0];
  if (weak && (g.avg ?? 0) >= (weak.avg ?? 0) + 2) facts.push([3, `you're starting ${weak.name} at ${posName(g.pos)} rn and ${last(g)} is putting up ${f1(g.avg)} a game`]);
  if (two && give.every(startable)) facts.push([3, sum > (take.avg ?? 0) ? `that's 2 guys you can actually start, like ${f1(sum)} a game combined` : `that's 2 guys you can actually start for 1`]);
  if (!two && +f1(g.avg) > +f1(take.avg)) facts.push([3, `${last(g)} has been outscoring ${last(take)} this year tho (${f1(g.avg)} vs ${f1(take.avg)})`]);
  if (f.theirWeek >= 2) facts.push([2, `it'd get you like ${Math.round(f.theirWeek)} more points this week too`]);
  const hurt = ['QUESTIONABLE', 'DOUBTFUL', 'OUT', 'INJURY_RESERVE'].includes(take.status);
  if (take.bye > week && take.bye <= week + 2) facts.push([1, `${last(take)} has his bye week ${take.bye} btw`]);
  const reason = myDepth.short.includes(take.pos) ? `I'm thin at ${posName(take.pos)} rn and need one` : myDepth.extra.some(([pos]) => give.some(p => p.pos === pos)) ? `I got more ${posName(g.pos)}s than I can start` : '';
  const strength = facts.reduce((s, [k]) => s + k, 0) + (hurt ? 2 : 0) + (reason ? 1 : 0);
  const cap = t => t[0].toUpperCase() + t.slice(1), say = (...parts) => parts.filter(Boolean).map(cap).join(' ');
  const T = last(take);
  if (strength < 2 || !facts.length) return plain ? { texts: [say(`would you do ${both} for ${T}?`), say(`${both} for ${T}?`)], strength } : null; // 4+ passes the normal check; 2+ only the looser one
  const top = facts.sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, t]) => t);
  const [s1] = top, all = top.join(' and ');
  const out = [
    say(`would you do ${both} for ${T}?`, all),
    reason ? say(`${reason}, would you do ${both} for ${T}?`, s1) : say(`yo would you do ${both} for ${T}?`, s1),
    hurt ? say(`deadass this is hella risky for me cuz ${T} is hurt but I'd still do ${both} for him 😭`) : say(`thoughts on ${both} for ${T}?`, all),
    say(`${s1} so would you do ${both} for ${T}?`),
    say(`bro ${both} for ${T}?`, s1),
    say(`what would it take to get ${T}? I'd do ${both}`),
    say(`${both} for ${T}?`, top[top.length - 1]),
  ];
  return { texts: [...new Set(out)], strength };
}
// what Claude needs to write its own version: the trade and only true facts
const claudePrompt = f => `Write a short text (1-2 sentences) in my voice to my fantasy football league mate proposing this trade. My voice: ${VOICE} I give: ${f.give.map(p => `${p.name} (${p.pos})`).join(' and ')}. I get: ${f.take.name} (${f.take.pos}). Use ONLY these true facts, don't make up any stats or news, don't say it's lopsided: ${[
  ...f.give.map(p => `${p.name} averages ${f1(p.avg)} points a game this season${p.rank ? `, ${ordinal(p.rank)} at ${p.pos}` : ''}`),
  `${f.take.name} averages ${f1(f.take.avg)} a game${f.take.status && STATUS[f.take.status] ? ` and is listed as "${STATUS[f.take.status][0].toLowerCase()}"` : ''}${f.take.bye > week ? `, bye in week ${f.take.bye}` : ''}`,
  f.d.short.length ? `their team is short at ${f.d.short.map(p => POS_NAME[p].toLowerCase()).join(', ')}` : '',
  f.theirWeek >= 1 ? `it would add about ${Math.round(f.theirWeek)} projected points to their lineup this week` : '',
].filter(Boolean).join('; ')}. Give me 3 different versions.`;
// a trade card's compare/check buttons, text to send, and propose on ESPN
const offerButtons = f => `<p class="pitch">${esc(f.texts[0])}</p>
  <div class="tools2"><button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-copy="${esc(f.texts[0])}">Copy text</button>${f.texts.length > 1 ? `<button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-versions="${esc(JSON.stringify(f.texts))}">Another version</button>` : ''}</div>
  ${MOVE_URL ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `Propose ${f.give.map(p => p.name).join(' + ')} for ${f.take.name} on ESPN`, type: 'TRADE_PROPOSAL', other: f.d.t.id, sms: f.d.t.name, items: [...f.give.map(p => ({ type: 'GIVE', playerId: p.id })), { type: 'GET', playerId: f.take.id }], week: league.scoringPeriodId }))}">Propose on ESPN, then text them</button>` : ''}
  <details class="all"><summary>More</summary><div class="tools2">${cmpBtn(f.give[0], f.take)}${tcBtn(f.give, [f.take])}</div><button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-claude="${esc(claudePrompt(f))}">Have Claude write it</button></details>`;

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

const gamesPlayed = Object.keys(weekly).length || 1;
const leagueAvg = teams.reduce((s, t) => s + t.pf, 0) / teams.length / gamesPlayed;
// How hard each team's remaining opponents are: average best lineup they face, 1 = easiest in the league.
const schedHard = new Map(teams.map(t => {
  const gs = (league.schedule ?? []).filter(g => g.matchupPeriodId > week && g.matchupPeriodId <= lastWeek && g.away && (g.home.teamId === t.id || g.away.teamId === t.id));
  return [t, gs.length ? gs.reduce((s, g) => s + score(teams.find(x => x.id === (g.home.teamId === t.id ? g.away.teamId : g.home.teamId)).roster, futValue(g.matchupPeriodId)), 0) / gs.length : null];
}));
const schedEase = t => (schedHard.get(t) == null ? null : 1 + teams.filter(x => schedHard.get(x) != null && schedHard.get(x) < schedHard.get(t)).length);
// --- Schedule ahead: each remaining opponent's best lineup that week (ESPN's projection for that week, so his NFL
// matchup counts; players on bye, on IR or out for the season count 0), against the league's average that week.
// Starters from their full-strength lineup who are off that week are named; losing 15+ points of them makes it easy.
const ahead = (league.schedule ?? []).filter(g => g.matchupPeriodId > week && g.matchupPeriodId <= lastWeek && (g.home.teamId === me.id || g.away?.teamId === me.id))
  .sort((a, b) => a.matchupPeriodId - b.matchupPeriodId)
  .map(g => {
    const w = g.matchupPeriodId, v = futValue(w), t = teams.find(x => x.id === (g.home.teamId === me.id ? g.away.teamId : g.home.teamId));
    const proj = score(t.roster, v), avg = teams.reduce((s, x) => s + score(x.roster, v), 0) / teams.length;
    const full = bestLineup(t.roster, seasonValue).lineup.map(x => x.player), off = full.filter(p => !v(p));
    const lost = off.reduce((s, p) => s + seasonValue(p), 0);
    return { week: w, t, proj, off, level: lost >= 15 || proj < avg - 5 ? 'easy' : proj > avg + 5 ? 'hard' : 'medium' };
  });

// --- Waiver competition: teams that pick before you and would also want the player
const rivalsFor = (add, value) => teams.filter(t => t !== me && t.waiver < me.waiver && score([...t.roster, add], value) - score(t.roster, value) >= 1);

// --- To-do list, most urgent first. Each item: [level, title, why]
const n = v => (v == null ? '-' : v.toFixed(1));
const cap = d => d[0] + d.slice(1).toLowerCase();
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const procDays = new Set(league.settings.acquisitionSettings?.waiverProcessDays ?? ['WEDNESDAY']);
const waiverDay = [2, 3, 4, 5, 6, 0, 1].map(i => DAYS[i]).find(d => procDays.has(d)) ?? 'WEDNESDAY';
const waiverEve = cap(DAYS[(DAYS.indexOf(waiverDay) + 6) % 7]).slice(0, 3); // 'Tue', like etDay
const noProc = DAYS.filter(d => !procDays.has(d));
// Typical time claims go through (median of recent runs), and the next run, in Pacific time
const ptParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
// Earliest start of any recent run: a claim has to be in before then. Each run takes a few minutes, so it's the
// first claim of each night that counts. ponytail: assumes runs never cross midnight Pacific (they're ~12:30 AM).
const runMin = waiverRuns.length ? Math.min(...waiverRuns.map(t => { const p = ptParts(new Date(t)); return +p.hour * 60 + +p.minute; })) : null;
// rounded down to 5 minutes, since it is shown as "as early as"
const clock = m => { const h = Math.floor(m / 60), mm = Math.floor((m % 60) / 5) * 5; return `${(h % 12) || 12}${mm % 60 ? ':' + String(mm % 60).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const nextRun = runMin == null ? '' : (() => {
  const now = ptParts(new Date()), nowMin = +now.hour * 60 + +now.minute;
  for (let i = 0; i < 8; i++) {
    const day = ptParts(new Date(Date.now() + i * 864e5)).weekday.toUpperCase();
    if (procDays.has(day) && (i > 0 || nowMin < runMin)) return `${i === 0 ? 'tonight/today' : i === 1 ? 'tomorrow' : cap(day)} (${cap(day).slice(0, 3)}), as early as ${clock(runMin)} Pacific${runMin < 240 ? `, which is late ${cap(DAYS[(DAYS.indexOf(day) + 6) % 7])} night` : ''}`;
  }
  return '';
})();
const procText = !noProc.length ? 'every day' : procDays.size >= 4 ? `every day except ${noProc.map(cap).join(' and ')}` : `on ${[...procDays].map(cap).join(', ')}`;
// "ESPN 12.3, Rotowire 6.1, CBS 9.0" for whichever sources have a number
const srcText = p => [['ESPN', p.espn], ['Rotowire', p.roto], ['CBS', p.cbs], ['FantasyPros', p.fp]].filter(([, v]) => v != null).map(([s, v]) => `${s} ${n(v)}`).join(', ');
// The (i) button on a suggestion: every number behind it and where it came from
const SOURCES_NOTE = "This week: average of ESPN, Rotowire (via Sleeper), CBS Sports and FantasyPros (expert consensus) projections, each weighted by how close it has been in your league's scoring once 3 weeks are saved. Later weeks: ESPN only (the others don't project that far ahead). Rest of season: average of the four (FantasyPros from their rest-of-season expert rankings). Injuries and bye weeks: ESPN. Practice reports: NFL.com; chance to play: Footballguys' count of injury reports, 2017-2024, moved by each player's own record when listed (nflverse injury reports and snap counts, last 5 seasons). Rosters, waiver order and claims: your ESPN league.";
const srcLine = p => {
  const ros = ['ESPN', 'Rotowire', 'CBS'].map((s, i) => (p.rosBy?.[i] != null ? `${s} ${n(p.rosBy[i])}` : '')).filter(Boolean).join(', '), odds = playOdds(p, p.inj?.type);
  return `<b>${esc(p.name)}</b>: this week ${esc(srcText(p) || 'no projection (bye or not playing)')}${srcText(p).includes(',') ? `, average ${n(p.proj)}` : ''}` +
    `${nextProj.has(p.id) ? `; next week ESPN ${n(nextProj.get(p.id))}` : ''}; rest of season per game ${esc(ros || 'none')}` +
    `${p.status ? `; status: ${esc(statusWords(p))} (ESPN)${odds ? `, ${odds.pct}% chance to play (${esc(odds.why)})` : ''}` : ''}.`;
};
// Compare / Trade check buttons on any card that swaps players: out = who you'd lose (drop or give), inn = who you'd get.
// The page opens Compare or the trade checker with those players already filled in.
const exShown = new Map();
const exBtn = (label, attr, ps) => { ps.forEach(p => p && p.pos !== '?' && exShown.set(p.id, p)); return `<button type="button" class="btn" style="background:var(--chip);color:var(--fg)" ${attr}>${label}</button>`; };
const cmpBtn = (a, b, label = 'Compare') => (a && b ? exBtn(label, `data-cmp2="${a.id},${b.id}"`, [a, b]) : '');
const tcBtn = (out, inn, label = 'Trade check') => (out.length && inn.length ? exBtn(label, `data-tc="${out.map(p => p.id).join(',')};${inn.map(p => p.id).join(',')}"`, [...out, ...inn]) : '');
// a small one inside a line of text (League's lists)
const cmpChip = (a, b) => cmpBtn(a, b).replace('class="btn" style="', 'class="btn" style="width:auto;min-height:0;padding:3px 10px;margin:0 4px;font-size:12px;');
const exBtns = (out, inn, trade) => `<div class="tools2">${cmpBtn(out[0], inn[0])}${trade ? tcBtn(out, inn) : ''}</div>`;
const info = ps => (ps.length ? `<details class="info"><summary aria-label="Where this comes from" title="Where this comes from">i</summary><div>${ps.map(p => `<p>${srcLine(p)}</p>`).join('')}<p>${SOURCES_NOTE}</p></div></details>` : '');
// --- Roster moves the site can send to ESPN (through worker.js). Slot ids are ESPN's lineupSlotId.
const SLOT_ID = Object.fromEntries(Object.entries(SLOT).map(([id, name]) => [name, +id]));
// The best lineup as ESPN moves. Starters already in a spot that fits them stay put (so a player
// whose game has started is never moved); the rest fill the open spots, narrowest first.
function lineupMove() {
  const starting = new Set(best.lineup.map(x => x.player.id));
  const open = Object.entries(slotCounts).filter(([id, k]) => k > 0 && SLOT_POS[id]).flatMap(([id, k]) => Array(k).fill(+id));
  const to = new Map();
  for (const p of me.roster) {
    const i = starting.has(p.id) && SLOT_POS[SLOT_ID[p.slot]]?.includes(p.pos) ? open.indexOf(SLOT_ID[p.slot]) : -1;
    if (i >= 0) to.set(p.id, open.splice(i, 1)[0]);
  }
  open.sort((a, b) => SLOT_POS[a].length - SLOT_POS[b].length);
  for (const { player: p } of best.lineup) {
    if (to.has(p.id)) continue;
    const i = open.findIndex(id => SLOT_POS[id].includes(p.pos));
    if (i < 0) return null;
    to.set(p.id, open.splice(i, 1)[0]);
  }
  const items = me.roster.filter(p => p.slot !== 'IR').map(p => ({ type: 'LINEUP', playerId: p.id, from: SLOT_ID[p.slot], to: to.get(p.id) ?? SLOT_ID.Bench })).filter(x => x.from !== x.to);
  return items.length ? { label: 'Set my best lineup on ESPN', type: 'ROSTER', items } : null;
}
const bestMove = lineupMove();
const pickupMove = s => ({ label: s.add.wa ? 'Put in this waiver claim on ESPN' : 'Do this pickup on ESPN', type: s.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: s.add.id }, { type: 'DROP', playerId: s.drop.id }] });
// memo.sent = key -> when sent; memo.q = my players who were questionable or doubtful last run -> that status (1 = questionable, older runs); memo.downSince = source -> since when
let memo = { sent: {}, q: {}, downSince: {} }, memoOk = false;
const memoFile = path.join(dir, 'state', 'alerts.json');
if (fs.existsSync(memoFile)) { memo = { ...memo, ...JSON.parse(fs.readFileSync(memoFile, 'utf8')) }; memoOk = true; }
else try {
  const r = await fetch(`https://mrbrofo.github.io/Fantasy-app/alerts.json?t=${Date.now()}`);
  if (r.status === 404) memoOk = true; // first run ever
  else if (r.ok) { memo = { ...memo, ...await r.json() }; memoOk = true; }
} catch (err) { console.warn('Saved alerts skipped:', err.message); }
// When ESPN starts the next week. It publishes no time, so the first update that sees the new week number writes down
// the moment (updates run every few minutes, so it's that close); the last 6 are kept. memo.week = the week last run saw
if (memo.week && memo.week < week) memo.turns = [...(memo.turns ?? []), Date.now()].slice(-6);
memo.week = week;
const lastTurn = memo.turns?.at(-1) && new Date(memo.turns.at(-1)).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const turnNote = lastTurn ? `last week it turned over ${lastTurn}` : "early Tuesday morning, after Monday night's game";
// A pending waiver claim, judged: the verdict on its card in Pending, and what the to-do list flags
function claimCheck(m) {
  // neither starts, so the lineup doesn't change, but one is clearly the better backup for byes and injuries (2+ a game)
  const bdiff = m.add.length === 1 && m.drop.length === 1 ? rate(m.add[0]) - rate(m.drop[0]) : 0, backup = bdiff >= 2, worseBackup = bdiff <= -2;
  // a kicker or defense added while you already carry a spare one, dropping someone else: drop your worst spare instead
  const kp = m.add.length === 1 && ['K', 'D/ST'].includes(m.add[0].pos) && !m.drop.some(d => d.pos === m.add[0].pos) && m.add[0].pos;
  const spare = kp && me.roster.filter(p => p.pos === kp && p.slot !== 'IR' && p.id !== m.add[0].id).sort((a, b) => rate(a) - rate(b)), stack = spare && spare.length > (slotCounts[FA_SLOT[kp]] || 1) ? spare[0] : null;
  const covers = m.byeFor?.length && m.nextPts > 0;
  // a one-week rental: helps this week, but the dropped player is better after that, or the next 2 weeks get worse
  const ahead = byeScore([...me.roster.filter(r => !m.drop.some(d => d.id === r.id)), ...m.add.map(a => ({ ...a, slot: 'Bench' }))]) - byeScore(me.roster);
  const worse = m.drop.length === 1 && m.add.length === 1 && seasonValue(m.drop[0]) - seasonValue(m.add[0]) >= 1, keeps = m.drop.filter(isKeeper);
  const rental = m.week >= 1 && m.season < 0.5 && m.drop.length > 0 && (worse || ahead <= -1);
  // likely to lose it isn't a reason to cancel: a lost claim costs nothing, a canceled one is a sure miss. The card says so
  const v = stack ? ['bad', `Drop ${stack.name} instead`] : covers ? ['good', `Covers your week ${week + 1} bye`] : rental ? (keeps.length ? ['bad', 'Drops a keeper for one week'] : ['meh', 'One-week rental']) : m.week >= 1 || m.nextGain >= 1 || m.season >= 1 ? ['good', 'Good claim'] : m.week <= -1 || m.season <= -1 ? ['bad', 'Bad claim, cancel it'] : backup ? ['good', 'Better backup'] : worseBackup ? ['bad', 'Worse backup, cancel it'] : ['meh', 'Barely matters'];
  return { bdiff, backup, worseBackup, kp, spare, stack, covers, ahead, worse, keeps, rental, v };
}
const todo = [];
for (const p of starters(me)) {
  if (p.bye === week) todo.push(['urgent', `Take ${p.name} out of your lineup`, `His team (${p.teamName}) is on bye.`, bestMove, [p]]);
  else if (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && !locked(p)) todo.push(['urgent', `Take ${p.name} out of your lineup`, `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`, bestMove, [p]]);
}
for (const p of benchIn) todo.push(['urgent', `Start ${p.name}`, `He's expected to score ${n(weekValue(p))}${replaces.get(p) ? `, more than ${replaces.get(p).name} (${n(weekValue(replaces.get(p)))})` : ''}.`, bestMove, [p, replaces.get(p)].filter(Boolean)]);
const fillMove = f => ({ label: `Add ${f.add.name} on ESPN`, type: f.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: f.add.id }] });
for (const f of fills) todo.push([f.week >= 1 ? 'urgent' : 'week', f.byeFor.length ? `Add ${f.add.name} now for week ${week + 1} (${f.byeFor.map(p => p.name).join(' and ')} on bye)` : `Add ${f.add.name} (empty roster spot)`,
  `You have an open roster spot.${f.week >= 0.5 ? ` Adds about ${n(f.week)} points this week.` : ''}${byeText(f)} ${f.add.pos === 'D/ST' ? 'They\'re' : 'He\'s'} expected ${n(rate(f.add))} per game the rest of the season${f.season >= 0.5 ? `, which makes your lineup about ${n(f.season)} better per week` : f.rest >= 1 ? `. As a backup ${f.add.pos === 'D/ST' ? 'they add' : 'he adds'} about ${Math.round(f.rest)} points over the next two weeks covering byes` : ', a backup for injuries'}.${f.add.wa ? ' On waivers, so it\'s a claim.' : ''}${f.claim ? ` You also have a claim in for ${f.claim.add[0].name}. Keep trying for him, but make that claim drop ${f.add.name} (steps under Pending): win it and ${f.claim.add[0].name} replaces ${they(f.add) === 'they' ? 'them' : 'him'}, lose it and you still have ${f.add.name}.` : ''}`, fillMove(f), [f.add]]);
for (const [i, s] of plan.entries()) {
  todo.push([i === 0 && s.kind === 'week' && sitOut.length > benchIn.length ? 'urgent' : 'week', `Pickup step ${i + 1}: add ${s.add.name}, drop ${s.drop.name}`,
    `${gainText(s.now, s.later)}.` + alsoText(s.alts.map(a => a.add), s.kind === 'week' ? weekValue : rate), locked(s.add) || locked(s.drop) ? null : pickupMove(s), [s.add, s.drop]]);
}
// A better backup: free, and a backup 2+ a game better covers injuries and byes better. Only the best one, and only when the
// pickup plan doesn't already touch either player
const planIds = new Set(plan.flatMap(s => [s.add.id, s.drop.id]));
const bu = benchUps.find(x => !planIds.has(x.add.id) && !planIds.has(x.drop.id) && !locked(x.add) && !locked(x.drop));
if (bu) todo.push(['week', `Better backup: add ${bu.add.name}, drop ${bu.drop.name}`, `Neither starts for you now. ${bu.add.name}: ${n(rate(bu.add))} a game rest of season vs ${n(rate(bu.drop))} for ${bu.drop.name}, for when a starter is hurt or on bye.${bu.add.wa ? " On waivers, so it's a claim." : ' Free agent: yours right away.'}`, pickupMove(bu), [bu.add, bu.drop]]);
// pending moves that need you: a claim to fix or cancel before waivers run, a trade offer to answer, my own bad offer
for (const m of claims) {
  const { v, stack } = claimCheck(m), fix = v[0] === 'bad' || m.better;
  if (!fix) continue;
  const why = stack ? `You'd have 3 ${m.add[0].pos === 'K' ? 'kickers' : 'defenses'}. Cancel it and claim ${m.add[0].name} again dropping ${stack.name}, so you keep ${m.drop.map(d => d.name).join(' and ')}.`
    : m.better && v[0] !== 'bad' ? `${m.better.c.name} would add about ${n(m.better.season)} a week instead of ${n(m.season)}, dropping the same player.` : `${v[1]}. Details under Pending.`;
  todo.push(['urgent', `Fix your ${m.add.map(p => p.name).join(' + ')} claim`, `${why} It goes through when waivers run ${cap(waiverDay)}.`, { label: 'Cancel this claim on ESPN', type: 'WAIVER', cancel: true, related: m.id, items: [] }, [...m.add, ...m.drop]]);
}
for (const m of pending.filter(m => m.kind === 'trade')) {
  if (!m.mineOffer) todo.push(['urgent', `Answer ${m.them.name}'s trade offer`, `You'd give ${m.give.map(p => p.name).join(', ')} for ${m.take.map(p => p.name).join(', ')}. ${m.mine >= 1 ? `Good for you (+${n(m.mine)} a week): accept` : m.mine <= -1 ? `Bad for you (${n(m.mine)} a week): decline` : 'About even for you'}. Accept or decline under Pending.`, null, [...m.give, ...m.take]]);
  else if (m.mine <= -1) todo.push(['week', `Cancel your trade offer to ${m.them.name}`, `It costs you about ${n(-m.mine)} a week rest of season. Cancel it under Pending.`, null, [...m.give, ...m.take]]);
}
const irUsed = me.roster.filter(p => p.slot === 'IR').length;
const dateStr = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
for (const p of me.roster) {
  if (p.status === 'INJURY_RESERVE' && p.slot !== 'IR' && irUsed < (slotCounts[21] ?? 0)) todo.push(['week', `Move ${p.name} to your IR spot`, 'He\'s hurt long-term. IR frees a bench spot without dropping him.', locked(p) ? null : { label: 'Move him to IR on ESPN', type: 'ROSTER', items: [{ type: 'LINEUP', playerId: p.id, from: SLOT_ID[p.slot], to: SLOT_ID.IR }] }, [p]]);
  if (p.inj?.season && !plan.some(s => s.drop === p)) todo.push(['week', `Drop ${p.name}`, `Out for the season (${p.inj.type?.toLowerCase() ?? 'injury'}).`, locked(p) ? null : { label: 'Drop him on ESPN', type: 'ROSTER', items: [{ type: 'DROP', playerId: p.id }] }, [p]]);
  // healthy (or only questionable) and still in the IR spot: ESPN blocks every add, drop and trade until he's moved out
  if (p.slot === 'IR' && !['INJURY_RESERVE', 'OUT'].includes(p.status)) {
    const room = me.roster.filter(x => x.slot !== 'IR').length < rosterSpots, cut = [...baseRoster].filter(x => x.slot === 'Bench').sort((a, b) => weakness(a) - weakness(b))[0];
    todo.push(['urgent', `Move ${p.name} out of your IR spot`, `He's ${p.status ? (STATUS[p.status]?.[0] ?? p.status).toLowerCase() : 'healthy'}, so he can't stay in IR, and ESPN won't let you add, drop or trade anyone until he's out of it.${room ? '' : ` Your bench is full, so drop someone first${cut ? ` (easiest: ${cut.name}, ${n(rate(cut))} a game)` : ''}.`}`,
      room && !locked(p) ? { label: 'Move him to your bench on ESPN', type: 'ROSTER', items: [{ type: 'LINEUP', playerId: p.id, from: SLOT_ID.IR, to: SLOT_ID.Bench }] } : null, [p]]);
    continue;
  }
  if (p.slot === 'IR' && !p.inj?.season) {
    // worst = the first to go by the same order pickups drop in (a spare kicker or defense before a backup at another spot)
    const [w] = [p, ...baseRoster.filter(x => x.slot === 'Bench')].sort((a, b) => weakness(a, [...baseRoster, p]) - weakness(b, [...baseRoster, p]));
    // he'd be the first cut once he's back, so keeping him in IR gains nothing: drop him now and the IR spot is open for the
    // next injury. Shown any time, with or without a return date (ESPN clears the date once it passes)
    if (w === p) todo.push(['week', `Drop ${p.name}`, `${p.inj?.back ? `He may be back around ${dateStr(p.inj.back)}, but even` : 'Even'} healthy he'd be your worst player (${n(rate(p))} a game rest of season). Dropping him now frees the IR spot for your next injury.${locked(p) ? ` His game has started, so ESPN won't let you drop him until the week turns over (${turnNote}).` : ''}`, locked(p) ? null : { label: 'Drop him on ESPN', type: 'ROSTER', items: [{ type: 'DROP', playerId: p.id }] }, [p]]);
    else if (p.inj?.back && p.inj.back - Date.now() < 8 * 864e5) todo.push(['later', `${p.name} may be back around ${dateStr(p.inj.back)}`, `Coming off IR he needs a bench spot. Easiest drop: ${w.name} (${n(rate(w))} a game rest of season).`, null, [p]]);
  }
}
// Bye gaps, counting the players the plan adds (so a planned pickup that covers it hides the warning)
const afterPlan = [...baseRoster.filter(p => !plan.some(s => s.drop === p)), ...plan.map(s => s.add)];
for (let wk = week + 1; wk <= lastWeek; wk++) {
  for (const pos of ['QB', 'TE', 'K', 'D/ST']) {
    if (afterPlan.some(p => p.pos === pos && !HURT.includes(p.status) && p.slot !== 'IR' && p.bye !== wk)) continue;
    const sub = fa[pos].filter(p => p.bye !== wk && !HURT.includes(p.status)).sort((a, b) => rate(b) - rate(a))[0];
    todo.push(['later', `Week ${wk}: get a ${POS_NAME[pos].toLowerCase()}`, `None of yours play that week.${sub ? ` Best one available: ${sub.name} (${sub.teamName}, expected ${n(rate(sub))} per game).` : ''}`, null, sub ? [sub] : []]);
  }
}

// --- Phone alerts. Each alert has a key; keys already sent are remembered in state/alerts.json, which the
// workflow carries from run to run (Actions cache), so the every-minute runs don't repeat them. The published
// site's copy is only a fallback: GitHub's CDN can serve it up to 10 minutes stale, which once re-sent everything.
// Urgent alerts also go out during quiet hours (11pm-8am ET).
const etNow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
const etHour = Number(etNow.find(x => x.type === 'hour').value), etDay = etNow.find(x => x.type === 'weekday').value;
const notStarted = p => kickoff(p) > Date.now();
const soon = (p, hours) => notStarted(p) && kickoff(p) - Date.now() < hours * 3600e3;
const alerts = []; // [key, title, body, urgent]

// --- Advice check: every update, re-test the advice against plain rules a smart manager uses. A failure shows on
// Home and sends an alert, so a mistake shows up as a warning instead of a confident answer. Each rule comes from a
// mistake the site really made (the Lions for a one-week fill-in, "Do now" for a 0.25-point swap, and so on).
// ponytail: catches the kinds of mistakes named here; the "Also considered" lists are for spotting new kinds.
function adviceCheck(c) {
  const out = [], { week, weekValue, nextValue, seasonValue, rate, locked } = c, f1 = x => x.toFixed(1);
  const cant = p => ['OUT', 'DOUBTFUL', 'INJURY_RESERVE', 'SUSPENSION'].includes(p.status) || p.slot === 'IR';
  const valFor = f => (f.byeFor.length ? nextValue : rate);
  // 1. a lineup change marked "Do now" wins by a point
  for (const p of c.benchIn) {
    const o = c.replaces.get(p);
    if (o && weekValue(p) - weekValue(o) < 1) out.push(['Lineup', `"Start ${p.name}" beats ${o.name} by under a point (${f1(weekValue(p))} vs ${f1(weekValue(o))}), a coin flip.`]);
  }
  // 2. the lineup never keeps someone on bye or unlikely to play when a bench player who fits that spot would score more
  for (const x of c.lineup) {
    const p = x.player;
    if (locked(p) || !(p.bye === week || cant(p))) continue;
    const alt = c.roster.find(b => !c.lineup.some(y => y.player === b) && (c.slotPos[x.slot] ?? []).includes(b.pos) && weekValue(b) > weekValue(p));
    if (alt) out.push(['Lineup', `${p.name} stays in your lineup (${p.bye === week ? 'on bye' : p.status.toLowerCase()}) though ${alt.name} could play that spot.`]);
  }
  // 3. nobody is suggested for a week he can't play
  for (const f of c.fills) if ((f.byeFor.length && f.add.bye === week + 1) || cant(f.add)) out.push(['Pickups', `${f.add.name} is suggested but can't play when he's needed.`]);
  for (const s of c.plan) if ((s.kind === 'week' && s.add.bye === week) || cant(s.add)) out.push(['Pickups', `${s.add.name} is suggested but can't play when he's needed.`]);
  for (const f of c.fills) {
    const v = valFor(f);
    const top = c.allFa.filter(o => o.pos === f.add.pos && o.id !== f.add.id && !c.taken.has(o.id) && !cant(o) && !locked(o) && !c.lost(o)).sort((a, b) => v(b) - v(a))[0];
    if (!top) continue;
    // 4. a fill-in is the best you can actually get for the week it's for (within a point)
    if (v(top) > v(f.add) + 1) out.push(['Pickups', `${f.add.name} (${f1(v(f.add))}) is suggested, but ${top.name} (${f1(v(top))}) is available and better ${f.byeFor.length ? `for week ${week + 1}` : 'for the rest of the season'}.`]);
    // 5. a coin flip is called one
    else if (Math.abs(v(top) - v(f.add)) < 0.5 && !f.close) out.push(['Pickups', `${f.add.name} vs ${top.name} is a coin flip (${f1(v(f.add))} vs ${f1(v(top))}) but isn't marked as one.`]);
  }
  // 6. every pickup step is worth a point
  for (const s of c.plan) if (s.gain < 1) out.push(['Pickups', `"Add ${s.add.name}, drop ${s.drop.name}" is worth under a point.`]);
  // 7. a free agent 2+ a game better than one of your backups gets mentioned
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const mine = c.base.filter(p => p.pos === pos && p.slot !== 'IR' && !c.seasonStarters.has(p.id)).sort((a, b) => rate(a) - rate(b))[0];
    const fa = c.allFa.filter(o => o.pos === pos && !cant(o) && !locked(o) && !c.taken.has(o.id)).sort((a, b) => rate(b) - rate(a))[0];
    if (mine && fa && rate(fa) - rate(mine) >= 2 && ![...c.benchUps, ...c.plan, ...c.fills].some(x => x.add.id === fa.id)) out.push(['Pickups', `${fa.name} (${f1(rate(fa))}) beats your backup ${mine.name} (${f1(rate(mine))}) but isn't mentioned.`]);
  }
  // 8. a short absence doesn't make a player worthless for the season
  for (const p of c.roster) if (p.slot !== 'IR' && p.status && p.status !== 'INJURY_RESERVE' && !p.inj?.season && rate(p) > 0 && seasonValue(p) === 0) out.push(['Season', `${p.name} counts as worth 0 for the season, but he's only ${p.status.toLowerCase()}.`]);
  // 9. a claim a team ahead of you will likely win is flagged
  for (const m of c.claims) if (m.add.length === 1 && c.lost(c.allFa.find(o => o.id === m.add[0].id) ?? m.add[0]) && !m.likelyLost) out.push(['Pending', `Your ${m.add[0].name} claim will likely lose to a team ahead of you, but it isn't flagged.`]);
  return out;
}
const ADVICE_RULES = 9;
const adviceIssues = adviceCheck({
  week, weekValue, nextValue, seasonValue, rate, locked, benchIn, replaces, lineup: best.lineup, roster: me.roster, base: baseRoster,
  seasonStarters: seasonStarterIds, fills, plan, benchUps, claims, allFa, lost: o => lostOnWaivers(o, new Set()),
  taken: new Set([...claims.flatMap(m => m.add.map(a => a.id)), ...fills.map(f => f.add.id)]),
  slotPos: Object.fromEntries(Object.entries(SLOT).filter(([id]) => SLOT_POS[id]).map(([id, name]) => [name, SLOT_POS[id]])),
});
for (const [where, text] of adviceIssues) alerts.push([`check:${week}:${text}`, `Advice check: ${where}`, `${text} Treat that advice with care.`, false]);
const ordinal = k => k + { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(k)];
// One team's week from a box score: what it started, the best lineup it could have set (hindsight), and each [should have started, instead of]
// rosterForMatchupPeriod holds only the starters; the bench is in rosterForCurrentScoringPeriod
function boxLineup(side, wk) {
  const ps = (side.rosterForCurrentScoringPeriod ?? side.rosterForMatchupPeriod).entries.map(e => { const pl = e.playerPoolEntry.player; return { id: e.playerId, name: pl.fullName, pos: POS[pl.defaultPositionId], pts: pl.stats?.find(s => s.scoringPeriodId === wk && s.statSourceId === 0)?.appliedTotal ?? e.playerPoolEntry.appliedStatTotal ?? 0, slot: SLOT[e.lineupSlotId] }; });
  const started = ps.filter(p => p.slot !== 'Bench' && p.slot !== 'IR'), got = started.reduce((t, p) => t + p.pts, 0);
  // +100 so players who scored 0 or less still fill a spot (bestLineup skips values <= 0); the total uses real points
  const bestL = bestLineup(ps.filter(p => p.slot !== 'IR'), p => p.pts + 100), best = bestL.lineup.reduce((t, x) => t + x.player.pts, 0);
  const shouldIn = bestL.lineup.map(x => x.player).filter(p => !started.includes(p)).sort((a, b) => b.pts - a.pts);
  const shouldOut = started.filter(p => !bestL.lineup.some(x => x.player === p)).sort((a, b) => a.pts - b.pts);
  const misses = shouldIn.map(p => {
    const flex = ['RB', 'WR', 'TE'], k = shouldOut.findIndex(o => o.pos === p.pos), j = k >= 0 ? k : shouldOut.findIndex(o => flex.includes(o.pos) && flex.includes(p.pos));
    return j >= 0 ? [p, shouldOut.splice(j, 1)[0]] : null;
  }).filter(Boolean);
  return { ps, started, got, best, misses };
}
// Trades from who owned whom each week: a player on one team one week and another the next, who wasn't added off waivers or free agency, was
// traded. Moves between the same two teams in the same week are one deal. Newest first.
function rosterTrades(owners, adds) {
  const deals = new Map();
  for (const [id, byWk] of Object.entries(owners)) for (const [w, from] of Object.entries(byWk)) {
    const next = +w + 1, to = byWk[next];
    if (to == null || to === from || adds.has(id + ':' + to + ':' + w) || adds.has(id + ':' + to + ':' + next)) continue;
    const k = next + ':' + Math.min(from, to) + ':' + Math.max(from, to);
    if (!deals.has(k)) deals.set(k, { scoringPeriodId: next, items: [] });
    deals.get(k).items.push({ type: 'TRADE', playerId: +id, fromTeamId: from, toTeamId: to });
  }
  return [...deals.values()].sort((a, b) => b.scoringPeriodId - a.scoringPeriodId);
}
// A player traded and dropped right away never shows up on his new team, so take him from the offer the deal came from, if everything else
// in that offer checks out: each other player in it had left the team giving him by then. Also gives the deal its date.
function fillFromOffers(deals, offers, owners) {
  for (const d of deals) {
    const next = d.scoringPeriodId, f = d.items[0], pair = [f.fromTeamId, f.toTeamId].sort().join();
    for (const o of offers) {
      const items = (o.items ?? []).filter(i => i.type === 'TRADE');
      if (Math.abs(o.scoringPeriodId - next) > 1 || !items.length || !items.every(i => [i.fromTeamId, i.toTeamId].sort().join() === pair)) continue;
      const known = new Set(d.items.map(i => i.playerId)), extra = items.filter(i => !known.has(i.playerId));
      if (extra.length === items.length || !extra.every(i => owners[i.playerId]?.[next - 1] === i.fromTeamId && owners[i.playerId]?.[next] !== i.fromTeamId)) continue;
      for (const i of extra) d.items.push({ type: 'TRADE', playerId: i.playerId, fromTeamId: i.fromTeamId, toTeamId: i.toTeamId });
      d.date = o.proposedDate;
    }
  }
  return deals;
}
// One team's side of each team in a finished trade: who it got and who it gave up. Won on rest-of-season points a game; under 1 apart is even.
function tradeSides(tx) {
  const items = tx.items.filter(i => i.type === 'TRADE'), ids = [...new Set(items.map(i => i.toTeamId))];
  return ids.map(team => ({ team, others: ids.filter(x => x !== team), got: items.filter(i => i.toTeamId === team).map(i => i.playerId), gave: items.filter(i => i.fromTeamId === team).map(i => i.playerId) }));
}
const tradeResult = (got, gave) => Math.abs(got - gave) < 1 ? 'even' : got > gave ? 'won' : 'lost';
// Every pick against the draft: he was the Nth at his position taken, and is the Mth of those in points now. diff above 0 beat his spot.
// passed: the best player at his position taken within a round after a pick that missed.
function draftReview(picks, info, teamCount) {
  const rows = picks.filter(x => info.has(x.playerId)).sort((a, b) => a.overallPickNumber - b.overallPickNumber).map(x => ({ team: x.teamId, over: x.overallPickNumber, spot: x.roundId + '.' + String(x.roundPickNumber).padStart(2, '0'), ...info.get(x.playerId) }));
  for (const pos of new Set(rows.map(r => r.pos))) {
    const at = rows.filter(r => r.pos === pos);
    at.forEach((r, i) => { r.as = i + 1; });
    [...at].sort((a, b) => b.pts - a.pts).forEach((r, i) => { r.now = i + 1; r.diff = r.as - (i + 1); });
  }
  for (const r of rows) r.passed = r.diff < 0 ? rows.filter(o => o.pos === r.pos && o.over > r.over && o.over <= r.over + teamCount && o.now < r.now).sort((a, b) => a.now - b.now)[0]?.name ?? null : null;
  return rows;
}
// --- Report card: every manager's finished weeks. Left off the page if ESPN fails; nothing else needs it.
const report = new Map();
if (week > 1) try {
  const wkPts = {}, wkOwner = {};
  const [draft, ...boxes] = await Promise.all([get(`${LEAGUE}?view=mDraftDetail`), ...Array.from({ length: week - 1 }, (_, i) => get(`${LEAGUE}?view=mBoxscore&view=mMatchupScore&scoringPeriodId=${i + 1}`))]);
  const drafted = new Set((draft.draftDetail?.picks ?? []).map(x => x.teamId + ':' + x.playerId));
  for (const t of teams) report.set(t.id, { t, pf: 0, max: 0, add: 0, wins: 0, allPlay: 0, apW: 0, apL: 0, weeks: 0, miss: [], scores: [] });
  boxes.forEach((bx, i) => {
    const games = bx.schedule.filter(g => g.matchupPeriodId === i + 1 && g.home?.rosterForCurrentScoringPeriod && g.away?.rosterForCurrentScoringPeriod), sides = games.flatMap(g => [g.home, g.away].map(s => [s, s === g.home ? g.away : g.home, boxLineup(s, i + 1)]));
    for (const [s, opp, l] of sides) {
      const r = report.get(s.teamId);
      if (!r) continue;
      for (const p of l.ps) { (wkPts[p.id] ??= {})[i + 1] = p.pts; (wkOwner[p.id] ??= {})[i + 1] = s.teamId; }
      r.pf += l.got; r.max += l.best; r.weeks++;
      r.add += l.started.filter(p => !drafted.has(s.teamId + ':' + p.id)).reduce((x, p) => x + p.pts, 0);
      r.wins += s.totalPoints > opp.totalPoints ? 1 : 0;
      const beat = sides.filter(([o]) => o !== s && o.totalPoints < s.totalPoints).length;
      r.allPlay += beat / (sides.length - 1); r.apW += beat; r.apL += sides.length - 1 - beat;
      r.scores.push([i + 1, s.totalPoints]);
      r.miss.push(...l.misses.map(([p, o]) => [i + 1, p.name, p.pts, o.name, o.pts]));
    }
  });
  const list = [...report.values()].filter(r => r.weeks);
  let txs = [];
  try {
  // every finished trade this season, from the rosters: ESPN's transaction list leaves out accepted proposals, and its acceptances carry no players
  txs = (await Promise.all(Array.from({ length: week }, (_, i) => get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${i + 1}`)))).flatMap(d => d.transactions ?? []);
  for (const x of teams) for (const p of x.roster) (wkOwner[p.id] ??= {})[week] = x.id;
  for (const x of draft.draftDetail?.picks ?? []) (wkOwner[x.playerId] ??= {})[0] = x.teamId; // week 0: draft day, for trades before week 1
  const adds = new Set(txs.filter(tx => tx.status === 'EXECUTED' && ['WAIVER', 'FREEAGENT'].includes(tx.type)).flatMap(tx => (tx.items ?? []).filter(i => i.type === 'ADD').map(i => i.playerId + ':' + i.toTeamId + ':' + tx.scoringPeriodId)));
  const deals = fillFromOffers(rosterTrades(wkOwner, adds), txs.filter(tx => tx.type === 'TRADE_PROPOSAL' && tx.status !== 'CANCELED'), wkOwner);
  for (const d of deals) if (d.date && d.scoringPeriodId >= week - 2) for (const i of d.items) moves.push({ date: d.date, type: 'TRADE', playerId: i.playerId, team: i.toTeamId, from: i.fromTeamId });
  moves.sort((a, b) => b.date - a.date);
  const unknown = [...new Set(deals.flatMap(tx => tx.items.filter(i => i.type === 'TRADE').map(i => i.playerId)))].filter(id => !byId.has(id));
  if (unknown.length) for (const x of (await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: unknown } } })).players) { names[x.player.id] = x.player.fullName; byId.set(x.player.id, { ...row(x.player, x.ratings), slot: 'FA' }); }
  // [name, rest-of-season points a game, points since the trade]
  const dealt = (id, wk) => { const p = byId.get(id); return [p?.name ?? names[id] ?? 'Unknown', +(p ? rate(p) : 0).toFixed(1), +Object.entries(wkPts[id] ?? {}).filter(([w]) => +w > wk).reduce((s, [, v]) => s + v, 0).toFixed(1)]; };
  for (const r of list) r.trades = [];
  for (const tx of deals) for (const s of tradeSides(tx)) {
    const got = s.got.map(id => dealt(id, tx.scoringPeriodId - 1)), gave = s.gave.map(id => dealt(id, tx.scoringPeriodId - 1)), sum = l => l.reduce((x, p) => x + p[1], 0);
    report.get(s.team)?.trades?.push({ wk: tx.scoringPeriodId, vs: s.others.map(id => teamName[id] ?? '').join(', '), got, gave, res: tradeResult(sum(got), sum(gave)) });
  }
  } catch (err) { console.warn('Trades skipped:', err.message); }
  const place = (key, dir) => [...list].sort((a, b) => dir * (a[key] - b[key])).forEach((r, i) => { r[key + 'Rank'] = i + 1; });
  for (const r of list) { r.eff = r.max ? r.pf / r.max * 100 : 0; r.bench = (r.max - r.pf) / r.weeks; r.luck = r.wins - r.allPlay; r.miss = r.miss.sort((a, b) => (b[2] - b[4]) - (a[2] - a[4])).slice(0, 3); }
  place('eff', -1); place('bench', -1); place('add', -1); place('pf', -1);
  // each manager's pickups and drops by name
  try {
    const wireTx = [...new Map(txs.map(tx => [tx.id, tx])).values()].filter(tx => tx.status === 'EXECUTED' && !tx.type?.startsWith('TRADE') && tx.items?.some(i => ['ADD', 'DROP'].includes(i.type))).sort((a, b) => (b.processDate ?? b.proposedDate) - (a.processDate ?? a.proposedDate));
    const unknown = [...new Set(wireTx.flatMap(tx => tx.items.map(i => i.playerId)))].filter(id => !byId.has(id));
    if (unknown.length) for (const x of (await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: unknown } } })).players) { names[x.player.id] = x.player.fullName; byId.set(x.player.id, { ...row(x.player, x.ratings), slot: 'FA' }); }
    const nameOf = id => byId.get(id)?.name ?? names[id] ?? 'Unknown';
    const holder = id => teams.find(x => x.roster.some(p => p.id === id));
    const scored = (id, test) => +Object.entries(wkPts[id] ?? {}).filter(([w]) => test(+w, wkOwner[id]?.[w])).reduce((s, [, v]) => s + v, 0).toFixed(1);
    for (const r of list) r.wire = { moves: [], adds: 0, drops: 0, kept: 0, best: [], regret: [] };
    for (const tx of wireTx) {
      const r = report.get(tx.teamId);
      if (!r?.wire) continue;
      const wk = tx.scoringPeriodId, id = r.t.id;
      // [name, points for this team, still here]
      const add = tx.items.filter(i => i.type === 'ADD').map(i => [nameOf(i.playerId), scored(i.playerId, (w, o) => w >= wk && o === id), holder(i.playerId) === r.t ? 1 : 0]);
      // [name, points since on other teams, team he's on now]
      const drop = tx.items.filter(i => i.type === 'DROP').map(i => { const h = holder(i.playerId); return [nameOf(i.playerId), scored(i.playerId, (w, o) => w >= wk && o != null && o !== id), h && h !== r.t ? h.name : '']; });
      r.wire.moves.push([wk, add, drop]);
      r.wire.adds += add.length; r.wire.drops += drop.length; r.wire.kept += add.filter(x => x[2]).length;
      r.wire.best.push(...add); r.wire.regret.push(...drop);
    }
    for (const r of list) { r.wire.best = r.wire.best.sort((a, b) => b[1] - a[1]).slice(0, 3).filter(x => x[1] > 0); r.wire.regret = r.wire.regret.sort((a, b) => b[1] - a[1]).slice(0, 3).filter(x => x[1] > 0); }
  } catch (err) { console.warn('Waiver history skipped:', err.message); }
  // the draft, pick by pick
  try {
    const picks = draft.draftDetail?.picks ?? [], info = new Map();
    for (const x of (await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: picks.map(p => p.playerId) } } })).players) {
      const p = row(x.player, x.ratings), adp = x.player.ownership?.averageDraftPosition;
      info.set(x.player.id, { name: p.name, pos: p.pos, pts: p.pts ?? 0, adp: adp > 0 && adp < 500 ? adp : null });
    }
    const rows = draftReview(picks, info, teams.length), sum = (l, f) => l.reduce((s, x) => s + f(x), 0);
    const line = x => [x.spot, x.name, x.pos, +x.pts.toFixed(1), x.as, x.now, x.diff, x.passed];
    for (const r of list) {
      const mine = rows.filter(x => x.team === r.t.id), adps = mine.filter(x => x.adp != null);
      if (!mine.length) continue;
      const byDiff = [...mine].sort((a, b) => b.diff - a.diff);
      r.draftScore = sum(mine, x => x.diff);
      r.draft = { hit: mine.filter(x => x.diff >= 0).length, n: mine.length, adp: adps.length ? +(sum(adps, x => x.over - x.adp) / adps.length).toFixed(1) : null,
        pos: [...new Set(mine.map(x => x.pos))].map(pos => [pos, sum(mine.filter(x => x.pos === pos), x => x.diff)]).sort((a, b) => b[1] - a[1]),
        best: byDiff.filter(x => x.diff > 0).slice(0, 3).map(line), worst: byDiff.filter(x => x.diff < 0).slice(-3).reverse().map(line), picks: mine.map(line) };
    }
    const drafted2 = list.filter(r => r.draft);
    [...drafted2].sort((a, b) => b.draftScore - a.draftScore).forEach((r, i) => { r.draft.rank = i + 1; });
  } catch (err) { console.warn('Draft review skipped:', err.message); }
  for (const r of list) {
    const half = list.length / 2, short = depth(r.t).short;
    r.better = [r.benchRank <= half ? `Left ${n(r.bench)} a week on the bench, ${ordinal(r.benchRank)} most.` : '', r.addRank > half ? `${n(r.add)} points started from pickups and trades, ${ordinal(r.addRank)} in the league.` : '', short.length ? `Thin at ${short.join(', ')}.` : '', r.draft?.pos.at(-1)?.[1] < 0 ? `Weakest draft position: ${r.draft.pos.at(-1)[0]}.` : '', r.wire?.regret[0]?.[1] >= 30 ? `Dropped ${r.wire.regret[0][0]}, ${n(r.wire.regret[0][1])} points since on other teams.` : ''].filter(Boolean);
  }
} catch (err) { console.warn('Report card skipped:', err.message); report.clear(); }
// --- Last week's recap from ESPN's box score: what my lineup scored vs the best lineup I could have set (hindsight),
// and, once there's a saved one, what the site's suggested lineup would have scored
let recap = null;
if (week > 1) try {
  const bx = await get(`${LEAGUE}?view=mBoxscore&view=mMatchupScore&scoringPeriodId=${week - 1}`);
  const g = bx.schedule.find(x => x.matchupPeriodId === week - 1 && (x.home?.teamId === me.id || x.away?.teamId === me.id));
  const [mine, theirs] = g.home.teamId === me.id ? [g.home, g.away] : [g.away, g.home];
  const { ps, started, got, best: bestTotal, misses } = boxLineup(mine, week - 1);
  const advised = memo.advice?.[week - 1];
  recap = { wk: week - 1, got, opp: theirs?.totalPoints ?? null, oppName: teamName[theirs?.teamId] ?? '', best: bestTotal, misses: misses.slice(0, 2),
    site: advised ? ps.filter(p => advised.includes(p.id)).reduce((t, p) => t + p.pts, 0) : null };
  // for "why you won or lost" (worked out further down, once whyWeek's data is ready): each starter's ESPN player entry
  recap.started = started.map(p => ({ ...p, pl: (mine.rosterForCurrentScoringPeriod ?? mine.rosterForMatchupPeriod).entries.find(e => e.playerId === p.id).playerPoolEntry.player }));
} catch (err) { console.warn('Recap skipped:', err.message); }
memo.advice = { ...Object.fromEntries(Object.entries(memo.advice ?? {}).filter(([wk]) => +wk >= week - 2)), [week]: [...bestIds] };
// the site's expected points for my players this week, so next week's recap can say who beat or missed it
memo.exp = { ...Object.fromEntries(Object.entries(memo.exp ?? {}).filter(([wk]) => +wk >= week - 1)), [week]: Object.fromEntries(me.roster.filter(p => p.proj != null).map(p => [p.id, +p.proj.toFixed(1)])) };
if (process.env.PUSH_SUB) alerts.push([`hello:${JSON.parse(process.env.PUSH_SUB).endpoint.slice(-16)}`, 'Alerts are on', 'You\'ll get a notification when something on your team needs you.', true]);
// Auto swap: a starter ruled out in the last 2 hours before his kickoff (teams name inactives 90 minutes before) goes to
// the bench for the best bench player who can play his spot, done on ESPN right here, since the alert may come when no
// one is looking. A doubtful one too, once it's under an hour: inactives are out by then, so a doubtful tag still up
// means he's dressed (ESPN often leaves it up), and he's judged at his full projection, not his odds of playing.
// The inactive list itself, read from the game ESPN posts it in (about 90 minutes before kickoff), for each starter whose
// game starts within 2 hours: his fantasy status can lag it
const inactive = new Set();
for (const gid of new Set(starters(me).filter(p => soon(p, 2)).map(p => pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0]?.id).filter(Boolean))) try {
  const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gid}`)).json();
  for (const t of d.injuries ?? []) for (const x of t.injuries ?? []) if (x.details?.fantasyStatus?.abbreviation === 'INACTIVE') inactive.add(+x.athlete?.id);
} catch (err) { console.warn('Inactive list skipped:', err.message); }
// Who replaces starter p: the best bench player who can play his spot, or, if it adds more, a starter who can play his
// spot slides over (a flex WR into the WR spot) and the bench player takes that starter's spot instead (a RB or TE into
// the flex). Only players whose games haven't started can move. Returns [the starter who slides or null, spot the bench
// player goes to, bench player], or [] when nobody can come in. A tie goes to the plain swap.
function swapPick(p, roster, used, moved) {
  const slot = SLOT_ID[p.slot], fresh = x => notStarted(x) && !HURT.includes(x.status) && x.status !== 'DOUBTFUL' && !inactive.has(x.id);
  const bench = roster.filter(b => b.slot === 'Bench' && fresh(b) && b.bye !== week && !used.has(b.id) && weekValue(b) > 0);
  const slides = roster.filter(s => s !== p && s.slot !== 'Bench' && s.slot !== 'IR' && fresh(s) && !moved.has(s.id) && SLOT_POS[slot]?.includes(s.pos));
  return [[null, slot], ...slides.map(s => [s, SLOT_ID[s.slot]])]
    .flatMap(([s, to]) => bench.filter(b => SLOT_POS[to]?.includes(b.pos)).map(b => [s, to, b]))
    .sort((a, b) => weekValue(b[2]) - weekValue(a[2]) || !!a[0] - !!b[0])[0] ?? [];
}
const swapped = new Map(), moved = new Set(); // starter id -> [who went in for him, the starter who slid over or null]; starters already slid
const swapText = id => { const [sub, mid] = swapped.get(id); return `started ${sub.name}${mid ? ` (moving ${mid.name} into his spot)` : ''} on ESPN.`; };
for (const p of starters(me)) {
  const gone = HURT.includes(p.status) || inactive.has(p.id), doubt = !gone && p.status === 'DOUBTFUL' && soon(p, 1);
  if (!(gone && soon(p, 2)) && !doubt) continue;
  const slot = SLOT_ID[p.slot], [mid, to, sub] = swapPick(p, me.roster, new Set([...swapped.values()].map(v => v[0].id)), moved);
  if (!sub || (doubt && weekValue(sub) <= (p.proj ?? 0))) continue;
  const r = await fetch(`https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}/transactions/`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ isLeagueManager: false, teamId: me.id, type: 'ROSTER', scoringPeriodId: league.scoringPeriodId, executionType: 'EXECUTE',
      items: [{ playerId: p.id, type: 'LINEUP', fromLineupSlotId: slot, toLineupSlotId: SLOT_ID.Bench },
        ...(mid ? [{ playerId: mid.id, type: 'LINEUP', fromLineupSlotId: to, toLineupSlotId: slot }] : []),
        { playerId: sub.id, type: 'LINEUP', fromLineupSlotId: SLOT_ID.Bench, toLineupSlotId: to }] }),
  }).catch(err => ({ ok: false, json: async () => ({ messages: [err.message] }) }));
  if (r.ok) { swapped.set(p.id, [sub, mid]); if (mid) moved.add(mid.id); console.log(`Auto swap: benched ${p.name} (${inactive.has(p.id) ? 'inactive' : p.status}), started ${sub.name}${mid ? `, moved ${mid.name} into his spot` : ''}`); continue; }
  const why = await r.json().catch(() => ({}));
  console.warn(`Auto swap of ${p.name} failed:`, why.details?.[0]?.type ?? why.messages?.[0] ?? r.status);
  alerts.push([`autofail:${week}:${p.id}`, `Bench ${p.name} now`, `He's out, and the app couldn't swap him for ${sub.name} on ESPN. Do it in the ESPN app before his game starts.`, true]);
}
// A questionable player's status gets decided about 90 minutes before kickoff
const decided = new Set();
for (const p of me.roster) {
  if (!memo.q[p.id] || p.status === (memo.q[p.id] === 1 ? 'QUESTIONABLE' : memo.q[p.id]) || p.slot === 'IR' || !notStarted(p)) continue;
  decided.add(p.id);
  const starting = p.slot !== 'Bench';
  alerts.push(!p.status
    ? [`q:${week}:${p.id}:${p.status}`, `${p.name} is playing`, bestIds.has(p.id) ? (starting ? 'He\'s in your lineup. Keep him there.' : 'Start him: he\'s in your best lineup.') : (starting ? 'He\'s playing, but someone on your bench is expected to score more.' : 'Keep him on your bench.'), true]
    : [`q:${week}:${p.id}:${p.status}`, `${p.name} ${p.status === 'DOUBTFUL' ? 'probably won\'t play' : p.status === 'OUT' ? 'is out' : 'won\'t play'}`, swapped.has(p.id) ? `The app benched him and ${swapText(p.id)}` : starting ? `He's in your lineup, so swap him out in the ESPN app${soon(p, 2) ? ' now' : ', or the app will 2 hours before his game'}.` : 'He\'s on your bench, so there\'s nothing to do.', true]);
}
memo.q = Object.fromEntries(me.roster.filter(p => ['QUESTIONABLE', 'DOUBTFUL'].includes(p.status) && notStarted(p)).map(p => [p.id, p.status]));
// Starter who won't play (bye, out, doubtful, IR, suspended)
for (const p of starters(me)) {
  const bye = p.bye === week;
  if (swapped.has(p.id) && !decided.has(p.id)) { alerts.push([`auto:${week}:${p.id}`, `${p.name} is out`, `The app benched him and ${swapText(p.id)}`, true]); continue; }
  if (decided.has(p.id) || !(bye || (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && notStarted(p)))) continue;
  alerts.push([`out:${week}:${p.id}`, `Bench ${p.name}`, `${bye ? 'His team is on bye.' : `${STATUS[p.status][0]}.`} Your to-do list has who to start instead.`, !bye && soon(p, 3)]);
}
// Better lineup, within 2.5 hours of kickoff, when both players can still be moved
for (const p of benchIn) {
  const out = replaces.get(p);
  if ((out && !playable(out)) || decided.has(p.id)) continue; // the alerts above already cover it
  if (!notStarted(p) || (out && !notStarted(out)) || !(soon(p, 2.5) || (out && soon(out, 2.5)))) continue;
  if (weekValue(p) - (out ? weekValue(out) : 0) < 2) continue;
  alerts.push([`start:${week}:${p.id}:${out?.id}`, `Start ${p.name}`, out ? `He's expected to score ${n(weekValue(p))}, more than ${out.name} (${n(weekValue(out))}). Games start soon.` : `You have an empty lineup spot. He's expected to score ${n(weekValue(p))}.`, true]);
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
// Waiver reminder the evening before the week's first processing day after Monday's games (from the league's
// settings: this league processes every day except Tuesday, so that's Wednesday)
const wplan = plan.find(x => x.add.wa);
if (etDay === waiverEve && etHour >= 18 && wplan) {
  const s = wplan;
  alerts.push([`wrem:${week}`, `Waivers run ${cap(waiverDay)}`, `Claim ${s.add.name} and drop ${s.drop.name}: ${gainText(s.now, s.later)}. More ideas in the app.`, false]);
}
// Someone available beats a player you have, or fills an empty spot: tell me once per player per week, as soon as it shows up
for (const s of plan) alerts.push([`pickup:${week}:${s.add.id}`, `${s.add.name} is better than ${s.drop.name}`,
  `${gainText(s.now, s.later)}. ${s.add.wa ? 'On waivers, so put in a claim' : 'Free agent, so you can add him now'}.`, s.kind === 'week']);
for (const x of benchUps) alerts.push([`bench:${week}:${x.add.id}`, `Better backup: ${x.add.name}`,
  `${n(rate(x.add))} a game vs ${x.drop.name}'s ${n(rate(x.drop))}, rest of season. ${x.add.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'} Small upgrade; details in Pickups.`, false]);
// only worth a buzz when there's something to do about it: a free agent to add now in case the claim is lost
for (const m of claims) if (m.likelyLost && m.backupFill) alerts.push([`claimrisk:${week}:${m.id}`, `You'll likely lose your ${m.add[0].name} claim`,
  `${m.likelyLost.map(t => t.name).join(', ')} pick${m.likelyLost.length > 1 ? '' : 's'} before you and also need${m.likelyLost.length > 1 ? '' : 's'} a ${POS_NAME[m.add[0].pos].toLowerCase()} in week ${week + 1}. Open the app for a free agent you can add now.`, false]);
for (const f of fills) alerts.push([`fill:${week}:${f.add.id}`, `Add ${f.add.name} (empty roster spot)`,
  `${f.byeFor.length && nextProj.has(f.add.id) ? `Fills in for ${f.byeFor.map(p => p.name).join(' and ')} (bye in week ${week + 1}), expected ${n(nextProj.get(f.add.id))}. ` : ''}${f.add.wa ? 'On waivers, so put in a claim.' : 'Free agent, so you can add now.'}`, false]);
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
  if (p.bye === week && !p.inj?.season) out.push('<span class="chip bye">Bye week: no game</span>');
  const s = STATUS[p.status];
  if (p.inj?.season) out.push(`<span class="chip bad">Out for the season${p.inj.type ? ` (${esc(p.inj.type.toLowerCase())})` : ''}</span>`);
  else if (s) {
    const wks = p.inj?.back ? Math.ceil((p.inj.back - Date.now()) / (7 * 864e5)) : 0;
    const when = p.inj?.back && wks > 0 ? ` &middot; back ~${dateStr(p.inj.back)}${wks > 1 ? ` (${wks} wks)` : ''}` : '';
    out.push(`<span class="chip ${s[1]}">${s[0]}${p.inj?.type && p.inj.type !== 'Undisclosed' ? ` (${esc(p.inj.type.toLowerCase())})` : ''}${p.status === 'QUESTIONABLE' ? '' : when}${playOdds(p, p.inj?.type) ? ` &middot; ${playOdds(p, p.inj?.type).pct}% plays${playOdds(p, p.inj?.type).tags ? ` (played ${playOdds(p, p.inj?.type).played} of ${playOdds(p, p.inj?.type).tags} times listed)` : ''}` : ''}</span>`);
  }
  if (p.split && !out.length) out.push(`<span class="chip warn">Experts disagree: ${srcText(p)}</span>`);
  return out.join(' ');
}

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
// Why a week went the way it did, each with its cause: he missed the game, fewer snaps, a blowout, his QB struggled
// or got pulled, fewer targets/carries (team ran few plays, or the ball went to a teammate), few catches, no touchdown,
// the defense he faced, a key teammate missing. Empty for a normal week. Only QB/RB/WR/TE (Sleeper's stats).
// "Usually" = his median in his other games this season.
// ponytail: nobody keeps past injury reports, so a big snap drop is the clue he got hurt in the game.
// ponytail: a player traded mid-season is looked up under his current team only.
const POS_ONE = { QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end' };
// Kickers and defenses: same idea, from their own stat lines (field goals, extra points; points allowed, turnovers, sacks).
function whyKD(p, wk, pts, expected) {
  const kd = wk === week ? kdNow : rosSaved.kd?.[wk], team = TEAM(p.team), k = pkey(p.name, p.pos, p.team), w = kd?.[k];
  if (!kd || !Object.keys(kd).some(x => x.endsWith('|' + team))) return []; // no data, or his team had no game
  if (!w) return [];
  const exp = expected ?? p.avg, good = pts != null && exp > 0 && pts >= exp * 1.4 && pts - exp >= 4, bad = pts != null && exp > 0 && pts <= exp * 0.6 && exp - pts >= 3;
  const head = expected != null && (good || bad) ? 1 : 0, out = head ? [`Expected about ${n(expected)}, scored ${n(pts)}.`] : [];
  const other = Object.entries(rosSaved.kd ?? {}).filter(([w2]) => +w2 !== wk).map(([, x]) => x[k]).filter(Boolean);
  const avg = i => (other.length ? Math.round(other.reduce((t, x) => t + x[i], 0) / other.length * 10) / 10 : null);
  const sc = wk === week ? gameNow[team]?.score : rosSaved.scores?.[wk]?.[team];
  if (w[0] === 'K') {
    const [, , , fga, fgm, long, xpa, xpm] = w, usual = avg(3), miss = fga - fgm, xpMiss = xpa - xpm, wind = wk === week ? rosSaved.weather?.[team]?.wind : null;
    if (!good && usual >= 1.5 && fga <= usual - 1.5) out.push(`${fga ? `Only ${fga} field goal ${fga === 1 ? 'try' : 'tries'}` : 'No field goal tries'} (usually about ${usual}).${xpa >= 3 ? ' His team scored touchdowns instead of settling for field goals.' : sc && sc[0] <= 13 ? ` His offense only scored ${sc[0]} points, so it rarely got into range.` : ''}`);
    if (!good && (miss || xpMiss)) out.push(`Missed ${[miss && `${miss} of ${fga} field goals`, xpMiss && `${xpMiss} extra point${xpMiss > 1 ? 's' : ''}`].filter(Boolean).join(' and ')}.${wind >= 15 ? ` Wind was about ${wind} mph, which makes kicking harder.` : ''}`);
    if (!bad && usual != null && fgm >= avg(4) + 1.5) out.push(`Lots of kicks: ${fgm} field goals made (usually about ${avg(4)}). His offense kept stalling close.`);
    if (!bad && long) out.push(`Made ${long > 1 ? `${long} field goals` : 'a field goal'} from 50+ yards, worth extra points.`);
    if (!bad && xpm >= 4) out.push(`${xpm} extra points: his team scored a lot of touchdowns.`);
  } else {
    const [, opp, , allowed, sacks, ints, fum, tds] = w, to = ints + fum, usualTo = avg(5) + avg(6), usualSacks = avg(4);
    if (bad && allowed >= 24) out.push(`Gave up ${allowed} points.`);
    else if (good && allowed <= 13) out.push(`Gave up only ${allowed} points.`);
    if (good && to >= 3) out.push(`Forced ${to} turnovers (${[ints && `${ints} interception${ints > 1 ? 's' : ''}`, fum && `${fum} fumble${fum > 1 ? 's' : ''}`].filter(Boolean).join(', ')}).`);
    else if (bad && to === 0 && usualTo >= 1) out.push(`No turnovers (usually about ${Math.round(usualTo * 10) / 10} a game).`);
    if (good && sacks >= 5) out.push(`${sacks} sacks.`);
    else if (bad && sacks <= 1 && usualSacks >= 2.5) out.push(`Only ${sacks} sack${sacks === 1 ? '' : 's'} (usually about ${usualSacks}).`);
    if (tds) out.push(`Scored ${tds > 1 ? `${tds} touchdowns` : 'a touchdown'} on defense or a return, ${tds * 6} points.`);
    // the quarterback they faced
    const wq = wk === week ? weekNow : rosSaved.weeks?.[wk], uq = usualStarters(opp).find(s => s.pos === 'QB');
    if (!bad && uq && wq && !wq[uq.k] && Object.keys(wq).some(x => x.endsWith('|' + opp)) && Object.entries(rosSaved.weeks ?? {}).some(([w2, x]) => +w2 < wk && x[uq.k])) out.push(`Faced a backup QB: ${opp}'s usual starter, ${uq.name}, didn't play.`);
  }
  if (out.length === head) {
    if (bad) out.push('Nothing obvious in the stats. Some weeks just go this way.');
    else if (good) out.push('Nothing unusual about the setup: just a big game.');
  }
  return out;
}
function whyWeek(p, wk, pts, expected) {
  if (p.pos === 'K' || p.pos === 'D/ST') return whyKD(p, wk, pts, expected);
  const wd = wk === week ? weekNow : rosSaved.weeks?.[wk], team = TEAM(p.team), k = pkey(p.name, p.pos, p.team);
  if (!wd || !POS_PL[p.pos] || !Object.keys(wd).some(x => x.endsWith('|' + team))) return []; // no data, or his team had no game
  const w = wd[k];
  if (!w) return ['He didn\'t play (hurt or inactive).'];
  // a good week gets the reasons he beat his number, a bad week the reasons he missed it, never the other way round
  const exp = expected ?? p.avg, good = pts != null && exp > 0 && pts >= exp * 1.4 && pts - exp >= 4, bad = pts != null && exp > 0 && pts <= exp * 0.6 && exp - pts >= 3;
  const head = expected != null && (good || bad) ? 1 : 0, out = head ? [`Expected about ${n(expected)}, scored ${n(pts)}.`] : [];
  const other = Object.entries(rosSaved.weeks ?? {}).filter(([w2]) => +w2 !== wk).map(([, x]) => x[k]).filter(Boolean);
  const mid = i => { const v = other.map(x => x[i]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const sc = wk === week ? gameNow[team]?.score : rosSaved.scores?.[wk]?.[team], margin = sc ? sc[0] - sc[1] : 0, blowout = Math.abs(margin) >= 17;
  const shares = Object.values(rosSaved.weeks).map(x => x[k]?.[0]).filter(v => v != null).sort((a, b) => a - b), usualShare = shares[Math.floor(shares.length / 2)];
  if (w[0] != null && usualShare >= 40 && w[0] < usualShare * 0.6) out.push(good ? `He was on the field for only ${w[0]}% of his team's plays (usually ${usualShare}%), but made the most of it.`
    : `He was on the field for only ${w[0]}% of his team's plays (usually ${usualShare}%), so he ${blowout ? 'likely sat once the game was out of reach, or got hurt' : 'likely got hurt during the game or lost playing time'}.`);
  if (blowout && margin > 0 && p.pos === 'RB' && !bad) out.push(`His team won ${sc[0]}–${sc[1]}. Teams far ahead run a lot.`);
  else if (blowout && !good) out.push(`His team ${margin > 0 ? 'won' : 'lost'} ${sc[0]}–${sc[1]}.${margin > 0 ? ' Teams far ahead stop passing late, and starters can sit.'
    : p.pos === 'RB' ? ' Teams far behind stop running.' : ' Few good drives, and starters can sit late.'}`);
  // quarterback: pulled partway through (only when the usual starter really started: 5+ passes), or threw interceptions
  const squad = Object.entries(wd).filter(([key]) => key.endsWith('|' + team)), qbs = squad.filter(([, v]) => v[11] === 'QB' && v[9] >= 3).sort((a, b) => b[1][9] - a[1][9]);
  const uq = usualStarters(team).find(s => s.pos === 'QB'), sub = wd[uq?.k]?.[9] >= 5 && qbs.find(([key]) => key !== uq.k);
  const qb = qbs[0]?.[1], qbBad = !!sub || qb?.[10] >= 2;
  if (!good) {
    if (sub) out.push(uq.k === k ? `He was pulled for ${sub[1][12]}, who threw ${sub[1][9]} passes.`
      : sub[0] === k ? `He came in for ${uq.name} partway through, so he only played part of the game.`
      : `${uq.name} was pulled for ${sub[1][12]} partway through.`);
    if (qb?.[10] >= 2) out.push(qbs[0][0] === k ? `He threw ${qb[10]} interceptions.` : `${qb[12]}, his QB, threw ${qb[10]} interceptions.`);
  }
  // his chances: targets (WR/TE) or carries (RB), and why they changed
  if (p.pos !== 'QB') {
    const i = p.pos === 'RB' ? 4 : 3, kind = p.pos === 'RB' ? 'carries' : 'targets', usual = mid(i), plays = w[8], usualPlays = mid(8);
    const top = squad.filter(([key, v]) => key !== k && v[11] !== 'QB').map(([, v]) => v).sort((a, b) => b[i] - a[i])[0];
    if (!good && usual >= 4 && w[i] <= usual * 0.6) out.push(`Only ${w[i]} ${kind} (usually about ${usual}).${
      plays && usualPlays && plays < usualPlays * 0.85 ? ` His team only ran ${plays} plays (usually about ${usualPlays}), so there were fewer chances to go around.`
      : top && top[i] >= w[i] + 3 ? ` The ball went to others instead: ${top[12]} got ${top[i]}.`
      : blowout ? ' The lopsided score changed the game plan.'
      : qbBad ? ' His QB\'s rough day meant fewer good throws to go around.'
      : ' He played his usual snaps; the team just went his way less this game.'}`);
    else if (!bad && usual >= 3 && w[i] >= usual * 1.5) out.push(`Lots of chances: ${w[i]} ${kind} (usually about ${usual}).`);
    // catches
    const tgts = other.reduce((t, x) => t + (x[3] ?? 0), 0), usualRate = tgts >= 10 ? Math.round(other.reduce((t, x) => t + (x[7] ?? 0), 0) / tgts * 100) : null;
    if (!good && w[3] >= 4 && usualRate && w[7] / w[3] <= 0.4 && usualRate - w[7] / w[3] * 100 >= 20) out.push(`He caught only ${w[7]} of ${w[3]} passes thrown his way (usually ${usualRate}%).${qbBad ? ' His QB struggled, so a lot of throws were off.' : ' The stats don\'t say if it was drops, bad throws or tight coverage.'}`);
    else if (good && w[3] >= 3 && w[7] === w[3]) out.push(`He caught all ${w[3]} passes thrown his way.`);
    // touchdowns: 6 points each, the biggest swing week to week
    const tds = other.reduce((t, x) => t + (x[6] ?? 0), 0);
    if (bad && w[6] === 0 && tds >= 3) out.push(`No touchdown (he has ${tds} in his other games).`);
    else if (!bad && w[6] >= 1 && (good || w[6] >= 2)) out.push(`He scored ${w[6] > 1 ? `${w[6]} touchdowns` : 'a touchdown'}, ${w[6] * 6} of his ${n(pts)} points.`);
  }
  const r = defRank(p.pos, w[1]), of = Object.keys(rosSaved.allowed?.[p.pos] ?? {}).length;
  if (!good && r && r > of - 6) out.push(`He faced ${w[1]}, one of the toughest defenses against ${POS_PL[p.pos]} (${ordinal(of - r + 1)} fewest points given up).`);
  else if (!bad && r && r <= 6) out.push(`He faced ${w[1]}, one of the easiest defenses for ${POS_PL[p.pos]} (${ordinal(r)} most points given up).`);
  for (const st of usualStarters(team)) {
    // missing only counts if he'd already played for them (a backup who took over later wasn't "missing" before that)
    if (st.k === k || wd[st.k] || !Object.entries(rosSaved.weeks).some(([w2, x]) => +w2 < wk && x[st.k])) continue;
    if (st.pos === 'QB') { if (!good) out.push(`His team's usual quarterback, ${st.name}, didn't play, so a backup was throwing.`); }
    else if (st.pos === p.pos) { if (!bad) out.push(`${st.name}, another top ${POS_ONE[p.pos]} on his team, didn't play, so more of the ball could go his way.`); }
    else out.push(`${st.name}, his team's top ${POS_ONE[st.pos]}, didn't play.`);
  }
  if (out.length === head) {
    if (bad) out.push('Nothing obvious: usual snaps, average defense, main teammates playing.');
    else if (good) out.push('Nothing unusual: just a big game.');
    else out.push('A normal game for him: his usual playing time, an average defense, teammates playing.');
  }
  return out;
}
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
    disagree: SLP_OUT.includes(sl) && !out ? `Injury reports disagree: ESPN says he ${ESPN_WORD[e] ?? 'is healthy'}, but Sleeper still lists him as ${sl === 'IR' ? 'on IR' : sl.toLowerCase()}. Check again before kickoff.` : null };
}
const gameStatusOf = new Map(rosSaved.gameStatus ?? []);
// Teammates who were questionable or doubtful at some point this week, so a note can say when that got decided
// (teams name who's out about 90 minutes before kickoff, and ESPN drops the tag then).
memo.doubt = { [week]: { ...memo.doubt?.[week] } };
for (const list of usualBy.values()) for (const st of list) { const s = statusOf(st.k); if (s.maybe || s.espnSays === 'DOUBTFUL') memo.doubt[week][st.k] = 1; }
// Why you won or lost last week: starters who scored far below or above what was expected, each with its reasons.
// Expected = the site's own number saved that week; ESPN's projection from the box score before that was saved.
if (recap?.started) try {
  const swing = recap.started.map(({ id, name, pos, pts, pl }) => {
    const exp = memo.exp?.[recap.wk]?.[id] ?? pl.stats?.find(s => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === recap.wk)?.appliedTotal;
    const who = me.roster.find(x => x.id === id) ?? { name, pos, team: proAbbr[pl.proTeamId], avg: pl.stats?.find(s => s.seasonId === SEASON && s.statSourceId === 0 && s.statSplitTypeId === 0)?.appliedAverage ?? 0 };
    return exp == null ? null : { name, pos, pts, exp, why: whyWeek(who, recap.wk, pts, exp).filter(t => !t.startsWith('Expected about')) };
  }).filter(Boolean);
  recap.expTotal = swing.length === recap.started.length ? swing.reduce((t, x) => t + x.exp, 0) : null;
  recap.down = swing.filter(x => x.exp - x.pts >= 4).sort((a, b) => (a.pts - a.exp) - (b.pts - b.exp)).slice(0, 3);
  recap.up = swing.filter(x => x.pts - x.exp >= 5).sort((a, b) => (b.pts - b.exp) - (a.pts - a.exp)).slice(0, 2);
} catch (err) { console.warn('Recap reasons skipped:', err.message); }
// His share of his team's snaps, targets (WR/TE) or carries (RB), and red-zone chances: last 3 games he played vs
// the games before. Usage is the stickiest thing in fantasy (target share most of all), so a role change matters.
// ponytail: a player traded mid-season only counts games under his current team.
function usageOf(k, team, pos, weeks = rosSaved.weeks ?? {}) {
  const i = pos === 'RB' ? 4 : 3, games = [];
  for (const wk of Object.keys(weeks).sort((a, b) => a - b)) {
    const wd = weeks[wk], me = wd[k];
    if (!me || me[3] == null) continue;
    const mates = Object.entries(wd).filter(([key]) => key.endsWith('|' + team)).map(([, v]) => v);
    games.push({ snap: me[0], mine: me[i], all: mates.reduce((t, v) => t + (v[i] ?? 0), 0), rz: me[5], rzAll: mates.reduce((t, v) => t + (v[5] ?? 0), 0) });
  }
  if (games.length < 2) return null;
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null), sum = (g, f) => g.reduce((t, x) => t + (x[f] ?? 0), 0);
  const snapAvg = g => { const v = g.map(x => x.snap).filter(x => x != null); return v.length ? Math.round(v.reduce((t, x) => t + x, 0) / v.length) : null; };
  const now = games.slice(-3), before = games.length >= 4 ? games.slice(0, -3) : null;
  return { kind: pos === 'RB' ? 'carries' : 'targets', snapNow: snapAvg(now), snapBefore: before && snapAvg(before), shareNow: pct(sum(now, 'mine'), sum(now, 'all')),
    shareBefore: before && pct(sum(before, 'mine'), sum(before, 'all')), rz: sum(games, 'rzAll') >= 10 ? pct(sum(games, 'rz'), sum(games, 'rzAll')) : null };
}
// what the kickoff forecast means for him, in plain words. Only strong wind is counted in his number; rain and cold are small hits.
function weatherEffect(p, w) {
  const wet = w.rain >= 1, cold = w.temp <= 25, play = p.pos === 'K' ? 'kicking' : 'passing';
  if (p.pos === 'RB') return w.wind >= 15 || wet ? ' Bad weather means more running, which can help him.' : ' Good weather, so no effect on him.';
  if (p.wind < 1) return ` Wind over 15 mph cuts ${play}, so his number is lowered ${Math.round((1 - p.wind) * 100)}%.`;
  const hits = [wet && (p.pos === 'K' ? 'a wet ball makes kicks less sure' : 'a wet ball means more drops and fumbles'), cold && `the cold makes ${play} a little harder`].filter(Boolean);
  if (hits.length) return ` Not great: ${hits.join(' and ')}. A small hit for him.`;
  return w.wind >= 10 ? ' A little wind, not enough to matter.' : ' Good weather, so no effect on him.';
}
function notes(p) {
  const team = TEAM(p.team), k = pkey(p.name, p.pos, p.team), out = [], me_ = statusOf(k);
  if (me_.out) {
    const still = [['ESPN', p.espn], ['Rotowire', p.roto], ['CBS', p.cbs]].filter(([, v]) => v != null && v >= 3);
    if (still.length) out.push(`Experts haven't caught up: he ${me_.word}, but ${still.map(([src, v]) => `${src} still expects ${n(v)}`).join(' and ')}. ${HURT.includes(p.status) ? 'The site counts him as 0 this week.' : 'Don\'t start him unless that changes.'}`);
  } else if (me_.disagree) out.push(me_.disagree);
  const w = p.bye === week ? null : rosSaved.weather?.[team];
  if (w && ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.pos)) {
    if (w.indoor) out.push(`Indoor game${w.place ? ` (${w.place})` : ''}, so weather won't matter.`);
    else if (w.wind != null) out.push(`Forecast at kickoff${w.place ? ` (${w.place})` : ''}: ${w.wind} mph wind${w.gust >= w.wind + 8 ? `, gusts ${w.gust}` : ''}, ${w.temp}°F${w.rain >= 1 ? ', rain' : ''}.`
      + weatherEffect(p, w));
  }
  if (p.qbAdj) out.push(`His usual QB, ${p.qbAdj.qb}, is out and the experts haven't updated yet. In ${p.qbAdj.games} games without him this season he averaged ${n(p.qbAdj.without)} (vs ${n(p.qbAdj.with)} with him), so his number is changed from ${n(p.qbAdj.from)} to ${n(p.proj)}.`);
  if (!POS_PL[p.pos]) return out;
  // depth chart: who's ahead of him, and whether that player is out
  const depth = rosSaved.depth?.[team] ?? [], spot = depth.find(([, , name]) => norm(name) === norm(p.name));
  const outNow = name => { const g = gameStatusOf.get(pkey(name, '', team)) ?? depth.find(x => x[2] === name)?.[3]; return ['Out', 'Doubtful', 'IR', 'PUP', 'Sus'].includes(g); };
  if (spot && spot[1] === 2) {
    const ahead = depth.find(([d, o]) => d === spot[0] && o === 1);
    if (ahead) out.push(outNow(ahead[2]) ? `${ahead[2]}, ahead of him on the depth chart, is out, so he should start.` : `Backup: ${ahead[2]} is ahead of him on the depth chart.`);
  }
  // the defense he faces: starters it's missing (not counted in his number; one missing defender rarely moves scoring much)
  const opp = p.bye === week ? null : oppId(p, week), DEF_WORD = { LCB: 'cornerback', RCB: 'cornerback', NB: 'nickel cornerback', FS: 'safety', SS: 'safety', LDE: 'defensive end', RDE: 'defensive end', LDT: 'defensive tackle', RDT: 'defensive tackle', NT: 'nose tackle', MLB: 'linebacker', LILB: 'linebacker', RILB: 'linebacker', LOLB: 'linebacker', ROLB: 'linebacker', WLB: 'linebacker', SLB: 'linebacker' };
  const vsPass = ['LCB', 'RCB', 'NB', 'FS', 'SS'], vsRun = ['LDE', 'RDE', 'LDT', 'RDT', 'NT', 'MLB', 'LILB', 'RILB', 'LOLB', 'ROLB', 'WLB', 'SLB'];
  if (opp) {
    const oteam = TEAM(proAbbr[opp]), oDepth = rosSaved.depth?.[oteam] ?? [];
    const want = p.pos === 'RB' ? vsRun : p.pos === 'QB' ? [...vsPass, 'LDE', 'RDE'] : vsPass;
    const gone = oDepth.filter(([d, o, name, inj]) => o === 1 && want.includes(d) && ['Out', 'Doubtful', 'IR', 'PUP', 'Sus'].includes(gameStatusOf.get(pkey(name, '', oteam)) ?? inj));
    if (gone.length) out.push(`The ${proName[opp]} are missing ${gone.length > 1 ? 'starters' : 'a starter'}: ${gone.map(([d, , name]) => `${DEF_WORD[d] ?? d} ${name}`).join(', ')}. ${gone.length >= 2 ? 'That should make it an easier matchup' : 'A little easier matchup'}, but it isn't counted in his number.`);
  }
  if (p.pos === 'QB') {
    const q = qbThisWeek(team);
    if (q && q.k !== k && (slpBy.get(k)?.pts ?? 0) < q.pts / 2) out.push(`Not expected to start this week: ${q.name} is the starting QB.`);
  }
  for (const st of usualStarters(team)) {
    const now = statusOf(st.k), was = memo.doubt[week][st.k] && !now.maybe;
    if (st.k === k) continue;
    if (!(now.out || now.maybe)) {
      if (!was) continue;
      if (st.pos === 'QB' && p.pos !== 'QB') out.push(`Decided: his QB, ${st.name}, was questionable but is playing. Good news for ${p.name}.`);
      else if (st.pos === p.pos) out.push(`Decided: ${st.name} was questionable but is playing, so ${p.name} won't get the extra work. Expect his usual role.`);
      else if (p.pos === 'QB' && ['WR', 'TE'].includes(st.pos)) out.push(`Decided: ${st.name}, one of his top targets, was questionable but is playing.`);
      continue;
    }
    const sure = now.out, status = was && now.espnSays === 'OUT' ? 'was questionable and has now been ruled out' : now.word;
    const lag = sure && (slpBy.get(st.k)?.pts ?? 0) >= 3 ? ` Experts still project ${st.name} as if he plays, so ${p.name}'s number may not reflect this yet.` : '';
    if (st.pos === 'QB' && p.pos !== 'QB') {
      const q = qbThisWeek(team);
      out.push(`His usual QB, ${st.name}, ${status}.${sure && q && q.k !== st.k ? ` ${q.name} is expected to start instead. A backup QB usually means fewer points for his teammates.` : ''}${lag}`);
    } else if (st.pos === p.pos) {
      out.push(`${st.name}, one of the team's usual starting ${POS_PL[p.pos]}, ${status}. ${sure ? 'That' : 'If he sits, that'} should mean more work for ${p.name}.${sure ? '' : ' This note updates when it\'s decided, about 90 minutes before kickoff.'}${lag}`);
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
  // role: what the experts' numbers rest on, shown so a change is easy to spot (not counted again)
  const u = p.pos !== 'QB' && usageOf(k, team, p.pos);
  if (u) {
    if (u.snapBefore != null && u.snapNow != null && Math.abs(u.snapNow - u.snapBefore) >= 15) out.push(`${u.snapNow > u.snapBefore ? 'Bigger' : 'Smaller'} role lately: on the field for ${u.snapNow}% of plays over his last 3 games, vs ${u.snapBefore}% before.`);
    if (u.shareBefore != null && u.shareNow != null && Math.abs(u.shareNow - u.shareBefore) >= 7) out.push(`He's getting ${u.shareNow}% of his team's ${u.kind} lately, vs ${u.shareBefore}% before.`);
    else if (u.shareNow >= 25) out.push(`He gets ${u.shareNow}% of his team's ${u.kind}, a big share.`);
    if (u.rz >= 25) out.push(`He gets ${u.rz}% of his team's chances near the goal line, so he's a real touchdown threat.`);
  }
  // offensive line: two or more starters out hurts the run game and the QB
  if (['RB', 'QB'].includes(p.pos)) {
    const oline = depth.filter(([d, o, name, inj]) => o === 1 && ['LT', 'LG', 'C', 'RG', 'RT'].includes(d) && ['Out', 'Doubtful', 'IR', 'PUP', 'Sus'].includes(gameStatusOf.get(pkey(name, '', team)) ?? inj));
    if (oline.length >= 2) out.push(`His team is missing ${oline.length} starting offensive linemen (${oline.map(x => x[2]).join(', ')}), which tends to hurt ${p.pos === 'RB' ? 'the run game' : 'the QB: more pressure, fewer clean throws'}.`);
  }
  // game script: big favorites run more, big underdogs throw more (from the Vegas lines)
  const oppVegas = opp && vegas[TEAM(proAbbr[opp])], line = p.vegas != null && oppVegas != null ? p.vegas - oppVegas : null;
  if (line != null && Math.abs(line) >= 7) out.push(line > 0
    ? `His team is a big favorite (by about ${Math.round(line)}). Teams with a lead run more late, ${p.pos === 'RB' ? 'which helps him' : 'so fewer passes'}.`
    : `His team is a big underdog (by about ${Math.round(-line)}). Teams that trail throw more, ${p.pos === 'RB' ? 'which can cut his carries (catching backs do better)' : 'which helps the passing game'}.`);
  return out;
}
// --- Edges over managers who follow football: who fills in for an injured starter, whose role is growing before the
// projections notice, whose points run ahead of or behind his role, and what each other manager needs right now.
// ESPN ids for every NFL player (public list, no login), so free players outside the top-40 lists can be looked up
if (!rosSaved.espnIds) try {
  const all = await (await fetch(`${BASE}/players?scoringPeriodId=0&view=players_wl`, { headers: { 'x-fantasy-filter': JSON.stringify({ filterActive: { value: true } }) } })).json();
  rosSaved.espnIds = all.filter(x => ['QB', 'RB', 'WR', 'TE'].includes(POS[x.defaultPositionId]) && proAbbr[x.proTeamId]).map(x => [pkey(x.fullName, POS[x.defaultPositionId], proAbbr[x.proTeamId]), x.id]);
} catch (err) { console.warn('ESPN player list skipped:', err.message); }
const espnIdOf = new Map(rosSaved.espnIds ?? []);
const rosteredBy = new Map(teams.flatMap(t => t.roster.map(p => [pkey(p.name, p.pos, p.team), { t, p }])));
const faByKey = new Map(allFa.map(p => [pkey(p.name, p.pos, p.team), p]));
// ESPN rows (with waiver status) for free players, by key; players not in the top-40 lists are looked up by id
async function freeRows(keys) {
  const out = new Map(keys.filter(k => faByKey.has(k)).map(k => [k, faByKey.get(k)]));
  const ids = [...new Set(keys.filter(k => !out.has(k) && espnIdOf.has(k)).map(k => espnIdOf.get(k)))];
  if (ids.length) try {
    const d = await get(`${LEAGUE}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: ids } } });
    for (const x of d.players) {
      if (x.onTeamId > 0 || x.status === 'ONTEAM') continue;
      const r = { ...row(x.player, x.ratings), wa: x.status === 'WAIVERS', slot: 'FA' };
      names[r.id] = r.name; byId.set(r.id, r); out.set(pkey(r.name, r.pos, r.team), r);
    }
  } catch (err) { console.warn('Free player lookup skipped:', err.message); }
  return out;
}
// Who I'd drop to make room for a must-add: nobody if there's an open spot, else my weakest bench player who isn't a keeper
const roomFor = () => (rosterSpots - me.roster.filter(p => p.slot !== 'IR').length > 0 ? null
  : me.roster.filter(p => p.slot === 'Bench' && !locked(p) && !isKeeper(p) && !(HURT.includes(p.status) && !p.inj?.season)).sort((a, b) => weakness(a) - weakness(b))[0] ?? null);
const addMove = (p, drop) => p && !locked(p) && (!drop || !locked(drop)) ? { label: `${p.wa ? 'Claim' : 'Add'} ${p.name}${drop ? `, drop ${drop.name}` : ''} on ESPN`, type: p.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: p.id }, ...(drop ? [{ type: 'DROP', playerId: drop.id }] : [])] } : null;

// 1. Injury fill-ins: a team's #1 QB/RB/TE/WR (depth chart) is out and his #2 is free in this league. Receivers are listed at
// three spots (left, right, slot): the #2 at the out starter's own spot takes his place. The experts and
// most managers react hours later. Only starters someone here rosters count (in 16 teams, that's every one who matters).
// ponytail: the backup's worth is guessed as 75% of the starter's (60% for a receiver: his targets spread to the other
// receivers and the tight end); a real split needs snap data.
const fillIns = [];
for (const [team, chart] of Object.entries(rosSaved.depth ?? {})) for (const [d, o, name] of chart) {
  const wr = ['LWR', 'RWR', 'SWR'].includes(d);
  if (o !== 1 || !(wr || ['QB', 'RB', 'TE'].includes(d))) continue;
  const k1 = pkey(name, d, team), st = statusOf(k1), held = rosteredBy.get(k1);
  if (!st.out || !held) continue;
  const b = chart.find(([d2, o2]) => d2 === d && o2 === 2);
  const k2 = b && pkey(b[2], d, team);
  if (!b || rosteredBy.has(k2) || statusOf(k2).out) continue;
  const long = ['INJURY_RESERVE', 'SUSPENSION'].includes(held.p.status) || held.p.inj?.season || slpBy.get(k1)?.inj === 'IR';
  fillIns.push({ k: k2, name: b[2], pos: wr ? 'WR' : d, team, starter: held.p, owner: held.t, word: st.word, long, worth: rate(held.p) * (wr ? 0.6 : 0.75) });
}
const fillRows = await freeRows(fillIns.map(f => f.k));
for (const f of fillIns) {
  f.p = fillRows.get(f.k) ?? null;
  // how much he'd add to my best lineup, valued as a starter (his own projection may not know yet)
  const as = { ...(f.p ?? { name: f.name, pos: f.pos, team: f.team }), ros: Math.max(f.worth, f.p ? rate(f.p) : 0), slot: 'Bench', status: '' };
  f.gain = score([...baseRoster, as], seasonValue) - score(baseRoster, seasonValue);
  f.drop = roomFor();
}
fillIns.sort((a, b) => b.gain - a.gain || b.worth - a.worth);

// 2. Breakout watch: free RB/WR/TE whose snaps or share of the team's targets/carries jumped over his last 3 games.
// Role comes before points, and projections follow points, so this is the early sign.
const lastPlayed = Math.max(0, ...Object.keys(rosSaved.weeks ?? {}).map(Number));
const recentPts = (k, games = 3) => Object.keys(rosSaved.weeks ?? {}).map(Number).sort((a, b) => b - a).map(w => rosSaved.weeks[w][k]?.[2]).filter(v => v != null).slice(0, games);
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const breakouts = [];
for (const [k, name, pos, team] of rosSaved.usual ?? []) {
  if (!['RB', 'WR', 'TE'].includes(pos) || rosteredBy.has(k) || statusOf(k).out) continue;
  if (!rosSaved.weeks?.[lastPlayed]?.[k] && !rosSaved.weeks?.[lastPlayed - 1]?.[k]) continue; // must still be playing
  const u = usageOf(k, team, pos);
  if (!u || u.snapBefore == null || u.shareBefore == null) continue;
  const snapUp = u.snapNow - u.snapBefore, shareUp = u.shareNow - u.shareBefore;
  if (!((snapUp >= 15 && u.snapNow >= 50) || (shareUp >= 8 && u.shareNow >= (pos === 'RB' ? 35 : 18)))) continue;
  // a teammate at his spot who's out is the usual reason the work moved to him
  const cause = (rosSaved.usual ?? []).filter(([k2, , p2, t2]) => t2 === team && p2 === pos && k2 !== k && statusOf(k2).out).map(x => x[1]);
  breakouts.push({ k, name, pos, team, u, cause, snapUp, shareUp, recent: avgOf(recentPts(k)), size: Math.max(0, snapUp) / 15 + Math.max(0, shareUp) / 8 });
}
breakouts.sort((a, b) => b.size - a.size).splice(6);
const breakRows = await freeRows(breakouts.map(b => b.k));
for (const b of breakouts) b.p = breakRows.get(b.k) ?? null;

// 3. Buy low / sell high: touchdown luck over the last 5 games. Chances near the goal line repeat week to week;
// scoring on them mostly doesn't (a TD-per-chance rate swings a lot game to game), so a player scoring far more or fewer
// touchdowns than his chances usually bring tends to come back to normal. Yards stay as they are: a great receiver's
// efficiency is real skill. "Usually bring" = this season's touchdowns per red-zone chance at his position, every RB/WR/TE game.
// (Checked on 2026 weeks 1-6: Jeanty and Pollard came out as buys with 1 TD on 19 chances; Smith-Njigba as a sell with 6 on 8.)
const posOfKey = new Map((rosSaved.usual ?? []).map(([k, , pos]) => [k, pos]));
const tdRate = {};
{
  const sum = {};
  for (const wd of Object.values(rosSaved.weeks ?? {})) for (const [k, g] of Object.entries(wd)) {
    const pos = posOfKey.get(k), t = (sum[pos] ??= [0, 0]);
    if (g[6] != null && g[0] >= 20) { t[0] += g[6]; t[1] += g[5]; } // real roles only
  }
  for (const [pos, [td, rz]] of Object.entries(sum)) if (rz >= 50) tdRate[pos] = td / rz;
}
// Points a target, carry or air yard is worth at each position, touchdowns aside. Weights from 2023-25 (nflverse): a target
// counts as 2 carries, 25 air yards as 1 carry. A game with no air yards yet gets the position's usual per target.
const airPerTgt = {};
{
  const sum = {};
  for (const [wk, wd] of Object.entries(rosSaved.weeks ?? {})) for (const [k, g] of Object.entries(wd)) {
    g[13] = rosSaved.air?.[wk]?.[k] ?? null;
    if (g[13] != null) { const t = (sum[posOfKey.get(k)] ??= [0, 0]); t[0] += g[13]; t[1] += g[3]; }
  }
  for (const [pos, [air, tgt]] of Object.entries(sum)) if (tgt >= 100) airPerTgt[pos] = air / tgt;
}
const oppOf = (g, pos) => g[3] * 2 + g[4] + (g[13] ?? g[3] * (airPerTgt[pos] ?? 0)) * 0.04;
const oppRate = {};
{
  const sum = {};
  for (const wd of Object.values(rosSaved.weeks ?? {})) for (const [k, g] of Object.entries(wd)) {
    const pos = posOfKey.get(k), t = (sum[pos] ??= [0, 0]);
    if (g[6] != null && g[0] >= 20) { t[0] += g[2] - g[6] * 6; t[1] += oppOf(g, pos); }
  }
  for (const [pos, [pts, opp]] of Object.entries(sum)) if (opp >= 200) oppRate[pos] = pts / opp;
}
// Odds for one game: how far every real game at his position landed from that player's own average, applied to this week's number.
const OUTCOMES = {};
{
  const byPlayer = {};
  for (const wd of Object.values(rosSaved.weeks ?? {})) for (const [k, g] of Object.entries(wd)) if (g[0] >= 20) (byPlayer[k] ??= []).push(g[2]);
  for (const [k, pts] of Object.entries(byPlayer)) {
    const avg = pts.reduce((s, x) => s + x, 0) / pts.length, pos = posOfKey.get(k);
    if (pts.length >= 3 && avg >= 5 && TRADE_POS.includes(pos)) (OUTCOMES[pos] ??= []).push(...pts.map(x => x / avg));
  }
  for (const v of Object.values(OUTCOMES)) v.sort((a, b) => a - b);
}
function gameOdds(ratios, proj) {
  if (!(proj > 0) || !(ratios?.length >= 50)) return null;
  const at = q => +(ratios[Math.floor(q * (ratios.length - 1))] * proj).toFixed(1), over = pts => Math.round(ratios.filter(r => r * proj >= pts).length / ratios.length * 100);
  return [at(0.1), at(0.9), over(15), over(20)];
}
const oddsOf = p => (p.bye === week ? null : gameOdds(OUTCOMES[p.pos], p.proj));
function luck(p) {
  const k = pkey(p.name, p.pos, p.team), r = tdRate[p.pos], each = oppRate[p.pos];
  if (r == null || each == null) return null;
  const games = Object.keys(rosSaved.weeks ?? {}).map(Number).sort((a, b) => b - a).map(w => rosSaved.weeks[w][k]).filter(g => g && g[6] != null).slice(0, 5);
  if (games.length < 3) return null;
  const tot = i => games.reduce((s, g) => s + g[i], 0), got = tot(2) / games.length, td = tot(6), rz = tot(5);
  const worth = (games.reduce((s, g) => s + oppOf(g, p.pos), 0) * each + rz * r * 6) / games.length; // a rushing or receiving TD is 6 points
  return { games: games.length, got, worth, gap: got - worth, rz, tgt: tot(3) / games.length, car: tot(4) / games.length, air: games.every(g => g[13] != null) ? tot(13) / games.length : null };
}
const roleText = l => `${n(l.tgt)} targets${l.air >= 20 ? ` (${Math.round(l.air)} air yards)` : ''} and ${n(l.car)} carries a game, ${l.rz} chances near the goal line in ${l.games} games`;
const sellHigh = me.roster.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && playable(p)).map(p => ({ p, l: luck(p) })).filter(x => x.l?.games >= 5 && x.l.gap >= 3 && x.l.got >= 8).sort((a, b) => b.l.gap - a.l.gap);
const buyLow = teams.filter(t => t !== me).flatMap(t => t.roster.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && playable(p)).map(p => ({ p, t, l: luck(p) })))
  .filter(x => x.l?.games >= 5 && x.l.gap <= -3 && x.l.worth >= 8).sort((a, b) => a.l.gap - b.l.gap).slice(0, 8);

// 4. Manager profiles: where each team stands, who they're missing, and how often they deal. What a manager will
// accept depends on his situation more than on the numbers: a team fighting for a playoff spot pays for help now.
const recordOrder = [...teams].sort((a, b) => b.w + b.ties / 2 - (a.w + a.ties / 2) || b.pf - a.pf);
const winsOf = t => t.w + t.ties / 2;
const gamesLeft = Math.max(0, lastWeek - week + 1);
function profile(t) {
  const rank = recordOrder.indexOf(t) + 1, cut = recordOrder[playoffTeams - 1], firstOut = recordOrder[playoffTeams];
  const gb = playoffTeams && rank > playoffTeams ? winsOf(cut) - winsOf(t) : 0;
  const mode = !playoffTeams || !cut ? null : rank <= playoffTeams ? (firstOut && winsOf(t) - winsOf(firstOut) >= 2 ? 'safe' : 'bubble') : gb > gamesLeft ? 'out' : gb <= 1 ? 'bubble' : 'longshot';
  const hurt = t.roster.filter(p => ['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && TRADE_POS.includes(p.pos) && rate(p) >= typical[p.pos]);
  const deals = moves.filter(m => m.team === t.id).length + [...intel.values(), ...othersPending.values()].filter(tx => tx.type.startsWith('TRADE') && (tx.items ?? []).some(i => i.fromTeamId === t.id || i.toTeamId === t.id)).length;
  const say = [];
  if (mode === 'out') say.push('Out of the playoff race, so a low offer can work.');
  else if (mode === 'longshot') say.push(`${gb} game${gb === 1 ? '' : 's'} out of a playoff spot with ${gamesLeft} left, so they need wins now and will take risks for points this week.`);
  else if (mode === 'bubble') say.push('Fighting for a playoff spot: help this week matters most to them.');
  else if (mode === 'safe') say.push('Safe in the playoffs: they\'ll want a clear upgrade.');
  if (hurt.length) say.push(`Missing ${hurt.map(p => `${p.name} (${p.pos}, ${STATUS[p.status]?.[0].toLowerCase() ?? 'out'})`).join(', ')}, so a healthy ${[...new Set(hurt.map(p => POS_NAME[p.pos].toLowerCase()))].join('/')} is worth extra to them right now.`);
  say.push(deals >= 4 ? `Busy manager: ${deals} adds, drops or trade offers in 3 weeks, so open to offers.` : deals === 0 ? 'No moves in 3 weeks: keep offers simple and clearly good for them.' : `${deals} move${deals === 1 ? '' : 's'} in 3 weeks.`);
  return { rank, mode, hurt, deals, record: `${t.w}-${t.l}${t.ties ? `-${t.ties}` : ''}`, say };
}
const profiles = new Map(teams.filter(t => t !== me).map(t => [t, profile(t)]));
const MODE_WORD = { safe: 'safe in the playoffs', bubble: 'on the playoff bubble', longshot: 'long shot for the playoffs', out: 'out of the race' };
const situation = t => { const pr = profiles.get(t); return pr ? `${pr.record}, ${ordinal(pr.rank)}${pr.mode ? `, ${pr.mode === 'bubble' && pr.rank <= playoffTeams ? 'in a playoff spot' : MODE_WORD[pr.mode]}` : ''}${pr.hurt.length ? `, missing ${pr.hurt.map(p => p.name).join(' and ')}` : ''}` : ''; };

// Bye trouble: managers still fighting for the playoffs who lose real points in a coming bye week, even with the best
// free agents, and who on my bench fills the hole. A team out of the race has no reason to pay for that.
const topFa = allFa.filter(playable).sort((a, b) => seasonValue(b) - seasonValue(a)).slice(0, 40);
const byeTrouble = (tradesOpen ? teams : []).filter(t => t !== me && ['bubble', 'longshot'].includes(profiles.get(t)?.mode)).flatMap(t => {
  const full = score(t.roster, seasonValue), fullUp = lineups.get(t).map(x => x.player);
  return Array.from({ length: Math.max(0, lastWeek - week) }, (_, i) => week + 1 + i).map(w => {
    const v = p => (p.bye === w ? 0 : seasonValue(p)), patched = score([...t.roster, ...topFa], v), off = fullUp.filter(p => p.bye === w);
    const offer = me.roster.filter(p => !isStarter(p) && tradeable(p) && p.bye !== w).map(p => ({ p, gain: score([...t.roster, ...topFa, p], v) - patched })).sort((a, b) => b.gain - a.gain)[0];
    return { t, w, lost: full - patched, off, offer };
  }).filter(x => x.off.length && x.lost >= 8 && x.offer?.gain >= 2).sort((a, b) => b.lost - a.lost).slice(0, 1);
}).sort((a, b) => b.lost - a.lost).slice(0, 5);
// Start-slot order: an earlier game in the position's own slot and a later one in FLEX, so FLEX can still change to any position late.
function slotOrder(roster, kick, isLocked) {
  const f = roster.find(p => p.slot === 'FLEX');
  if (!f || isLocked(f) || kick(f) == null) return null;
  const late = roster.filter(p => p.slot === f.pos && !isLocked(p) && kick(p) > kick(f)).sort((a, b) => kick(b) - kick(a))[0];
  return late ? { early: f, late } : null;
}
const slotSwap = bestMove ? null : slotOrder(me.roster, kickoff, locked);
const kickText = p => new Date(kickoff(p)).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
// My weakest position by starters' rest-of-season points, and my best two-for-one.
const posRank = pos => { const sum = t => lineups.get(t).filter(x => x.slot === pos).reduce((s, x) => s + rate(x.player), 0); return 1 + teams.filter(t => sum(t) > sum(me)).length; };
const worstPos = [...TRADE_POS].sort((a, b) => posRank(b) - posRank(a))[0];
const bestTwoForOne = [...fleecePool, ...ideaPool].filter(f => f.give.length === 2).sort((a, b) => b.mine - a.mine)[0];

// To-do and alerts for the new finds. Only big ones push (Brody's pick): a fill-in who'd start for me.
// Breakouts and buy low / sell high stay in the app.
const firstLater = todo.findIndex(x => x[0] !== 'urgent');
todo.splice(firstLater < 0 ? todo.length : firstLater, 0, ...fillIns.filter(f => f.p && f.gain >= 0.5).map(f => ['urgent', `Grab ${f.name} before anyone else`,
  `${f.starter.name} ${f.word}, so ${f.name} should take over as ${f.team}'s ${POS_NAME[f.pos].toLowerCase()}${f.long ? ' for a while' : ' this week'}. Nobody in your league has him, and the experts haven't caught up. He'd add about ${n(f.gain)} a week to your lineup.${f.drop ? ` To make room, drop ${f.drop.name}.` : ''}`,
  addMove(f.p, f.drop), [f.p, f.starter]]));
for (const f of fillIns.filter(f => f.gain >= 0.5)) alerts.push([`fillin:${week}:${f.k}`, `Grab ${f.name} (${f.team} ${f.pos})`,
  `${f.starter.name} ${f.word}, so ${f.name} should start${f.long ? ' for a while' : ' this week'}. Nobody in your league has him. He'd add about ${n(f.gain)} a week to your lineup. ${f.p?.wa ? 'On waivers: put in a claim.' : 'Add him before someone else does.'}`, true]);
// a free player with no ESPN row yet still gets a card: name, team and position
// "Pick him up": opens his page at Add him, where you choose who to drop (best choice first)
const pickBtn = p => (MOVE_URL && p && !locked(p) && !rosteredBy.has(pkey(p.name, p.pos, p.team)) ? `<button type="button" class="btn" data-pickup="${p.id}">Pick him up</button>` : '');
const freeCard = (p, name, team, pos) => (p ? player(p) : `<div class="player"><span class="pic" data-i="${initials(name)}"></span><div class="who"><div class="name">${esc(name)}</div><div class="meta"><span class="pos pos-${pos}">${pos}</span> ${esc(team)}</div></div></div>`);

// Tapping a player opens his detail sheet; every player shown is remembered so the sheet data
// (recent games, news, game time) is fetched for exactly those after the page is built.
// rank = how he compares at his position this season
// his spot on his NFL team's depth chart: 1st string, 2nd string... (receivers: 1st at any of the three WR spots is a starter)
const depthAt = new Map(), dkey = (team, name) => team + '|' + norm(name).replace(/ (jr|sr|ii|iii|iv|v)$/, ''); // Sleeper often drops the Jr.
for (const [team, chart] of Object.entries(rosSaved.depth ?? {})) for (const [, o, name] of chart) { const k = dkey(team, name); if (!(depthAt.get(k) <= o)) depthAt.set(k, o); }
const depthWord = p => { if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(p.pos)) return ''; const o = depthAt.get(dkey(TEAM(p.team), p.name));
  return o ? ordinal(o) + ' string' : ''; };
const shown = new Map();
const player = (p, extra = '') => { shown.set(p.id, p); return `<div class="player" data-pid="${p.id}" role="button" tabindex="0">${pic(p)}<div class="who">
  <div class="name">${esc(p.name)} <span class="more">&rsaquo;</span></div>
  <div class="meta"><span class="pos pos-${p.pos.replace('/', '')}">${p.pos}</span> ${esc(proAbbr[p.proTeamId] ?? p.teamName)}${p.rank ? ` &middot; #${p.rank}` : ''}${p.bye === week ? ' &middot; bye this week' : p.bye === week + 1 ? ' &middot; bye next week' : ''}</div><span data-chip="${p.id}" data-st="${p.status || 'ACTIVE'}">${chip(p)}</span>${extra}</div></div>`; };
// points he has this week once his game starts: "7.0 pts final" / "4.2 pts so far, Q3 4:12"
// (data-live / data-pro: the page swaps in live points from the Worker every 30s, so it's there, empty, before kickoff too)
const nowPts = p => { const g = gameNow[TEAM(p.team)]; return p.bye === week || !g ? '' : `<div class="nowpts" data-live="${p.id}" data-pro="${p.proTeamId}"${g.state === 'pre' && !p.now ? ' hidden>'
  : `><b>${n(p.now ?? 0)} pts</b> ${g.state === 'post' ? 'final' : `so far &middot; ${esc(g.text)}`}`}</div>`; };
// a tappable player name in running text
const lnk = p => { shown.set(p.id, p); return `<span data-pid="${p.id}" class="lnk">${esc(p.name)}</span>`; };
// Top starter / starter / below starter: compared with what the league's starters at that position score. "Starter" = would
// start on a typical team here (16 teams x starting spots, FLEX split across RB/WR/TE); "top starter" = top third of those.
const tierPool = [...teams.flatMap(t => t.roster), ...allFa];
const startersAt = pos => teams.length * ((slotCounts[FA_SLOT[pos]] ?? 1) + (['RB', 'WR', 'TE'].includes(pos) ? (slotCounts[23] ?? 0) / 3 : 0));
// his season rank with what it means here: about k players at his position start across this league each week
// ("#9 of 12 starting kickers", or "#20 kicker, only the top 12 start")
const rankWhy = p => { const k = Math.round(startersAt(p.pos)), w = POS_NAME[p.pos]?.toLowerCase(); return p.rank <= k ? 'of ' + k + ' starting ' + (p.pos === 'D/ST' ? 'defenses' : w + 's') : w + ', only the top ' + k + ' start'; };
const rankText = p => !p.rank ? '' : '#' + p.rank + ' ' + rankWhy(p);
// how often he connects this season, from the weekly stat lines: a kicker's field goals and extra points made of tried,
// a pass catcher's catches of his targets, each next to what everyone at his position does. [card text, sheet text]
const pctOf = (a, b) => Math.round(a / b * 100) + '%';
const hitAll = { K: [0, 0] };
for (const wd of Object.values(rosSaved.kd ?? {})) for (const w of Object.values(wd)) if (w[0] === 'K') { hitAll.K[0] += w[4]; hitAll.K[1] += w[3]; }
for (const wd of Object.values(rosSaved.weeks ?? {})) for (const w of Object.values(wd)) { const h = hitAll[w[11]] ??= [0, 0]; h[0] += w[7]; h[1] += w[3]; }
const hitLine = p => {
  const k = pkey(p.name, p.pos, p.team), all = hitAll[p.pos];
  if (p.pos === 'K') {
    const g = Object.values(rosSaved.kd ?? {}).map(x => x[k]).filter(Boolean), s = i => g.reduce((t, w) => t + w[i], 0), [fga, fgm, long, xpa, xpm] = [3, 4, 5, 6, 7].map(s);
    if (!fga) return null;
    return [`FG ${fgm}/${fga} (${pctOf(fgm, fga)})`, `Field goals: made ${fgm} of ${fga} (${pctOf(fgm, fga)}${all[1] ? `; kickers this season make ${pctOf(...all)}` : ''})${long ? `, ${long} from 50+ yards` : ''}. Extra points: ${xpm} of ${xpa}.`];
  }
  if (!['RB', 'WR', 'TE'].includes(p.pos)) return null;
  const g = Object.values(rosSaved.weeks ?? {}).map(x => x[k]).filter(Boolean), tgt = g.reduce((t, w) => t + w[3], 0), rec = g.reduce((t, w) => t + w[7], 0);
  if (tgt < 5) return null;
  return [`Caught ${rec}/${tgt} (${pctOf(rec, tgt)})`, `Caught ${rec} of the ${tgt} passes thrown to him (${pctOf(rec, tgt)}${all?.[1] ? `; the average ${POS_NAME[p.pos].toLowerCase()} catches ${pctOf(...all)}` : ''}). Deep threats run lower.`];
};
const tierCut = {};
for (const kind of ['week', 'season']) for (const pos of Object.keys(FA_SLOT)) {
  const vals = tierPool.filter(p => p.pos === pos).map(kind === 'week' ? weekValue : seasonValue).sort((a, b) => b - a), k = startersAt(pos);
  tierCut[`${kind}|${pos}`] = [vals[Math.max(0, Math.floor(k / 3) - 1)] ?? Infinity, vals[Math.max(0, Math.floor(k) - 1)] ?? 0];
}
const tier = (v, p, kind) => { const c = p && tierCut[`${kind}|${p.pos}`]; return !c || !(v > 0) ? null : v >= c[0] ? ['good', 'top starter'] : v >= c[1] ? ['avg', 'starter'] : ['weak', 'below starter']; };
// data-big: what the page needs to redo this week's number when the live feed brings a new ESPN projection or injury
// status (the same average of ESPN, Rotowire and CBS, times wind, times his chance to play). Not for bye weeks or games underway.
const liveBig = p => (p.bye === week || locked(p) || p.slot === 'IR' ? ''
  : ` data-big="${p.id}" data-st="${p.status || 'ACTIVE'}" data-espn="${p.espn ?? ''}" data-roto="${p.roto ?? ''}" data-cbs="${p.cbs ?? ''}" data-wind="${p.wind ?? 1}" data-odds="${playOdds(p, p.inj?.type)?.pct ?? 100}" data-v="${n(weekValue(p))}"${me.roster.includes(p) ? ` data-mine${p.slot !== 'Bench' ? ' data-start' : ''}` : ''}`);
// once his game starts: points so far + his number for the part of the game left (ESPN's clock text: "6:50 - 3rd",
// "Halftime", "End of 3rd", "Final"). null = can't tell, keep his number. The page redoes it every 30s (runFinal there).
const gameLeft = t => !t ? null : /final/i.test(t) ? 0 : /half/i.test(t) ? 0.5 : /OT/.test(t) ? 0
  : (q => q ? Math.max(0, (4 - q) * 15 + +((t.match(/([0-9]+):[0-9]+/) || [])[1] || 0)) / 60 : null)(+((t.match(/([1-4])(st|nd|rd|th)/) || [])[1] || 0));
const runFinal = (p, v) => { const g = gameNow[TEAM(p.team)], left = g && g.state !== 'pre' ? (g.state === 'post' ? 0 : gameLeft(g.text)) : null; return left == null ? v : (p.now ?? 0) + v * left; };
const big = (v, label, ceiling, p, kind) => { const run = kind === 'week' && p && locked(p) && p.slot !== 'IR' && p.bye !== week;
  const shown = run ? runFinal(p, v) : v, t = tier(v, p, kind); return `<div class="big"${kind === 'week' && p?.id ? ` data-why="${p.id}"` : ''}><b${t ? ` class="t-${t[0]}"` : ''}${kind === 'week' && p ? liveBig(p) : ''}${run ? ` data-run="${p.id}" data-pro="${p.proTeamId}" data-v="${v}"` : ''}>${n(shown)}</b>${t ? `<small class="tw t-${t[0]}">${t[1]}</small>` : ''}<small>${label}</small>${ceiling > v + 1 ? `<small class="up">up to ${Math.round(ceiling)}</small>` : ''}</div>`; };

// Playoff seeding, ESPN's way: with divisions, each division winner takes a top seed; the rest go by record.
// Ties: total points (ESPN's default tiebreak). A tie game counts as half a win.
// ponytail: a league set to break ties head-to-head is still seeded by points here.
const divIds = [...new Set(teams.map(t => t.div))];
const seedOrder = (w, pf) => {
  const by = (a, b) => w.get(b.id) - w.get(a.id) || pf.get(b.id) - pf.get(a.id);
  const winners = divIds.length > 1 ? divIds.map(d => teams.filter(t => t.div === d).sort(by)[0]).sort(by) : [];
  return { order: [...winners, ...teams.filter(t => !winners.includes(t)).sort(by)], winners };
};
const seeded = seedOrder(new Map(teams.map(t => [t.id, t.w + t.ties / 2])), new Map(teams.map(t => [t.id, t.pf])));
const standings = seeded.order, myRank = standings.indexOf(me) + 1;
// wins needed = the last playoff team that got in on record (not a division winner)
const cutWins = standings.slice(0, playoffTeams).filter(t => !seeded.winners.includes(t)).at(-1)?.w ?? standings[playoffTeams - 1]?.w ?? 0;
const playoffLine = myRank <= playoffTeams ? `You're in a playoff spot. Top ${playoffTeams} make it.`
  : `Top ${playoffTeams} make the playoffs. ${cutWins - me.w <= 0 ? 'You have as many wins as the last playoff team, so it comes down to points.' : `You're ${cutWins - me.w} win${cutWins - me.w > 1 ? 's' : ''} behind.`}`;
const myProj = lineupProj(me);
const oppProj = opp ? lineupProj(opp) : 0;
// Win chance from the averaged projections. Each starter's score is treated as a bell curve around his
// projection; how wide depends on his position (4for4's weekly swings: QBs steadiest, TEs and defenses wildest).
// Once games start, ESPN's live estimate takes over.
// ponytail: players treated as independent (a QB and his receiver rise and fall together); ESPN's live number covers game time.
const SWING = { QB: 0.41, RB: 0.63, WR: 0.61, TE: 0.7, K: 0.49, 'D/ST': 0.71 };
const vari = (ps, v) => ps.reduce((s, p) => s + ((SWING[p.pos] ?? 0.65) * v(p)) ** 2, 0);
const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); return Math.sign(x) * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const spread = t => vari(weekLine(t), weekValue);
const isLive = !!opp && (mySide.totalPointsLive > 0 || oppSide.totalPointsLive > 0);
// The guess from just before the first points, kept all week so the live score can be compared with it
if (opp && !isLive) memo.pre = { [week]: [+myProj.toFixed(1), +oppProj.toFixed(1)] };
// (a week that went live before this was added: the expert projections, which don't move during games)
const pre = memo.pre?.[week] ?? (opp ? [myProj, oppProj] : null);
const liveWin = isLive && mySide.winProbability != null;
const winPct = !opp ? 0 : liveWin ? Math.round(mySide.winProbability * 100)
  : Math.round(50 * (1 + erf((myProj - oppProj) / Math.sqrt(2 * (spread(me) + spread(opp) || 1)))));
// --- Playoff odds: play out the rest of the regular season 10,000 times. Each team's weekly score is a bell curve
// around its projected lineup (this week: lineup as set, or ESPN's live projection once games start; later weeks:
// best rest-of-season lineup), spread like the win chance. Seeding is wins, then total points (league rule).
// Fixed random seed per week, so the number doesn't jitter between updates.
// ponytail: rosters frozen as they are now (no future pickups or trades); weeks independent.
let seed = week * 7919;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
// --- Whole league this week: everyone's expected final score (lineups as set; ESPN's live projection once games
// start), where you rank, who's below you, and the chance you're the lowest score. Same bell curves as the win chance.
// ponytail: during games only players who haven't kicked off add spread; ESPN's live projection covers the rest.
const sideOf = t => (league.schedule ?? []).filter(g => g.matchupPeriodId === week).map(g => (g.home?.teamId === t.id ? g.home : g.away?.teamId === t.id ? g.away : null)).find(Boolean);
const board = teams.map(t => {
  const side = sideOf(t), live = isLive && side?.totalProjectedPointsLive != null;
  const open = weekLine(t).filter(p => !(live && locked(p)));
  return { t, proj: live ? side.totalProjectedPointsLive : lineupProj(t), now: isLive ? side?.totalPointsLive ?? null : null, sd: Math.sqrt(vari(open, weekValue)) || 1 };
}).sort((a, b) => b.proj - a.proj);
let lowestRuns = 0;
for (let i = 0; i < 10000; i++) {
  let mine = 0, low = Infinity;
  for (const r of board) { const v = r.proj + r.sd * gauss(); if (r.t === me) mine = v; else low = Math.min(low, v); }
  if (mine < low) lowestRuns++;
}
const lowestPct = Math.round(lowestRuns / 100), myBoardRank = board.findIndex(r => r.t === me) + 1, below = board.slice(myBoardRank);
// Later weeks: each team's best lineup for that week, so bye weeks count (a team with three starters off in
// week 10 really is weaker that week). ESPN's projection for that week, else rest-of-season per game.
const futLine = new Map();
for (const t of teams) for (let w = week + 1; w <= lastWeek; w++) {
  const v = p => (p.bye === w || !seasonValue(p) ? 0 : rosSaved.future.by[p.id]?.[w - week - 1] ?? seasonValue(p));
  const ps = bestLineup(t.roster, v).lineup.map(x => x.player);
  futLine.set(`${t.id}|${w}`, { mean: ps.reduce((s, p) => s + v(p), 0), sd: Math.sqrt(vari(ps, v)) || 15 });
}
const nowMean = new Map(teams.map(t => [t.id, lineupProj(t)])), nowSd = new Map(teams.map(t => [t.id, Math.sqrt(spread(t)) || 15]));
const byId_ = new Map(teams.map(t => [t.id, t]));
const left = (league.schedule ?? []).filter(g => g.away && g.matchupPeriodId >= week && g.matchupPeriodId <= lastWeek);
// Every team's expected score in each game left, and one set of random swings reused by every run below, so a move's
// effect on the playoff chance is the move, not luck (the same 10,000 seasons, only my scores changed).
const SIMS = 10000;
const sideMean = left.map(g => [g.home, g.away].map(side => g.matchupPeriodId === week
  ? [isLive && side.totalProjectedPointsLive > 0 ? side.totalProjectedPointsLive : nowMean.get(side.teamId), nowSd.get(side.teamId)]
  : (f => [f.mean, f.sd])(futLine.get(`${side.teamId}|${g.matchupPeriodId}`))));
const noise = Float32Array.from({ length: SIMS * left.length * 2 }, gauss);
// myAdd[i] = points added to my lineup in week (this week + i). Returns the chance, the seasons by my final wins, and
// for each of my games left how often I got in after winning vs losing it.
function simSeasons(myAdd = [], runs = SIMS) {
  const byRecord = {}, swing = {}, byTeam = new Map(teams.map(t => [t.id, [0, 0, 0]]));
  const byes = playoffTeams > 1 ? 2 ** Math.ceil(Math.log2(playoffTeams)) - playoffTeams : 0;
  let made = 0, z = 0;
  for (let k = 0; k < runs; k++) {
    const w = new Map(teams.map(t => [t.id, t.w + t.ties / 2])), pf = new Map(teams.map(t => [t.id, t.pf])), mine = [];
    left.forEach((g, gi) => {
      const [a, b] = [g.home, g.away].map((side, j) => { const [m, sd] = sideMean[gi][j]; return m + noise[z++] * sd + (side.teamId === me.id ? myAdd[g.matchupPeriodId - week] ?? 0 : 0); });
      pf.set(g.home.teamId, pf.get(g.home.teamId) + a); pf.set(g.away.teamId, pf.get(g.away.teamId) + b);
      const winner = a >= b ? g.home.teamId : g.away.teamId;
      w.set(winner, w.get(winner) + 1);
      if (g.home.teamId === me.id || g.away.teamId === me.id) mine.push([g.matchupPeriodId, winner === me.id]);
    });
    const order = seedOrder(w, pf).order, inP = order.indexOf(me) < playoffTeams;
    order.slice(0, playoffTeams).forEach(t => { byTeam.get(t.id)[0]++; });
    for (const [id, x] of w) byTeam.get(id)[1] += x;
    order.slice(0, byes).forEach(t => { byTeam.get(t.id)[2]++; });
    made += inP;
    const r = (byRecord[w.get(me.id)] ??= [0, 0]); r[0] += inP; r[1]++;
    for (const [wk, won] of mine) { const x = (swing[wk] ??= [0, 0, 0, 0]); x[won ? 0 : 2] += inP; x[won ? 1 : 3]++; }
  }
  return { pct: made / runs * 100, byRecord, swing, byTeam };
}
const simBase = simSeasons(), byRecord = simBase.byRecord;
const playoffPct = Math.round(simBase.pct);
// my biggest games: how much winning vs losing that week moves the chance (shown when 10+ points apart)
const mustWin = Object.entries(simBase.swing).map(([wk, [wm, wc, lm, lc]]) => ({ wk: +wk, win: Math.round(wm / Math.max(1, wc) * 100), lose: Math.round(lm / Math.max(1, lc) * 100),
  opp: teams.find(t => t !== me && left.some(g => g.matchupPeriodId === +wk && [g.home.teamId, g.away.teamId].includes(me.id) && [g.home.teamId, g.away.teamId].includes(t.id))) }))
  .filter(x => x.win - x.lose >= 10).sort((a, b) => b.win - b.lose - (a.win - a.lose)).slice(0, 2).sort((a, b) => a.wk - b.wk);
// a move's change to my playoff chance (weeks = its gain each week, this week first); '' under 1 point.
// The first 2,000 of the same seasons: with the same swings on both sides that's within a point, and fast enough for every trade.
const oddsMemo = new Map(), MOVE_RUNS = 2000;
let moveBase;
const oddsText = weeks => {
  if (!weeks || week > lastWeek || !playoffTeams || weeks.every(x => Math.abs(x) < 0.05)) return '';
  moveBase ??= simSeasons([], MOVE_RUNS).pct;
  const key = weeks.map(x => x.toFixed(1)).join(), d = oddsMemo.get(key) ?? Math.round(simSeasons(weeks, MOVE_RUNS).pct - moveBase);
  oddsMemo.set(key, d);
  return Math.abs(d) < 1 ? '' : ` · ${d > 0 ? '+' : ''}${d}% playoff chance`;
};
// Stats that wrap between each other, never mid-phrase
const statSpans = t => t.split(' · ').map(x => `<span>${x}</span>`).join(' · ');
const recordOdds = Object.entries(byRecord).filter(([, [, c]]) => c >= SIMS * 0.05).map(([wins, [m, c]]) => [+wins, Math.round(m / c * 100)]).sort((a, b) => b[0] - a[0]);
const fixedProj = best.total;
// projected score after pending claims and the to-do list (best lineup from that roster)
const planProj = weekScore(baseRoster) + weekPlanGain;
const bySlot = roster => [...roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
const lineupRows = bySlot(me.roster);
// one roster row, the same on My team and on every other team's page
const lineRow = p => `<div class="card row"><span class="slot">${p.slot === 'Bench' || p.slot === 'IR' ? '' : p.slot}</span>${player(p, nowPts(p))}${big(weekValue(p), 'this week', weekValue(p) > 0 ? p.ceiling : null, p, 'week')}</div>`;
// the matchup line under the scores: 'final' = all games over, 'decided' = ESPN gives 0% or 100%
const verdictText = (win, by, how) => how === 'final' ? `<b style="color:var(--${win ? 'good' : 'bad'})">You ${win ? 'won' : 'lost'}</b> by ${by} points. Final.`
  : how === 'decided' ? `<b style="color:var(--${win ? 'good' : 'bad'})">${win ? 'Locked up' : 'Out of reach'}:</b> you'll ${win ? 'win' : 'lose'} by about ${by} points. ESPN gives ${win ? 'them' : 'you'} no chance with the games left.`
  : how === 'guess' ? `Final guess: you ${win ? 'win' : 'lose'} by ${by} points.`
  : `<b style="color:var(--${win ? 'good' : 'bad'})">You're expected to ${win ? 'win' : 'lose'}</b> by ${by} points.`;
const levelName = { urgent: 'Do now', week: 'This week', later: 'Plan ahead' };

// Plain status words, shared by the "what changed" snapshot and the Claude facts
const statusWords = p => p.inj?.season ? 'out for the season' : p.bye === week ? 'on bye this week' : (STATUS[p.status] ? STATUS[p.status][0][0].toLowerCase() + STATUS[p.status][0].slice(1) : 'healthy');
// Snapshot of my roster; the page compares it with what you last marked as seen (kept in your browser)
const snap = Object.fromEntries(me.roster.map(p => [p.id, { n: p.name, s: statusWords(p), slot: p.slot === 'Bench' ? 'bench' : p.slot === 'IR' ? 'IR' : 'starting', pr: Math.round((p.proj ?? 0) * 10) / 10 }]));

// Everything Claude needs to answer questions about this team, as plain text to paste
const line = p => `${p.name} (${p.pos}, ${p.teamName}, bye wk ${p.bye ?? '?'}): expected ${n(weekValue(p))} this week${p.roto != null || p.cbs != null ? ` (${srcText(p)})` : ''}${p.vegas ? `, Vegas expects his team to score ${n(p.vegas)}` : ''}, ${n(p.avg)} per game so far, ${n(p.ros)} per game expected rest of season, ${statusWords(p)}${playOdds(p, p.inj?.type) ? ` (${playOdds(p, p.inj?.type).pct}% chance he plays. ${playOdds(p, p.inj?.type).why})` : ''}${p.rank ? `, ${rankText(p)}` : ''}${depthWord(p) ? `, ${depthWord(p)} on his NFL team's depth chart` : ''}${recentPts(pkey(p.name, p.pos, p.team)).length ? `, last games ${recentPts(pkey(p.name, p.pos, p.team)).map(n).join(', ')} (newest first)` : ''}${hitLine(p) ? `. ${hitLine(p)[1]}` : ''}${notes(p).length ? `. Notes: ${notes(p).join(' ')}` : ''}`;
// the same, shorter, for every other player in the league (other rosters, free agents)
const cline = p => `${p.name} (${p.pos}, ${p.teamName}${p.slot ? `, ${p.slot === 'Bench' ? 'bench' : p.slot}` : ''}): ${n(weekValue(p))} expected this week, ${n(p.avg)}/g so far, ${n(p.ros)}/g rest of season${p.rank ? `, ${rankText(p)}` : ''}${recentPts(pkey(p.name, p.pos, p.team)).length ? `, last games ${recentPts(pkey(p.name, p.pos, p.team)).map(n).join(', ')}` : ''}${hitLine(p) ? `, ${hitLine(p)[0]}` : ''}, ${statusWords(p)}${p.bye ? `, bye wk ${p.bye}` : ''}`;
const teamOf = id => teams.find(t => t.id === id)?.name ?? 'free agency';
const nameOf = id => byId.get(id)?.name ?? `player #${id}`;
const facts = [
  `My ESPN fantasy football league "${league.settings.name}": ${teams.length} teams, half-point PPR, lineup = ${Object.entries(slotCounts).filter(([id, k]) => k > 0 && SLOT_POS[id]).map(([id, k]) => `${k} ${SLOT[id]}`).join(', ')}, ${slotCounts[20]} bench, ${slotCounts[21] ?? 0} IR. Top ${playoffTeams} make the playoffs. It's week ${week}. "Expected" points average ESPN's, Rotowire's and CBS Sports' projections. Facts from ESPN, Sleeper (Rotowire), CBS Sports and DraftKings betting lines as of ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET.`,
  `My team: ${me.name}${mgrName(me) ? ` (manager ${mgrName(me)}, that's me)` : ''}, ${me.w}-${me.l}, ${ordinal(myRank)} of ${teams.length}, ${ordinal(pfRank)} in points scored. I pick ${ordinal(me.waiver)} on waivers.`,
  `Every team in the league, in standings order (manager's name in brackets), with points a week and the last 3 weeks' scores:\n${standings.map((t, i) => `- ${ordinal(i + 1)}: ${t.name}${mgrName(t) ? ` (${mgrName(t)})` : ''}, ${t.w}-${t.l}, ${Math.round(t.pf / gamesPlayed)} a week (league average ${Math.round(leagueAvg)}), last 3: ${Object.keys(weekly).map(Number).sort((a, b) => b - a).slice(0, 3).map(w => n(weekly[w][t.id] ?? 0)).join(', ')}`).join('\n')}`,
  opp ? `This week vs ${opp.name} (${opp.w}-${opp.l}): projected ${n(myProj)} to ${n(oppProj)}, win chance ${winPct}%${liveWin ? ' (ESPN live estimate)' : ''}.` : '',
  `${week > lastWeek ? '' : `Playoff chance: ${playoffPct}% (top ${playoffTeams} of ${teams.length}, simulated).${mustWin.map(x => ` Week ${x.wk}${x.opp ? ` vs ${x.opp.name}` : ''}: win and it's ${x.win}%, lose and it's ${x.lose}%.`).join('')}`}${recap ? ` Last week (wk ${recap.wk}) I scored ${n(recap.got)}${recap.opp != null ? ` vs ${n(recap.opp)}` : ''}; best possible lineup was ${n(recap.best)}.` : ''}`,
  `Starters:\n${starters(me).map(p => `- ${p.slot}: ${line(p)}`).join('\n')}`,
  `Bench:\n${me.roster.filter(p => p.slot === 'Bench').map(p => `- ${line(p)}`).join('\n')}`,
  me.roster.some(p => p.slot === 'IR') ? `IR:\n${me.roster.filter(p => p.slot === 'IR').map(p => `- ${line(p)}`).join('\n')}` : '',
  pending.length ? `Pending moves:\n${pending.map(m => m.kind === 'waiver' ? `- Waiver claim: add ${m.add.map(p => p.name).join(', ')}, drop ${m.drop.map(p => p.name).join(', ')}`
    : `- Trade ${m.mineOffer ? 'I offered' : 'offered to me by'} ${m.them.name}: I give ${m.give.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}; I get ${m.take.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}`).join('\n')}` : '',
  `Best free agents (points per game expected rest of season, expected this week):\n${Object.entries(fa).map(([pos, list]) => `- ${pos}: ${[...list].filter(p => !HURT.includes(p.status)).sort((a, b) => rate(b) - rate(a)).slice(0, 8).map(p => `${p.name} ${n(rate(p))}/g ahead, ${n(p.proj)} exp`).join('; ')}`).join('\n')}`,
  `This week's matchups (projected${isLive ? ', and live score' : ''}):\n${(league.schedule ?? []).filter(g => g.matchupPeriodId === week && g.away).map(g => [g.home.teamId, g.away.teamId].map(id => { const b = board.find(r => r.t.id === id); return `${teamOf(id)} ${b ? n(b.proj) : '?'}${b?.now != null ? ` (now ${n(b.now)})` : ''}`; }).join(' vs ')).map(x => `- ${x}`).join('\n')}`,
  `Every result so far:\n${Object.keys(weekly).map(Number).sort((a, b) => a - b).map(wk => `- Wk ${wk}: ${(league.schedule ?? []).filter(g => g.matchupPeriodId === wk && g.away).map(g => `${teamOf(g.home.teamId)} ${n(g.home.totalPoints)}-${n(g.away.totalPoints)} ${teamOf(g.away.teamId)}`).join('; ')}`).join('\n')}`,
  moves.length ? `Recent league moves (last 3 weeks):\n${[...moves].sort((a, b) => b.date - a.date).slice(0, 60).map(m => `- ${new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${m.type === 'ADD' ? `${teamOf(m.team)} added ${nameOf(m.playerId)}` : m.type === 'DROP' ? `${teamOf(m.team)} dropped ${nameOf(m.playerId)}` : `${teamOf(m.team)} got ${nameOf(m.playerId)} from ${teamOf(m.from)} in a trade`}`).join('\n')}` : '',
  ...standings.filter(t => t !== me).map(t => `Roster of ${t.name}${mgrName(t) ? ` (${mgrName(t)})` : ''}, ${t.w}-${t.l}:\n${[...t.roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)).map(p => `- ${cline(p)}`).join('\n')}`),
  ahead.length ? `My remaining schedule: ${ahead.map(g => `wk ${g.week} ${g.t.name} (${g.t.w}-${g.t.l}, projected ${n(g.proj)} that week${g.off.length ? `, without ${g.off.map(p => p.name).join(', ')}` : ''})`).join('; ')}.` : '',
  '__NEWSFACTS__',
  'Explain things simply, I\'m new to football. My question:',
].filter(Boolean).join('\n\n');

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Gameday"><meta name="description" content="Fantasy football lineup, trade and waiver advice."><meta property="og:title" content="Gameday"><meta property="og:description" content="Fantasy football lineup, trade and waiver advice."><meta property="og:image" content="https://mrbrofo.github.io/Fantasy-app/icon-512.png"><meta name="theme-color" content="#0b0d10"><meta name="color-scheme" content="dark">
<meta name="built" content="${Date.now()}"><meta name="code" content="${CODE}">
<link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="manifest" href="manifest.json">
<title>Gameday</title>
<script>try { const l = localStorage.getItem('look'); if (l !== 'classic') document.documentElement.classList.add(l === 'term' ? 'term' : 'glass'); } catch { document.documentElement.classList.add('glass'); }</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<canvas id="bg-field" aria-hidden="true"></canvas><div class="bgring" id="bg-ring1"></div><div class="bgring r2" id="bg-ring2"></div>

<header><div class="wrap">
  <div class="top"><div class="league">${esc(league.settings.name)} &middot; Week ${week} &middot; <span id="ago">just updated</span></div>
  <button id="refresh" type="button"><span>&#8635;</span> Refresh</button></div>
  <h1>${esc(me.name)}</h1>
  <div class="record">${me.w}-${me.l} record &middot; ${ordinal(myRank)} of ${teams.length}</div>
</div></header>

<div class="wrap" role="main">
<div id="lv-tx"></div>
${opp ? (() => {
  // Once games start, ESPN's live numbers replace the pre-game projection
  const live = isLive;
  const [a, b] = live ? [mySide.totalProjectedPointsLive, oppSide.totalProjectedPointsLive] : [myProj, oppProj];
  const wp = winPct;
  // all NFL games this week over: the score is the real result
  const done = live && Object.values(gameNow).length && Object.values(gameNow).every(g => g.state === 'post');
  // lv-*: the parts the page updates with live scores from the Worker
  return `<div class="match"><h2>This week vs ${esc(opp.name)}<span class="live" id="lv-badge"${live ? '' : ' hidden'}>LIVE</span></h2>
  <div class="m1"><div class="wp"><b id="lv-wp" style="color:${wp >= 60 ? 'var(--good)' : wp < 40 ? 'var(--bad)' : 'var(--warn)'}">${wp}%</b><span>chance you win <span class="tag" id="lv-wpsrc">(${liveWin ? 'ESPN live estimate' : 'from the averaged projections'})</span></span></div>
  <div class="tag" id="lv-score" style="margin-bottom:8px"${live ? '' : ' hidden'}>${done ? 'Final score' : 'Score right now'}: <b>${n(mySide.totalPointsLive ?? 0)}</b> to <b>${n(oppSide.totalPointsLive ?? 0)}</b>.${done ? '' : ' Final guess below.'}</div>
  ${live && pre ? `<div class="tag" style="margin:-4px 0 8px">Guess before games started: <b>${n(pre[0])}</b> to <b>${n(pre[1])}</b>.</div>` : ''}
  </div><div class="m2"><div class="vs">
  <div class="t" data-tm="${me.id}">You</div><div class="p" id="lv-a" data-tm="${me.id}" data-base="${n(a)}">${n(a)}</div><div class="bar" data-tm="${me.id}"><i id="lv-abar" style="width:${Math.min(100, a / Math.max(a, b, 1) * 100)}%;background:var(--accent)"></i></div>
  <div class="t" data-tm="${opp.id}">${esc(opp.name)}</div><div class="p" id="lv-b" data-tm="${opp.id}">${n(b)}</div><div class="bar" data-tm="${opp.id}"><i id="lv-bbar" style="width:${Math.min(100, b / Math.max(a, b, 1) * 100)}%;background:var(--muted)"></i></div>
</div></div><div class="m3"><div class="verdict" id="lv-verdict" aria-live="polite">${(() => {
  // 0% or 100% from ESPN: decided, just not official yet
  const [x, y] = done ? [mySide.totalPointsLive ?? 0, oppSide.totalPointsLive ?? 0] : [a, b], by = n(Math.abs(Math.round(x * 10) - Math.round(y * 10)) / 10);
  return verdictText(x >= y, by, done ? 'final' : live && (wp <= 0 || wp >= 100) ? 'decided' : live ? 'guess' : '');
})()}
${!live && planProj > myProj + 0.5 ? ` ${claims.length ? (plan.length ? 'Your pending claims plus the to-do list get' : 'Your pending claims get') : 'Doing the to-do list below gets'} you to about <b>${n(planProj)}</b>.` : ''}</div>
<div class="tag" style="margin-top:6px">${esc(playoffLine)}</div></div>
<details class="board" style="margin-top:10px"><summary><b>Whole league this week:</b> you're ${ordinal(myBoardRank)} of ${board.length}, ${below.length} team${below.length === 1 ? '' : 's'} below you. <b style="color:${lowestPct >= 15 ? 'var(--bad)' : lowestPct >= 5 ? 'var(--warn)' : 'var(--good)'}">${lowestPct < 1 ? 'Under 1' : lowestPct}% chance</b> you're the lowest score.</summary>
<table class="cmp" style="margin-top:8px"><tr class="bh"><td></td><td></td>${isLive ? '<td class="num">Now</td>' : ''}<td class="num">Expected</td></tr>${board.map((r, i) => `<tr data-team="${r.t.id}"${r.t === me ? ' style="font-weight:700"' : ''}><td class="num" style="text-align:left">${i + 1}</td><td>${esc(r.t === me ? 'You' : r.t.name)}</td>${isLive ? `<td class="num" data-now>${n(r.now)}</td>` : ''}<td class="num" data-proj>${n(r.proj)}</td></tr>`).reverse().join('')}</table>
<p class="tag" style="margin:6px 0 0">${below.length ? `Below you: ${esc(below.map(r => r.t.name).join(', '))}.` : 'Nobody is projected below you.'}</p></details></div>`;
})() : ''}
<div id="stale" class="card" hidden style="background:var(--badbg);border-color:var(--bad)"><b style="color:var(--bad)">&#9888; This page stopped updating</b><div class="tag" id="staletext"></div></div>
${down.length ? `<div class="card" style="background:var(--warnbg);border-color:var(--warn)"><b style="color:var(--warn)">&#9888; ${esc(down.join(' and '))} didn't load this time.</b>
<div class="tag">${down.includes('Vegas lines') && down.length === 1 ? 'Player notes won\'t say how many points the betting odds expect his team to score.' : '"Expected" points use only the sources that worked, so they\'re a bit less reliable.'} It usually fixes itself on a later update. If this stays for a day, ask Claude to check it.</div></div>` : ''}

<a id="fab" href="https://fantasy.espn.com/football/league?leagueId=${LEAGUE_ID}&amp;seasonId=${SEASON}" aria-label="Open the ESPN Fantasy app"><img src="https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/1c/b2/68/1cb2683b-9dce-d70c-8905-2562c0482eda/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/120x120bb.jpg" alt=""></a>
<nav aria-label="Main">${[['home', 'Home', '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>'], ['team', 'Team', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>'], ['moves', 'Moves', '<path d="M12 5v14M5 12h14"/>'], ['trades', 'Trades', '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'], ['more', 'More', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>']].map(([h, label, icon]) => {
  // PC sidebar lists every page; the phone bar hides these and uses the switch at the top of the tab
  const sub = { moves: [['pickups', 'Pickups'], ['pending', 'Pending']], trades: [['trades', 'Trade ideas'], ['compare', 'Compare']], more: [['season', 'Season'], ['league', 'League'], ['news', 'News'], ['help', 'How it works'], ['settings', 'Settings']] }[h];
  return `<a href="#${h}"${sub ? ' class="grp"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}${h === 'home' ? '<span class="dot" hidden></span>' : ''}</a>${(sub ?? []).map(([p, name]) => `<a href="#${p}" class="sub">${name}</a>`).join('')}`;
}).join('')}</nav>
<div id="seg" class="seg" hidden></div>

<section id="todo"><h2>Do this now <span class="dot" hidden></span></h2>
${adviceIssues.length ? `<div class="card" style="border-color:var(--warn)"><b style="color:var(--warn)">Advice check: ${adviceIssues.length} problem${adviceIssues.length > 1 ? 's' : ''} found</b><p class="why" style="margin:4px 0 0">Some advice may be off:</p><ul style="margin:6px 0 0;padding-left:18px">${adviceIssues.map(([where, text]) => `<li><b>${esc(where)}:</b> ${esc(text)}</li>`).join('')}</ul></div>` : ``}
${todo.length ? (() => { const card = ([lvl, title, why, move, who = []]) => `<div class="card todo" data-k="${esc(league.scoringPeriodId + '|' + title)}"><span class="lvl ${lvl}">${levelName[lvl]}</span><div><b>${esc(title)}</b>${who.length ? `<div class="tpics">${who.map(p => { shown.set(p.id, p); return `<span data-pid="${p.id}" role="button" tabindex="0" title="${esc(p.name)}">${pic(p)}</span>`; }).join('')}</div>` : ''}<p>${esc(why)}</p>${info(who)}${/^(Pickup step|Better backup)/.test(title) && who.length === 2 ? exBtns([who[1]], [who[0]]) : ''}${MOVE_URL && move ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...move, week: league.scoringPeriodId }))}">${esc(move.label)}</button>` : ''}</div></div>`;
  return todo.slice(0, 3).map(card).join('') + (todo.length > 3 ? `<details class="all"><summary>${todo.length - 3} more to do</summary>${todo.slice(3).map(card).join('')}</details>` : ''); })() : '<div class="card empty">You\'re all set this week.</div>'}
<button type="button" id="todo-back" class="todo-back" hidden></button>
</section>

<div id="hs"><section id="changes" hidden><h2>What changed</h2>
<div class="card"><div id="changelist"></div><button type="button" id="seen" class="btn">Got it</button></div></section>

<section id="ask"><div class="card ask"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>Ask Coach about your team</b><button type="button" id="askbal" class="linkbtn" style="font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums">Set credits</button></div>
<div style="position:relative;margin:10px 0 6px"><textarea id="askq" class="sel" rows="3" aria-label="Your question" placeholder="Should I trade Kelce for Bijan? Who should I pick up at RB?" style="display:block;width:100%;min-height:72px;resize:vertical;padding-right:36px;margin:0"></textarea><button type="button" id="askmic" class="askmic" aria-label="Talk to type"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div>
<div style="display:flex;gap:6px;margin-top:10px"><div class="seg" id="askmode" style="margin:0;flex:1"><button type="button" data-mode="auto">Auto</button><button type="button" data-mode="quick">Quick</button><button type="button" data-mode="smart">Smart</button></div><div class="seg" style="margin:0"><button type="button" id="askslow" style="padding:9px 12px">Half price</button></div></div>

<button type="button" id="askbtn" class="btn">Ask Coach</button><div id="askout" class="askout" hidden></div>
<button type="button" id="askhist" class="linkbtn" hidden></button><div id="askhistout" hidden></div>
<button type="button" id="askopen" class="linkbtn">Or open it in the Claude app</button></div></section>

</div>


<section id="news"><h2>News</h2>
<div class="list">__NEWS__</div></section>

<section id="lineup"><h2>My team</h2>
${slotSwap ? `<div class="card"><div class="group" style="margin:0 0 6px">Slot order</div><p class="why" style="margin:0">${lnk(slotSwap.early)} (${esc(kickText(slotSwap.early))}) to ${esc(slotSwap.early.pos)}, ${lnk(slotSwap.late)} (${esc(kickText(slotSwap.late))}) to FLEX.</p>
${MOVE_URL ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: 'Swap their slots on ESPN', type: 'ROSTER', week: league.scoringPeriodId, items: [{ type: 'LINEUP', playerId: slotSwap.early.id, from: SLOT_ID.FLEX, to: SLOT_ID[slotSwap.early.pos] }, { type: 'LINEUP', playerId: slotSwap.late.id, from: SLOT_ID[slotSwap.late.pos], to: SLOT_ID.FLEX }] }))}">Swap their slots on ESPN</button>` : ''}</div>` : ''}
${[['Starting', p => p.slot !== 'Bench' && p.slot !== 'IR'], ['Bench', p => p.slot === 'Bench'], ['Injured reserve', p => p.slot === 'IR']].map(([label, f]) => {
  const ps = lineupRows.filter(f);
  const rows = ps.map(lineRow).join('');
  // starters show; bench and injured reserve fold to one line
  return !ps.length ? '' : label === 'Starting' ? `<div class="group">${label}</div><div class="list">${rows}</div>` : `<details class="fold"><summary class="group">${label} (${ps.length})</summary><div class="list">${rows}</div></details>`;
}).join('')}
</section>

<section id="bench"><h2>Bench check</h2>
${benchCheck.length ? `<div class="list">${benchCheck.map(b => `<div class="card"><div class="vhead"><b>${lnk(b.p)}</b><span class="verdict-${b.keep ? 'good' : 'meh'}">${b.keep ? 'Keep' : 'Not needed'}</span></div>
  <p class="why" style="margin:0">${b.keep ? esc(b.keep) : [
    `He doesn't start in any of the next ${benchHorizon.length} weeks, and a free player could back up about as well.`,
    b.planned ? 'Your pickup plan already swaps him out.' : '',
    b.swap ? `<b>Waivers:</b> drop him for ${lnk(b.swap.add)} (${b.swap.add.pos}, ${n(rate(b.swap.add))} a game${b.swap.add.wa ? ', on waivers' : ''}): about +${n(b.swap.gain)} points over the next ${benchHorizon.length} weeks.` : '',
    b.trade ? `<b>Trade:</b> him for ${lnk(b.trade.take)} with ${esc(b.trade.team.name)}, +${n(b.trade.mine)} a week for you${b.trade.strict ? '' : ' (a closer call)'}.` : '',
    b.steal ? `<b>Trade:</b> ${b.steal.give.map(lnk).join(' + ')} for ${lnk(b.steal.take)} with ${esc(b.steal.d.t.name)}, +${n(b.steal.mine)} a week for you (they lose about ${n(-b.steal.theirs)}, so it may be a hard sell).` : '',
    !b.swap && !b.trade && !b.steal ? 'Nothing better on waivers or in trades. Keep him as depth.' : '',
  ].filter(Boolean).join(' ')}</p>${b.keep || !(b.swap || b.trade || b.steal) ? '' : `<div class="tools2">${b.swap ? cmpBtn(b.p, b.swap.add, `Compare with ${esc(b.swap.add.name)}`) : ''}${b.trade ? tcBtn([b.p], [b.trade.take], `Trade check: ${esc(b.trade.take.name)}`) : ''}${b.steal ? tcBtn(b.steal.give, [b.steal.take], `Trade check: ${esc(b.steal.take.name)}`) : ''}</div>`}</div>`).join('')}</div>` : '<div class="card empty">Nobody on your bench.</div>'}
</section>

<section id="pickups"><h2>Pickup plan</h2><p class="sub">Do these in order.</p>
<div class="card"><div class="vhead"><span class="group" style="margin:0">Waiver order</span><span class="verdict-meh">You pick ${ordinal(me.waiver)} of ${teams.length}</span></div>
<details class="all" style="margin:-4px 0 4px"><summary>See the full order</summary><div class="worder">${[...teams].sort((a, b) => a.waiver - b.waiver).map(t => `<span class="${t === me ? 'me' : t.waiver < me.waiver ? 'ahead' : ''}">${t.waiver}. ${esc(t.name)}</span>`).join('')}</div></details>
${nextRun ? `<p class="why" style="margin:0 0 6px"><b>Next waiver run: ${nextRun}.</b></p>` : ''}<p class="tag" style="margin-bottom:0">${me.waiver > 1 ? `${me.waiver - 1} team${me.waiver > 2 ? 's' : ''} pick before you.` : 'You pick first.'}</p></div>
${fillIns.length ? `<div class="group">Injury fill-ins: grab them first</div><p class="sub">A starter is out and his backup is free.</p><div class="list">${fillIns.map(f => `<div class="card"><div class="row">${freeCard(f.p, f.name, f.team, f.pos)}${f.gain >= 0.5 ? `<span class="verdict-good">+${n(f.gain)} a week for you</span>` : '<span class="verdict-meh">Keep from rivals</span>'}</div>
  <p class="why">${lnk(f.starter)} ${esc(f.word)}${f.long ? ' and will be out a while' : ''}, so ${esc(f.name)} is next up (${esc(f.owner.name)} has ${esc(f.starter.name)}). ${f.gain >= 0.5 ? `As the starter he'd add about ${n(f.gain)} a week to your lineup.` : 'He wouldn\'t start for you, but adding him keeps him from a rival who needs him.'}${f.p ? ` ${f.p.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}` : ' Search his name in the ESPN app to add him.'}${f.drop ? ` To make room: drop ${esc(f.drop.name)}.` : ''}</p>
  ${MOVE_URL && addMove(f.p, f.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...addMove(f.p, f.drop), week: league.scoringPeriodId }))}">${esc(addMove(f.p, f.drop).label)}</button>` : ''}</div>`).join('')}</div>` : ''}
${plan.length ? plan.map((s, i) => { const wk = s.kind === 'week'; return `<div class="card">
  <div class="group" style="margin:0 0 10px">Step ${i + 1} &middot; ${wk ? 'mostly this week' : 'long-term upgrade'}</div>
  <div class="row">${player(s.add)}${big(wk ? s.add.proj : rate(s.add), wk ? 'this week' : 'per game, rest of season', null, s.add, wk ? 'week' : 'season')}</div>
  <p class="why"><span class="gain">${statSpans(gainText(s.now, s.later) + oddsText(s.weeks))}</span>To make room, drop <b>${esc(s.drop.name)}</b> (${n(wk ? weekValue(s.drop) : rate(s.drop))} ${wk ? 'this week' : 'per game, rest of season'}).${wk ? ` He isn't a long-term keeper (${n(seasonValue(s.drop))} a game from here on; free players come close).` : ''}<br>
  <span class="tag">${s.add.wa ? 'On waivers: your claim goes through in about a day.' : 'Free agent: yours right away.'}</span>
  ${s.add.wa ? (() => { const r = rivalsFor(s.add, wk ? weekValue : seasonValue); return r.length
    ? `<br><span class="tag" style="color:var(--warn)">${r.length} team${r.length > 1 ? 's' : ''} that pick${r.length > 1 ? '' : 's'} before you could use him too: ${r.slice(0, 3).map(t => esc(t.name)).join(', ')}${r.length > 3 ? '&hellip;' : ''}.</span>`
    : '<br><span class="tag" style="color:var(--good)">No team that picks before you needs him, so you\'ll probably get him.</span>'; })() : ''}
  ${notes(s.add).map(t => `<br><span class="tag">&#9432; ${esc(t)}</span>`).join('')}
  ${s.alts.length ? `<br><span class="tag">If someone else gets him first, take ${s.alts.map(a => `<b>${esc(a.add.name)}</b> (${n(wk ? a.add.proj : rate(a.add))})`).join(' or ')} instead.</span>` : ''}</p>${info([s.add, s.drop])}
  ${MOVE_URL && !locked(s.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `${s.add.wa ? 'Claim' : 'Add'} ${s.add.name}, drop ${s.drop.name}`, type: s.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: s.add.id }, { type: 'DROP', playerId: s.drop.id }], week: league.scoringPeriodId }))}">${s.add.wa ? 'Claim' : 'Add'} ${esc(s.add.name)}, drop ${esc(s.drop.name)}</button>` : ''}</div>`; }).join('')
  : `<div class="card empty">Nobody out there would make your starting lineup better${claims.length ? ', counting your pending claims (see Pending)' : ''}.</div>`}
${benchUps.length ? `<details class="fold"><summary class="group">Better backups available (${benchUps.length})</summary><div class="list">${benchUps.map(x => `<div class="card"><div class="row">${player(x.add)}${big(rate(x.add), 'per game, rest of season', null, x.add, 'season')}</div>
  <p class="why">Instead of <b>${esc(x.drop.name)}</b> (${n(rate(x.drop))} per game). ${x.add.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}${esc(alsoText(x.alts, rate))}</p>${info([x.add, x.drop, ...x.alts])}
  ${exBtns([x.drop], [x.add])}
  ${MOVE_URL && !locked(x.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `Add ${x.add.name}, drop ${x.drop.name}`, type: x.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: x.add.id }, { type: 'DROP', playerId: x.drop.id }], week: league.scoringPeriodId }))}">Add ${esc(x.add.name)}, drop ${esc(x.drop.name)}</button>` : ''}</div>`).join('')}</div></details>` : ''}
${trending.length ? `<details class="fold"><summary class="group">Trending in other leagues (${Math.min(5, trending.length)})</summary><div class="list">${trending.slice(0, 5).map(p => `<div class="card"><div class="row">${player(p)}${p.proj != null ? big(weekValue(p), 'this week', weekValue(p) > 0 ? p.ceiling : null, p, 'week') : '<span class="tag">No projection for him this week</span>'}</div>${pickBtn(p)}</div>`).join('')}</div>
</details>` : ''}
${breakouts.length ? `<details class="fold"><summary class="group">Breakout watch: bigger role (${breakouts.length})</summary><div class="list">${breakouts.map(b => `<div class="card"><div class="row">${freeCard(b.p, b.name, b.team, b.pos)}${b.recent != null ? big(b.recent, 'per game, last 3', null, b.p ?? null, 'season') : ''}</div>
  <p class="why"><b>Why:</b> his team is using him a lot more. ${b.cause.length ? `${esc(b.cause.join(' and '))} ${b.cause.length > 1 ? 'are' : 'is'} out, so more of the work goes to him. ` : ''}In his last 3 games he was on the field for <b>${b.u.snapNow}%</b> of his team's plays (${b.u.snapBefore}% before that), and <b>${b.u.shareNow}%</b> of his team's ${b.u.kind === 'carries' ? 'runs went to him' : 'passes were thrown to him'} (${b.u.shareBefore}% before).</p>
  <p class="why"><b>When:</b> more playing time usually turns into more points this week or next. Most managers only notice once the big games show up, so right now he's easy to get.${b.p ? ` ${b.p.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}` : ' Search his name in the ESPN app to add him.'}</p>
  ${pickBtn(b.p)}</div>`).join('')}</div></details>` : ''}
${fills.length ? `<div class="group">Empty roster spots: ${fills.length}</div><div class="list">${fills.map(f => `<div class="card"><div class="row">${player(f.add)}${big(rate(f.add), 'per game, rest of season', null, f.add, 'season')}</div>
  <p class="why">No drop needed.${f.week >= 0.5 ? ` Adds about ${n(f.week)} points this week.` : ''}${esc(byeText(f))}${f.season >= 0.5 ? ` About ${n(f.season)} better per week after that.` : f.rest >= 1 ? ` As a backup, about ${Math.round(f.rest)} points over the next two weeks covering byes.` : ' A backup for injuries.'}</p>${info([f.add, ...f.byeFor, ...f.alts])}
  ${MOVE_URL && !locked(f.add) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...fillMove(f), week: league.scoringPeriodId }))}">${f.add.wa ? 'Put in a claim for him on ESPN' : 'Add him on ESPN'}</button>` : ''}</div>`).join('')}</div>` : ''}
</section>
<section id="pending"><h2>Your pending moves</h2>
${pending.length ? pending.map(m => {
  if (m.kind === 'waiver') {
    const { backup, worseBackup, kp, spare, stack, covers, ahead, worse, keeps, rental, v } = claimCheck(m);
    return `<div class="card"><div class="vhead"><span class="tag">Waiver claim</span><span class="verdict-${v[0]}">${esc(v[1])}</span></div>
    <div class="swap">${m.add.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}<div class="arrow">drop</div>${m.drop.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
    <p class="why">${stack ? `<b>You'd have ${spare.length + 1} ${kp === 'K' ? 'kickers' : 'defenses'} and only start ${slotCounts[FA_SLOT[kp]] || 1}. Drop ${esc(stack.name)} (${n(rate(stack))} a game) for ${esc(m.add[0].name)} and keep ${esc(m.drop.map(d => d.name).join(' and '))}.</b> ` : ''}<b>${(backup || worseBackup) && Math.abs(m.week) < 1 && Math.abs(m.season) < 1 ? `Neither starts for you now, but ${esc(m.add[0].name)} is a much ${backup ? 'better' : 'worse'} backup (${n(rate(m.add[0]))} vs ${n(rate(m.drop[0]))} a game) for bye weeks and injuries.` : ''}${(backup || worseBackup) && Math.abs(m.week) < 1 && Math.abs(m.season) < 1 ? '' : Math.abs(m.week) < 0.5 ? 'No change this week' : `${m.week > 0 ? 'Adds' : 'Costs'} about ${n(Math.abs(m.week))} points this week`}${Math.abs(m.season) < 0.5 ? (rental ? `, but ${esc(m.drop[0].name)} is the better player after that.` : ', about the same after that.') : `, and ${m.season > 0 ? 'adds' : 'costs'} about ${n(Math.abs(m.season))} a week after that.`}${Math.abs(m.nextGain) >= 0.5 ? ` Next week (week ${week + 1}): ${m.nextGain > 0 ? 'adds' : 'costs'} about ${n(Math.abs(m.nextGain))}.` : ''}</b>${nextRun ? ` It goes through ${nextRun}.` : ''}</p>
    ${rental ? `<p class="why">One-week rental: ${worse ? `${esc(m.drop[0].name)} is expected ${n(seasonValue(m.drop[0]))} a game from here on vs ${n(seasonValue(m.add[0]))} for ${esc(m.add[0].name)}` : 'it helps this week only'}${ahead <= -1 ? `, and your lineups the next 2 weeks get about ${n(-ahead)} points worse` : ''}. ${keeps.length ? `${esc(keeps[0].name)} is worth keeping long-term (free players at his spot are clearly worse), so cancel it.` : 'Fine for this week\'s points: a player like the one you drop is easy to find again.'}</p>` : ''}
    ${covers ? `<p class="why">${esc(m.byeFor.map(p => p.name).join(' and '))} ${m.byeFor.length > 1 ? 'are' : 'is'} on bye in week ${week + 1}; ${esc(m.add[0].name)} is expected ${n(m.nextPts)} that week (ESPN's projection).</p>` : ''}
    ${m.likelyLost ? `<p class="why" style="color:var(--warn)"><b>${esc(m.likelyLost.map(t => `${t.name} (${ordinal(t.waiver)})`).join(', '))} ${m.likelyLost.length > 1 ? 'pick' : 'picks'} before you (${ordinal(me.waiver)}) and also ${m.likelyLost.length > 1 ? 'need' : 'needs'} a ${POS_NAME[m.add[0].pos].toLowerCase()} in week ${week + 1}, so they'll likely take him first.</b>${m.backupFill ? '' : m.drop.some(d => d.pos === m.add[0].pos) ? ` Keep it anyway: a lost claim costs you nothing, and if you lose it you keep ${esc(m.drop.find(d => d.pos === m.add[0].pos).name)}.` : m.backupFill ? ' Your to-do list has a free agent you can add right now, in case you lose it.' : ' Keep it anyway: a lost claim costs you nothing.'}</p>` : ''}
    ${m.backupFill ? `<p class="why"><b>Don't just cancel it. Do this, in order:</b><br>1. Add ${esc(m.backupFill.name)} now (free agent, see your to-do list).<br>2. Put in a new claim for ${esc(m.add[0].name)} that drops ${esc(m.backupFill.name)} (button below).<br>3. Cancel this claim: it has no drop, so once your roster is full ESPN would turn it down.<br>Win the new claim and ${esc(m.add[0].name)} replaces ${esc(m.backupFill.name)}. Lose it and you still have ${esc(m.backupFill.name)}.</p>
    ${MOVE_URL ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `Claim ${m.add[0].name}, drop ${m.backupFill.name}`, type: 'WAIVER', items: [{ type: 'ADD', playerId: m.add[0].id }, { type: 'DROP', playerId: m.backupFill.id }], week: league.scoringPeriodId }))}">Claim ${esc(m.add[0].name)}, drop ${esc(m.backupFill.name)} (after step 1)</button>` : ''}` : ''}
    ${info([...m.add, ...m.drop])}
    ${exBtns(m.drop, m.add)}
    ${m.better ? `<p class="why" style="color:var(--warn)"><b>Better option:</b> ${lnk(m.better.c)} (${m.better.c.wa ? 'on waivers' : 'free agent, no waiting'}) would add about ${n(m.better.season)} a week instead of ${n(m.season)}, dropping the same player. To switch: cancel this claim, then tap him and use Add him.</p>` : ''}
    ${MOVE_URL ? `<button type="button" class="btn do" style="background:var(--chip);color:var(--fg)" data-move="${esc(JSON.stringify({ label: 'Cancel this claim on ESPN', type: 'WAIVER', cancel: true, related: m.id, items: [], week: league.scoringPeriodId }))}">Cancel this claim on ESPN</button>` : ''}</div>`;
  }
  const v = m.mine >= 1 ? ['good', m.mineOffer ? 'Good for you' : 'Good for you: accept'] : m.mine <= -1 ? ['bad', m.mineOffer ? 'Bad for you: cancel it' : 'Bad for you: decline'] : ['meh', 'About even'];
  const lost = [...new Set(m.give.map(p => p.pos))].map(pos => { const s = myStartersAt(m.after, pos).filter(p => !m.give.includes(p)); return s.length ? `your starting ${POS_NAME[pos]?.toLowerCase()}${s.length > 1 ? 's' : ''} would be ${startersText(s)}` : `you'd have no ${POS_NAME[pos]?.toLowerCase()}`; });
  return `<div class="card"><div class="vhead"><span class="tag">${m.mineOffer ? 'You offered' : 'Offered to you by'} <b>${esc(m.them.name)}</b></span><span class="verdict-${v[0]}">${esc(v[1])}</span></div>
  <div class="swap"><div class="arrow">you give</div>${m.give.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}
  <div class="arrow">you get</div>${m.take.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
  <p class="why"><b style="color:var(--${v[0] === 'meh' ? 'fg' : v[0]})">For you: ${gainText(m.mineWeek, m.mineLater)}.</b> They'd ${Math.abs(m.theirs) < 1 ? 'come out about even' : `${m.theirs > 0 ? 'gain' : 'lose'} about ${Math.round(Math.abs(m.theirs))} a week`}.
  ${lost.length ? `<br>After the trade, ${lost.join('; ')}.` : ''}
  ${m.vorTake < m.vorGive * 0.7 ? '<br>You\'re giving up more real value than you get back.' : m.vorTake > m.vorGive * 1.3 ? '<br>You get more real value than you give.' : ''}</p>
  ${exBtns(m.give, m.take, true)}
  ${MOVE_URL && !m.mineOffer ? `<div class="tools2"><button type="button" class="btn do" style="background:var(--good);color:var(--onaccent)" data-move="${esc(JSON.stringify({ label: 'Accept this trade on ESPN (it can\'t be undone)', type: 'TRADE_ACCEPT', related: m.id, items: [], week: league.scoringPeriodId }))}">Accept</button><button type="button" class="btn do" style="background:var(--bad);color:#fff" data-move="${esc(JSON.stringify({ label: 'Decline this trade on ESPN', type: 'TRADE_DECLINE', related: m.id, items: [], week: league.scoringPeriodId }))}">Decline</button></div>` : ''}</div>`;
}).join('') : '<div class="card empty">Nothing pending right now.</div>'}
</section>

<section id="trades"><h2>Trade ideas</h2>
<div class="card"><select id="tp-team" class="sel" aria-label="Show trades with"><option value="">All teams</option>${teams.filter(t => t !== me).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
<label class="pick" style="border:0;padding-bottom:0"><input type="checkbox" id="tp-loose"> Looser check: also show closer calls (trade ideas worth 1+ point a week to you, fleeces with a weaker pitch)</label></div>
<div class="pool-list" data-step="3">${(top => ideaPool.map(f => { const s = myStartersAt(f.after, f.give[0].pos); return `<div class="card" data-team="${f.d.t.id}" data-strict="${f.strict ? 1 : 0}"${top.has(f) ? '' : ' hidden'}><div class="vhead"><span class="tag">with <b>${esc(f.d.t.name)}</b></span><span class="verdict-good">${statSpans(gainText(f.mineWeek, f.mineLater) + oddsText(f.weeks))}</span></div>
  <div class="swap"><div class="arrow">you give</div>${f.give.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}
  <div class="arrow">you get</div><div class="row">${player(f.take)}${big(rate(f.take), 'per game, rest of season', null, f.take, 'season')}</div></div>
  <p class="why">For them: ${f.theirs > 0.2 ? `+${n(f.theirs)} a week` : 'about even'}.${f.give.length > 1 ? ' They\'d have to drop a bench player.' : ''}
  <br>Your starting ${POS_NAME[f.give[0].pos].toLowerCase()}${s.length > 1 ? 's' : ''} after: ${s.length ? `${startersText(s)} per game, rest of season` : 'nobody, so you\'d need to pick one up'}.</p>
  ${offerButtons(f)}</div>`; }).join(''))(new Set(ideaPool.filter(f => f.strict).slice(0, 3)))}${poolEmpty}</div>
${poolMore}
</section>

<section id="fleece"><h2>Fleece finder</h2>
<select id="tp-player" class="sel" aria-label="Player to get" hidden><option value="">Any player</option>${(tradesOpen ? teams : []).filter(t => t !== me).flatMap(t => t.roster.filter(tradeable).sort((a, b) => rate(b) - rate(a)).map(p => `<option value="${p.id}" data-team="${t.id}">${esc(p.name)} (${p.pos})</option>`)).join('')}</select>
<div class="pool-list" data-step="3">${(top => fleecePool.map(f => `<div class="card" data-team="${f.d.t.id}" data-take="${f.take.id}"${f.extra ? ' data-extra="1"' : ''} data-strict="${f.strict ? 1 : 0}"${top.has(f) ? '' : ' hidden'}><div class="vhead"><span class="tag">with <b>${esc(f.d.t.name)}</b></span><span class="${f.alt ? 'verdict-meh' : 'verdict-good'}">${statSpans(gainText(f.mineWeek, f.mineLater) + oddsText(f.weeks) + (f.alt ? ', not a fleece' : ''))}</span></div>
  <div class="swap"><div class="arrow">you give</div>${f.give.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}
  <div class="arrow">you get</div><div class="row">${player(f.take)}${big(rate(f.take), 'per game, rest of season', null, f.take, 'season')}</div></div>
  <p class="why">${situation(f.d.t) ? esc(situation(f.d.t)) + '. ' : ''}${f.alt ? 'Not a fleece, just your best offer. ' : ''}Looks ${f.looks >= 0.5 ? 'good for them' : 'even'} by points so far; ${f.theirs < -0.2 ? `they lose about ${n(-f.theirs)} a week going forward` : f.theirs > 0.2 ? `it helps them too going forward (+${n(f.theirs)} a week)` : 'about even for them going forward'}.${f.give.length > 1 ? " They'd have to drop a bench player." : ''}</p>
  ${offerButtons(f)}</div>`).join(''))(new Set(fleecePool.filter(f => f.strict && !f.extra).slice(0, 3)))}${poolEmpty}</div>
${poolMore}
</section>

<section id="buysell"><h2>Buy low, sell high</h2><p class="sub">Points vs his role, last 5 games.</p>
${sellHigh.length ? `<div class="group">Sell high: yours, scoring above his role</div><div class="list">${sellHigh.map(x => `<div class="card"><div class="row">${player(x.p)}${big(x.l.got, `per game, last ${x.l.games}`, null, x.p, 'season')}</div>
  <p class="why">${esc(roleText(x.l))}. That role is worth about <b>${n(x.l.worth)}</b> a game, not ${n(x.l.got)}, so expect him to cool off. Other managers see great numbers, so he's worth the most in a trade now.</p></div>`).join('')}</div>` : '<div class="card empty">None of your players are running way above their role right now.</div>'}
${buyLow.length ? `<div class="group">Buy low: theirs, scoring below his role</div><div class="list">${buyLow.map(x => `<div class="card"><div class="tag" style="margin-bottom:8px">on <b>${esc(x.t.name)}</b> &middot; ${esc(situation(x.t))}</div><div class="row">${player(x.p)}${big(x.l.got, `per game, last ${x.l.games}`, null, x.p, 'season')}</div>
  <p class="why">${esc(roleText(x.l))}. That role is worth about <b>${n(x.l.worth)}</b> a game, not ${n(x.l.got)}. Expect the points to come; his manager sees the low number. Pick ${esc(x.t.name)} in Fleece finder for your best offer.</p></div>`).join('')}</div>` : '<div class="card empty">Nobody on other teams is running way below his role right now.</div>'}
</section>



<section id="byes"><h2>Bye trouble</h2>
${byeTrouble.length ? `<div class="list">${byeTrouble.map(x => `<div class="card"><div class="vhead"><b>${esc(x.t.name)}</b><span class="verdict-good">Wk ${x.w}: -${Math.round(x.lost)}</span></div>
  <p class="why" style="margin:0">${esc(situation(x.t))}. Off: ${x.off.map(lnk).join(', ')}. Offer ${lnk(x.offer.p)}: +${n(x.offer.gain)} that week.</p></div>`).join('')}</div>` : '<div class="card"><p class="why" style="margin:0">Nobody right now.</p></div>'}
</section>

<section id="partners"><h2>Trade partners</h2>
<div class="card"><div class="group" style="margin:0 0 6px">Your team</div>
<p class="why" style="margin:0">Short on: <b>${myDepth.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}</b>. Extra: <b>${myDepth.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(p => esc(p.name)).join(', ')})`).join('; ') || 'nothing'}</b>.</p>
<p class="why" style="margin:8px 0 0">Weakest: <b>${POS_NAME[worstPos].toLowerCase()}</b>, ${ordinal(posRank(worstPos))} of ${teams.length}.${bestTwoForOne ? ` Best 2-for-1: ${bestTwoForOne.give.map(lnk).join(' + ')} for ${lnk(bestTwoForOne.take)} from <b>${esc(bestTwoForOne.d.t.name)}</b> (+${n(bestTwoForOne.mine)} a week).` : ''}</p></div>
${(() => { const card = d => `<div class="card"><div class="vhead"><b>${esc(d.t.name)}</b>${d.theyHave.length && d.youHave.length ? '<span class="verdict-good">Good match</span>' : d.theyHave.length ? '<span class="verdict-meh">Has what you need</span>' : ''}</div>
  <div class="worder" style="margin:0 0 6px"><span>Has:</span>${Object.entries(d.count).map(([pos, k]) => `<span>${k} ${pos}${k === 1 ? '' : 's'}</span>`).join('')}</div>
  <p class="tag" style="margin:0">Short on: ${d.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}.
  ${d.extra.length ? `Extra: ${d.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(lnk).join(', ')})`).join('; ')}.` : 'No extra starters.'}
  ${d.theyHave.length && d.youHave.length ? `<br><b style="color:var(--good)">Pitch:</b> your extra ${d.youHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')} for their extra ${d.theyHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')}.` : ''}</p>
  ${profiles.get(d.t) ? `<p class="why" style="margin:8px 0 0"><b>${esc(situation(d.t))}.</b> ${profiles.get(d.t).say.map(esc).join(' ')}${schedEase(d.t) ? ` Schedule: ${ordinal(schedEase(d.t))} easiest.` : ''}</p>` : ''}</div>`;
  return `<div class="list">${partners.slice(0, 3).map(card).join('')}</div>${partners.length > 3 ? `<details class="all"><summary>All ${partners.length} teams</summary><div class="list">${partners.slice(3).map(card).join('')}</div></details>` : ''}`; })()}
</section>

<section id="compare"><h2>Compare players</h2><p class="sub">Tap a box, then search for any player. Green = better.</p>
<div class="card"><div class="cmp-picks"><button type="button" class="cmp-slot" id="cmp-a"></button><button type="button" class="cmp-slot" id="cmp-b"></button></div>
<div id="cmp-search" hidden><input id="cmp-q" class="sel" type="search" placeholder="Search any player" autocomplete="off" aria-label="Search players"><div id="cmp-res" class="cmp-res"></div></div>
<div id="cmp-out"></div></div></section>

<section id="check"><h2>Trade checker</h2><p class="sub">Pick a team, then tick who you'd give and who you'd get.</p>
<div class="card"><select id="tc-team" class="sel" aria-label="Team to trade with"></select>
<div class="tc-cols"><div><div class="group">You give</div><div id="tc-give"></div></div><div><div class="group">You get</div><div id="tc-get"></div></div></div>
<div id="tc-out"></div></div></section>


<section id="season"><h2>Season outlook</h2>
${week > lastWeek ? '' : `<div class="card"><div class="group" style="margin:0 0 10px">Playoff chances</div><div class="stat">
  <div><b style="color:var(--${playoffPct >= 50 ? 'good' : 'bad'})">${playoffPct}%</b><small>chance you make the playoffs (top ${playoffTeams})</small></div>
  <div><b>${me.w}-${me.l}</b><small>now, with ${lastWeek - week + 1} games left</small></div></div>
  <p class="why">What it takes:</p>
  <div class="worder" style="margin:0">${recordOdds.map(([wins, pct]) => `<span class="${pct >= 50 ? 'me' : ''}">${wins}-${lastWeek - wins}: ${pct}% get in</span>`).join('')}</div>
  ${mustWin.length ? `<p class="why">Biggest games:</p>${mustWin.map(x => `<p class="why" style="margin:2px 0 0"><b>Week ${x.wk}${x.opp ? ` vs ${esc(x.opp.name)}` : ''}</b>: win and you're at ${x.win}%, lose and you're at ${x.lose}%.</p>`).join('')}` : ''}</div>`}
${recap ? `<div class="card"><div class="group" style="margin:0 0 10px">Last week (week ${recap.wk})</div><div class="stat">
  <div><b style="color:var(--${recap.opp == null || recap.got >= recap.opp ? 'good' : 'bad'})">${n(recap.got)}</b><small>you scored${recap.opp != null ? ` (${esc(recap.oppName)}: ${n(recap.opp)})` : ''}</small></div>
  <div><b>${n(recap.best)}</b><small>best lineup you could have set (in hindsight)</small></div></div>
  <p class="why">${recap.best - recap.got < 1 ? 'You started the best possible lineup.' : `${n(recap.best - recap.got)} points sat on your bench${recap.opp != null && recap.got < recap.opp && recap.best > recap.opp ? ', enough to have won' : ''}.${recap.misses.length ? ` Biggest miss: ${recap.misses.map(([i, o]) => `starting ${esc(o.name)} (${n(o.pts)}) over ${esc(i.name)} (${n(i.pts)})`).join('; ')}.` : ''}`}
  ${recap.site != null ? ` The site's suggested lineup scored ${n(recap.site)}.` : ''} Hindsight is easy: a good start can still have a bad week.</p>
  ${recap.down?.length || recap.up?.length ? `<div class="group" style="margin:14px 0 4px">Why you ${recap.opp == null ? 'scored what you did' : recap.got >= recap.opp ? `won by ${n(recap.got - recap.opp)}` : `lost by ${n(recap.opp - recap.got)}`}</div>
  ${recap.expTotal != null ? `<p class="why" style="margin:0">Your starters were expected to score about ${n(recap.expTotal)} and scored ${n(recap.got)}.</p>` : ''}
  ${[[recap.down, 'Let you down'], [recap.up, 'Came through']].filter(([l]) => l?.length).map(([l, label]) => `<p class="why" style="margin:10px 0 0"><b>${label}:</b></p>${l.map(x => `<p class="why" style="margin:6px 0 0"><b>${esc(x.name)}</b> (${esc(x.pos)}): ${n(x.pts)}, expected about ${n(x.exp)}. ${esc(x.why.join(' '))}</p>`).join('')}`).join('')}` : ''}</div>` : ''}
<div class="card"><div class="group" style="margin:0 0 10px">Luck check</div><div class="stat">
  <div><b>${me.w}-${me.l}</b><small>your real record</small></div>
  <div><b>${apW} of ${apW + apL}</b><small>matchups you'd have won if you played every team every week</small></div>
  <div><b>${ordinal(pfRank)}</b><small>most points of ${teams.length} teams</small></div>
  <div><b>${Math.round(me.pf / gamesPlayed)}</b><small>your points per week (league average: ${Math.round(leagueAvg)})</small></div></div>
  <p class="why">${apPct > realPct + 0.08 ? 'You\'ve been <b>unlucky</b>: you\'ve played better than your record shows, so wins should come.'
    : apPct < realPct - 0.08 ? 'You\'ve been <b>lucky</b>: your record is better than your points.'
    : 'Your record matches how you\'ve played.'}${pfRank > teams.length / 2 ? ' Your team scores less than most.' : ''}</p></div>
${ahead.length ? `<div class="card"><div class="vhead"><span class="group" style="margin:0">Your schedule ahead</span>${schedEase(me) ? `<span class="verdict-meh">${ordinal(schedEase(me))} easiest of ${teams.length}</span>` : ''}</div><table>
${ahead.map(g => `<tr><td class="num" style="text-align:left">Wk ${g.week}</td><td>${esc(g.t.name)} <span class="tag">${g.t.w}-${g.t.l}</span></td><td class="num">proj ~${Math.round(g.proj)}${g.off.length ? `<br><small>no ${esc(g.off.map(p => p.name.split(' ').pop()).join(', '))}</small>` : ''}</td><td style="text-align:right"><span class="lv ${g.level}">${g.level}</span></td></tr>`).join('')}</table>
</div>` : ''}
</section>

${(league.schedule ?? []).some(g => g.matchupPeriodId === week && g.away) ? `<section id="matchups"><h2>Matchups</h2><div class="list">${(league.schedule ?? []).filter(g => g.matchupPeriodId === week && g.away).map(g => {
  const side = id => { const b = board.find(r => r.t.id === id); return `<span class="t">${esc(id === me.id ? 'You' : teamName[id] ?? '')}</span><span class="p" data-teamnow="${id}">${(b?.now ?? 0).toFixed(1)}</span>`; };
  return `<div class="card" data-match="${g.home.teamId},${g.away.teamId}" style="cursor:pointer"><div class="vs">${side(g.home.teamId)}${side(g.away.teamId)}</div></div>`;
}).join('')}</div></section>` : ''}
<section id="league"><h2>League</h2><p class="sub">Dashed line = playoff cutoff. Waiver # = who gets first pick of new players (1 goes first).</p>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">W-L</td><td class="num">Points</td><td class="num">Waiver #</td></tr>
${standings.map((t, i) => `<tr data-team="${t.id}" class="${t === me ? 'me' : ''} ${i + 1 === playoffTeams ? 'cut' : ''}"><td class="num" style="text-align:left">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.w}-${t.l}</td><td class="num">${Math.round(t.pf)}</td><td class="num">${t.waiver}</td></tr>`).join('')}</table></div>
${intel.size || othersPending.size ? `<div class="card"><details open><summary>Behind the scenes: trades in progress, and offers and claims that didn't happen</summary>
<table>
${[...othersPending.values(), ...[...intel.values()].sort((a, b) => b.proposedDate - a.proposedDate)].slice(0, 20).map(tx => {
  const nm = id => esc(byId.get(id)?.name ?? names[id] ?? 'someone');
  const date = new Date(tx.proposedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (tx.type === 'WAIVER') {
    const add = tx.items.filter(i => i.type === 'ADD').map(i => nm(i.playerId)).join(', '), drop = tx.items.filter(i => i.type === 'DROP').map(i => nm(i.playerId)).join(', ');
    return `<tr><td class="num" style="text-align:left">${date}</td><td><b>${esc(teamName[tx.teamId] ?? '')}</b> tried to claim ${add}${drop ? ` (dropping ${drop})` : ''} ${cmpChip(byId.get(tx.items.find(i => i.type === 'DROP')?.playerId), byId.get(tx.items.find(i => i.type === 'ADD')?.playerId))} <span class="tag">(${tx.status === 'CANCELED' ? 'they canceled it' : 'didn\'t go through'})</span></td></tr>`;
  }
  const other = tx.items.map(i => (i.fromTeamId === tx.teamId ? i.toTeamId : i.fromTeamId)).find(id => id !== tx.teamId);
  const gave = tx.items.filter(i => i.fromTeamId === tx.teamId).map(i => nm(i.playerId)).join(', '), got = tx.items.filter(i => i.toTeamId === tx.teamId).map(i => nm(i.playerId)).join(', ');
  return `<tr><td class="num" style="text-align:left">${date}</td><td><b>${esc(teamName[tx.teamId] ?? '')}</b> offered ${gave} to ${esc(teamName[other] ?? '')} for ${got} ${cmpChip(byId.get(tx.items.find(i => i.fromTeamId === tx.teamId)?.playerId), byId.get(tx.items.find(i => i.toTeamId === tx.teamId)?.playerId))} <span class="tag">(${tx.type === 'TRADE_ACCEPT' && tx.status === 'PENDING' ? `accepted, in league review until ${new Date(tx.processDate).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' })} Pacific; the league can still veto it` : tx.status === 'PENDING' ? 'waiting for an answer' : tx.status.toLowerCase().replace(/_/g, ' ')})</span></td></tr>`;
}).join('')}</table></details></div>` : ''}
<div class="card"><details><summary>Recent moves around the league</summary><table>
${moves.slice(0, 30).map(m => `<tr><td class="num" style="text-align:left">${new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td>${esc(teamName[m.team] ?? '')}</td><td>${m.type === 'ADD' ? '<b style="color:var(--good)">added</b>' : m.type === 'DROP' ? '<span style="color:var(--bad)">dropped</span>' : `traded with ${esc(teamName[m.from])}`} ${esc(names[m.playerId] ?? '')}</td></tr>`).join('')}</table></details></div>
</section>

${report.size ? `<section id="report"><h2>Report card</h2>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">Lineups</td><td class="num">Bench</td><td class="num">Luck</td><td class="num">Trades</td></tr>
${[...report.values()].filter(r => r.weeks).sort((a, b) => a.effRank - b.effRank).map(r => `<tr data-team="${r.t.id}" class="${r.t === me ? 'me' : ''}"><td class="num" style="text-align:left">${r.effRank}</td><td>${esc(r.t.name)}</td><td class="num">${r.eff.toFixed(1)}%</td><td class="num">${n(r.bench)}</td><td class="num">${r.luck >= 0 ? '+' : ''}${r.luck.toFixed(1)}</td><td class="num">${(l => l.length ? `${l.filter(x => x.res === 'won').length}-${l.filter(x => x.res === 'lost').length}` : '-')(r.trades ?? [])}</td></tr>`).join('')}</table></div></section>` : ''}
<section id="allmoves"><h2>Waiver moves</h2><div class="card"><div style="display:flex;gap:8px;margin-bottom:10px"><input id="wm-q" class="sel" style="flex:2;min-width:0" type="search" placeholder="Search team or player" aria-label="Search waiver moves"><select id="wm-kind" class="sel" style="flex:1;min-width:0" aria-label="Kind of move"><option value="">All</option><option value="add">Adds</option><option value="drop">Drops</option></select></div><div id="wm-out"></div></div></section>

<section id="versus"><h2>Team vs team</h2><div class="card"><div style="display:flex;gap:8px;margin-bottom:10px"><select id="vs-a" class="sel" style="flex:1;min-width:0" aria-label="First team"></select><select id="vs-b" class="sel" style="flex:1;min-width:0" aria-label="Second team"></select></div><div id="vs-out"></div></div></section>

<section id="help"><h2>How it works</h2>
<div class="card"><dl>
<dt>How you win</dt><dd>Every week you play one other team. Your starters score points from what they do in real NFL games. Higher total wins. Bench players don't count.</dd>
<dt>Positions</dt><dd><span class="pos pos-QB">QB</span> Quarterback: throws the ball. Usually your highest scorer.<br>
<span class="pos pos-RB">RB</span> Running back: runs with the ball.<br>
<span class="pos pos-WR">WR</span> Wide receiver: catches passes.<br>
<span class="pos pos-TE">TE</span> Tight end: blocks and catches passes.<br>
<span class="pos pos-K">K</span> Kicker: kicks field goals and extra points.<br>
<span class="pos pos-DST">D/ST</span> Defense: a whole team's defense. Scores for sacks, turnovers and holding the other team to few points.<br>
<b>FLEX</b>: one extra spot that can be an RB, WR or TE.</dd>
<dt>Expected points</dt><dd>How many points a player should score this week: the average of ESPN's, Rotowire's, CBS's and FantasyPros' guesses.</dd>
<dt>Top starter, starter, below starter</dt><dd>How a number compares with the players who start at that position across your league. <b>Top starter</b>: top third of them. <b>Starter</b>: good enough to start on a typical team. <b>Below starter</b>: less than that. You may still have to start him if he is your best option.</dd>
<dt>"Up to" number</dt><dd>What he'd score if he has a great game. A big gap between expected and "up to" means he's boom-or-bust.</dd>
<dt>Win chance</dt><dd>How likely you are to win this week, worked out from the same averaged projections (ESPN, Rotowire, CBS) as the scores. Once games start it switches to ESPN's live estimate, which follows the real score.</dd>
<dt>Points per game</dt><dd>How many points he's actually scored each week on average this season.</dd>
<dt>Per game, rest of season</dt><dd>How many points per game ESPN, Rotowire and CBS expect from him for the rest of the season, averaged. Season pickups and trades use this.</dd>
<dt>Bye week</dt><dd>Each NFL team gets one week off. A player on bye scores 0, so never start him that week.</dd>
<dt>Injury tags</dt><dd><b>Might not play</b> (questionable): about 7 in 10 of these players end up playing. The % on each player uses his practices this week from the official NFL injury report: 86% play after a full practice, 71% after a limited one, 29% after none. <b>Probably won't play</b> (doubtful): only about 1 in 15 play. (From Footballguys' count of QB, RB, WR and TE injury reports, 2017 to 2024.) <b>Out</b>: won't play. <b>IR</b>: hurt for weeks; move him to your IR spot so he doesn't take up a bench spot. <b>Day to day</b>: a minor injury ESPN is watching; he hasn't been ruled out, so check his tag again before kickoff.</dd>
<dt>Phone widget</dt><dd>The Home Screen widget (Scriptable) reads <code style="overflow-wrap:anywhere">https://mrbrofo.github.io/Fantasy-app/${WIDGET}</code>. The name is secret so only you can read it; it changes if the site password changes.</dd>
<dt>Waivers vs free agents</dt><dd>Recently dropped players go on <b>waivers</b> for about a day. Your league processes claims ${procText}${runMin != null ? `, starting as early as ${clock(runMin)} Pacific (get claims in before then)` : ''}. Everyone can claim them, and the team with the best waiver # gets him. After that he's a <b>free agent</b>: first to add him gets him.</dd>
<dt>Scoring in this league</dt><dd>Half-point PPR: players get half a point for every catch, on top of points for yards and touchdowns.</dd>
<dt>Where these tips come from</dt><dd>"Expected" points are the average of ESPN's, Rotowire's, CBS Sports' and FantasyPros' projections, and Vegas betting lines show which games should be high-scoring. Season stats come from ESPN. Breaking news can take a while to reach them.</dd>
</dl></div>
<details class="fold"><summary class="group">Football dictionary</summary><dl id="dict" style="padding-bottom:12px"></dl></details>
<details class="fold"><summary class="group">More football words (not used on this site)</summary><dl id="dict2" style="padding-bottom:12px"></dl></details></section>

<section id="look"><h2>Settings</h2><div class="card"><div class="group" style="margin:0 0 8px">Look</div><div class="seg" style="margin:0"><button type="button" data-look="term">Terminal</button><button type="button" data-look="classic">Classic</button><button type="button" data-look="glass">Glass</button></div></div></section>
<section id="alerts" hidden><div class="card"><b>Phone alerts</b>

<button type="button" id="alertbtn" class="btn">Turn on alerts</button>
<div id="alertcode" hidden><p class="tag">Last step: copy this code, then in GitHub open your Fantasy-app repo &rsaquo; Settings &rsaquo; Secrets and variables &rsaquo; Actions &rsaquo; New repository secret. Name it <b>PUSH_SUB</b> and paste the code. You'll get an "Alerts are on" notification within a few minutes.</p>
<textarea id="alerttext" aria-label="Alert setup code" readonly rows="4" style="width:100%;font:12px monospace"></textarea>
<button type="button" id="alertcopy" class="btn">Copy code</button></div></div></section>
${process.env.SITE_PASSWORD ? '<section id="account"><button type="button" id="signout" class="btn" style="background:none;border:1px solid #8886;color:inherit;margin:8px 0 16px">Sign out</button></section>' : ''}
</div>
<div id="sheet" hidden><div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="Player details"><button class="sheet-x" type="button" data-close aria-label="Close">&times;</button><div class="sheet-body"></div></div></div>
<script type="application/json" id="pdata">__PDATA__</script>
<script type="application/json" id="rdata">__RDATA__</script>
<script type="application/json" id="snap">${JSON.stringify(snap).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="facts">${JSON.stringify(facts).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="live">${JSON.stringify(MOVE_URL && process.env.SITE_PASSWORD ? { url: MOVE_URL, token: crypto.createHash('sha256').update(process.env.SITE_PASSWORD + ':live').digest('hex'), week, me: me.id, teams: Object.fromEntries(teams.map(t => [t.id, t.name])) } : null)}</script>
<script>${mainJs(verdictText, VAPID_PUBLIC)}</script></body></html>`;

// --- Player sheet data, for every player the page shows
// Play-by-play for your players whose game has started (not D/ST): every play his name is in, newest first.
// ESPN writes names as "P.Mahomes" (sometimes "Ja.Smith"), so match first initial + last name.
// ponytail: refetches each game every run (~0.5 MB each); cache finished games if runs get slow.
const plays = new Map();
{
  const evOf = p => p.pos !== 'D/ST' && ['in', 'post'].includes(gameNow[TEAM(p.team)]?.state) ? gameNow[TEAM(p.team)].id : null;
  const byEv = {};
  await Promise.all([...new Set(me.roster.map(evOf).filter(Boolean))].map(async id => {
    try {
      const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`)).json();
      byEv[id] = [...(d.drives?.previous ?? []), ...(d.drives?.current ? [d.drives.current] : [])].flatMap(x => x.plays ?? []);
    } catch (err) { console.warn(`Plays for game ${id} skipped:`, err.message); }
  }));
  for (const p of me.roster) {
    const all = byEv[evOf(p)];
    if (!all) continue;
    const [first, ...last] = p.name.replace(/\s+(Jr\.|Sr\.|II|III|IV|V)$/, '').split(' ');
    const re = new RegExp(`\\b${first[0]}[a-z]*\\.${last.join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const seen = new Set();
    plays.set(p.id, all.filter(x => re.test(x.text) && !seen.has(x.id) && seen.add(x.id)).reverse()
      .map(x => ({ when: `Q${x.period?.number ?? '?'} ${x.clock?.displayValue ?? ''}`.replace('Q5', 'OT'), text: x.text, td: !!x.scoringPlay })));
  }
}
// every rostered player gets a page, so taps on other teams' players work too
// ponytail: ~200 extra news/card fetches and a bigger page; trim to starters if runs get slow
for (const t of teams) for (const p of t.roster) if (!shown.has(p.id)) shown.set(p.id, p);
const ids = [...shown.keys()];
const card = new Map();
for (let i = 0; i < ids.length; i += 50) {
  const d = await get(`${LEAGUE}?view=kona_playercard&scoringPeriodId=${week}`, {
    players: { filterIds: { value: ids.slice(i, i + 50) }, filterStatsForTopScoringPeriodIds: { value: week, additionalValue: [`00${SEASON}`, ...Array.from({ length: week }, (_, i) => `11${SEASON}${i + 1}`)] } }, // + what he was projected each week, this one too
  });
  for (const x of d.players) card.set(x.player.id, x.player);
}
// The league's answer may leave out past weeks' projections; then take ESPN's public ones. They come in standard and PPR
// scoring only, so this league's half PPR is the average of the two.
if (week > 1 && ![...card.values()].some(c => c.stats?.some(x => x.statSourceId === 1 && x.scoringPeriodId < week))) {
  for (let i = 0; i < ids.length; i += 50) {
    const f = { players: { filterIds: { value: ids.slice(i, i + 50) }, filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: Array.from({ length: week }, (_, w) => `11${SEASON}${w + 1}`) } } };
    const [std, ppr] = await Promise.all([1, 3].map(s => get(`${BASE}/segments/0/leaguedefaults/${s}?view=kona_playercard&scoringPeriodId=${week}`, f).catch(() => null)));
    for (const x of ppr?.players ?? []) {
      const c = card.get(x.player.id), s1 = std?.players.find(y => y.player.id === x.player.id)?.player.stats ?? [];
      if (c) for (const s of x.player.stats ?? []) if (s.statSourceId === 1 && s.scoringPeriodId <= week && s.appliedTotal != null && !c.stats?.some(y => y.id === s.id)) {
        const t = s1.find(y => y.id === s.id), half = (a, b) => (a + (b ?? a)) / 2;
        (c.stats ??= []).push({ ...s, appliedTotal: half(s.appliedTotal, t?.appliedTotal), appliedStats: Object.fromEntries(Object.entries(s.appliedStats ?? {}).map(([k, v]) => [k, half(v, t?.appliedStats?.[k])])) });
      }
    }
  }
}
console.log('Past-week projections:', [...card.values()].filter(c => c.stats?.some(x => x.statSourceId === 1 && x.scoringPeriodId < week)).length, 'of', card.size, 'players');
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
const blurbs = new Map(); // player id -> his Rotowire updates: { id, h (headline), s (first lines of the story), t (published ms), tag }
// First two sentences of a news story, so news like a teammate getting hurt shows the day it happens, not only the headline
// the whole story, as plain text with its paragraphs, so a news card can open in the app instead of on ESPN
const fullStory = story => {
  const txt = String(story ?? '').replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n\n').trim();
  return txt.length > 3000 ? txt.slice(0, 2997).replace(/\s+\S*$/, '') + '...' : txt;
};
const snip = (story, h = '') => {
  const txt = String(story ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (!txt || txt.startsWith(h.slice(0, 40))) return '';
  const two = txt.match(/^(.+?[.!?])(\s+.+?[.!?])?(?=\s+[A-Z"]|$)/)?.[0] ?? txt;
  return two.length > 260 ? two.slice(0, 257).replace(/\s+\S*$/, '') + '...' : two;
};
// ...but once his "What's affecting him" notes say the same thing (a player named in the story is out), the note covers it,
// so the story lines go away instead of saying it twice. ponytail: matches by "First Last" names only.
const freshSnip = (sn, p) => {
  if (!sn) return '';
  const said = notes(p).filter(t => /\b(is out|on IR|suspended|probably won't play|might not play)\b/.test(t)).join(' ');
  const names = (sn.match(/\b[A-Z][a-z'.]+(?: [A-Z][A-Za-z'.-]+)+/g) ?? []).filter(x => x !== p.name);
  return names.some(x => said.includes(x)) ? '' : sn;
};
const news = new Map(await Promise.all(ids.filter(id => id > 0).map(async id => {
  try {
    const r = await fetch(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=6&playerId=${id}`);
    const feed = (await r.json()).feed ?? [];
    blurbs.set(id, feed.filter(x => x.type === 'Rotowire' && x.headline).map(x => ({ id: x.id, h: x.headline, s: snip(x.story, x.headline), t: Date.parse(x.published), tag: newsTag(x.headline) })));
    const last = (shown.get(id).name.split(' ').filter(w => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop() ?? '').toLowerCase();
    // player notes (his name in the headline) before general articles that only mention him
    const items = feed.filter(x => x.headline && (x.headline + ' ' + (x.story ?? '')).toLowerCase().includes(last))
      .sort((a, b) => b.headline.toLowerCase().includes(last) - a.headline.toLowerCase().includes(last)).slice(0, 2);
    return [id, items.map(x => ({ h: x.headline, s: snip(x.story, x.headline), f: fullStory(x.story), url: x.links?.web?.href || `https://www.espn.com/nfl/player/_/id/${id}`, when: new Date(x.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))];
  } catch { return [id, []]; }
})));
const owner = new Map(teams.flatMap(t => t.roster.map(p => [p.id, t])));
const gameText = p => {
  const g = pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0];
  if (!g) return '';
  const home = g.homeProTeamId === p.proTeamId;
  return `${home ? 'Home vs' : 'Away at'} ${proName[home ? g.awayProTeamId : g.homeProTeamId]}, ${new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })} ET.`;
};
const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60e3)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const myIds = new Set(me.roster.map(p => p.id)), watchIds = new Set([...plan.map(s => s.add.id), ...claims.flatMap(m => m.add.map(a => a.id))]);
const feedItems = [...blurbs].filter(([id]) => myIds.has(id) || watchIds.has(id))
  .flatMap(([id, xs]) => xs.map(x => ({ ...x, p: shown.get(id) }))).filter(x => x.p && Date.now() - x.t < 7 * 864e5).sort((a, b) => b.t - a.t)
  .filter((x, i, xs) => xs.findIndex(y => y.p.id === x.p.id) === i).slice(0, 8); // newest per player
html = html.replace('__NEWS__', () => feedItems.length ? feedItems.map(x => `<div class="card"><div class="vhead">${lnk(x.p)}${x.tag ? `<span class="chip ${x.tag[1]}" style="margin:0">${x.tag[0]}</span>` : ''}</div>
  <p class="why" style="margin:6px 0 2px">${esc(x.h)}</p>${freshSnip(x.s, x.p) ? `<p class="why" style="margin:0 0 2px;color:var(--muted)">${esc(freshSnip(x.s, x.p))}</p>` : ''}<span class="tag">${ago(x.t)}${watchIds.has(x.p.id) && !myIds.has(x.p.id) ? ' &middot; pickup' : ''}</span></div>`).join('') : '<div class="card empty">No news on your players in the last week.</div>');
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
// every team's rows, built before the player pages below so each of their players gets one
const teamRows = new Map(teams.map(t => [t, bySlot(t.roster).map(p => [isStarter(p), lineRow(p)])]));
const pdata = {};
for (const [id, p] of shown) {
  const c = card.get(id), inj = p.inj ?? (c?.injuryDetails && { type: c.injuryDetails.type, season: c.injuryDetails.outForSeason, back: c.injuryDetails.expectedReturnDate && new Date(c.injuryDetails.expectedReturnDate[0], c.injuryDetails.expectedReturnDate[1] - 1, c.injuryDetails.expectedReturnDate[2]) });
  const hurtType = inj?.type && inj.type !== 'Undisclosed' ? ` (${inj.type.toLowerCase()})` : '';
  const back = inj?.back && inj.back > Date.now() ? ` Expected back around ${dateStr(inj.back)}.` : '';
  const play = inj?.season ? ['no', `No. He's out for the season${hurtType}.`]
    : p.bye === week ? ['no', 'No. His team has no game this week (bye week).']
    : ['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(p.status) ? ['no', `No. ${STATUS[p.status][0]}${hurtType}.${back}`]
    : p.status === 'DOUBTFUL' ? ['no', `Probably not${hurtType}: ${playOdds(p, inj?.type).pct}% chance he plays. ${playOdds(p, inj?.type).why[0].toUpperCase()}${playOdds(p, inj?.type).why.slice(1)}.`]
    : p.status === 'QUESTIONABLE' ? ['maybe', `${playOdds(p, inj?.type).pct >= 60 ? 'Probably' : playOdds(p, inj?.type).pct >= 40 ? 'Maybe' : 'Probably not'}${hurtType}: ${playOdds(p, inj?.type).pct}% chance he plays. ${playOdds(p, inj?.type).why[0].toUpperCase()}${playOdds(p, inj?.type).why.slice(1)}.`]
    : ['yes', 'Yes, he\'s expected to play.'];
  const t = owner.get(id), mine = t === me;
  const advice = !mine ? null : inj?.season ? ['no', 'Drop him. He\'s out for the season.'] : p.slot === 'IR' ? ['maybe', 'Leave him in IR until he\'s healthy.']
    : bestIds.has(id) ? (p.slot === 'Bench' ? ['yes', 'Start him. He\'s one of your best options this week.'] : ['yes', 'Keep him in your lineup.'])
    : p.slot !== 'Bench' ? ['no', 'Bench him. Someone on your team is expected to score more.'] : ['maybe', 'Keep him on the bench this week.'];
  const games = [];
  for (let wk = 1; wk < week; wk++) {
    const s = c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 0 && x.statSplitTypeId === 1 && x.scoringPeriodId === wk);
    const proj = p.bye === wk ? null : c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === wk)?.appliedTotal || null;
    games.push({ wk, pts: s?.appliedTotal ?? null, proj, note: p.bye === wk ? 'bye' : '–', line: scoring(s), why: p.bye === wk ? [] : whyWeek(p, wk, s?.appliedTotal ?? null, proj) });
  }
  // this week so far, once his game has started
  const cur = c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 0 && x.statSplitTypeId === 1 && x.scoringPeriodId === week), g = gameNow[TEAM(p.team)];
  const now = p.bye === week || !g || (g.state === 'pre' && !cur) ? null
    : { pts: n(cur?.appliedTotal ?? p.now ?? 0), game: g.state === 'post' ? 'Game over' : g.state === 'in' ? `Playing now (${g.text})` : g.text, line: cur ? scoring(cur) : p.nowLine ?? [],
      why: g.state === 'post' ? whyWeek(p, week, cur?.appliedTotal ?? p.now ?? null, p.proj) : [] };
  const played = games.filter(g => g.pts != null).slice(-3);
  const recent = played.length ? played.reduce((s, g) => s + g.pts, 0) / played.length : null;
  const trend = recent == null || !p.avg || played.length < 2 ? '' : recent > p.avg * 1.25 ? `Hot: ${n(recent)} per game over his last ${played.length} games, better than his season average.`
    : recent < p.avg * 0.75 ? `Cold: ${n(recent)} per game over his last ${played.length} games, worse than his season average.` : '';
  const pc = p.bye === week ? null : c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === week);
  const projLine = pc ? scoring(pc) : [], d = (p.proj ?? 0) - (p.avg ?? 0);
  const ex = p.bye === week ? null : p.experts; // [points, "WR4", best, worst, grade, experts]
  const experts = ex ? `Experts rank him ${ex[1].replace(/(\D+)(\d+)/, '$1 #$2')} this week (${ex[5]} experts, from #${ex[2]} to #${ex[3]})${ex[4] ? `, start grade ${ex[4]}` : ''}.` : '';
  const projVs = p.proj == null || !p.avg ? '' : Math.abs(d) < 2 ? `About his usual: he averages ${n(p.avg)} a game.` : `${d > 0 ? 'More' : 'Less'} than his usual ${n(p.avg)} a game.`;
  const sources = [
    p.bye === week ? 'No game this week (bye), so no projection.' : p.roto != null || p.cbs != null || p.fp != null ? `${srcText(p)}. ${srcWeights ? 'We weight them by how close each has been this season.' : 'We use the average.'} ${p.split ? 'They disagree a lot, so he\'s a riskier start than the number looks.' : 'They mostly agree.'}` : p.espn != null ? `Only ESPN has a number for him (${n(p.espn)}).` : '',
    p.vegas && p.pos !== 'D/ST' && p.bye !== week ? `Betting odds have his team scoring about ${Math.round(p.vegas)} points, ${p.vegas >= vegasAvg + 3 ? 'one of the higher totals this week. Good for him.' : p.vegas <= vegasAvg - 3 ? 'one of the lower totals this week. Bad for him.' : 'about average this week.'}` : '',
  ].filter(Boolean).join(' ');
  pdata[id] = {
    id, name: p.name, posName: POS_NAME[p.pos] ?? p.pos, teamName: [p.teamName, depthWord(p), p.bye && `bye wk ${p.bye}`].filter(Boolean).join(' · '), free: t ? null : { wa: !!p.wa, locked: locked(p) },
    pro: String(p.proTeamId), side: isStarter(p) ? (mine ? 'me' : t && t === opp ? 'opp' : null) : null, // Watch view: starters in my matchup
    owner: mine ? 'On your team' : t ? `On ${t.name}` : 'Free: nobody in your league has him',
    play, advice, game: p.bye === week ? '' : gameText(p), proj: n(p.proj), ceiling: p.ceiling > (p.proj ?? 0) + 1 ? Math.round(p.ceiling) : null, odds: oddsOf(p),
    avg: n(p.avg), rank: p.rank ? '#' + p.rank : '-', rankWhy: p.rank ? rankWhy(p) + ' (this season)' : '', started: c?.ownership?.percentStarted != null ? `${Math.round(c.ownership.percentStarted)}%` : '-',
    trend, hit: hitLine(p)?.[1] ?? '', sources, projLine, projVs, experts, espnProj: pc ? n(pc.appliedTotal) : null, games, now, plays: plays.get(id) ?? [], notes: notes(p),
    rosText: p.ros == null ? '' : `Expected ${n(p.ros)} points per game from here on (${[['ESPN', p.rosBy[0]], ['Rotowire', p.rosBy[1]], ['CBS', p.rosBy[2]], ['FantasyPros', p.rosBy[3]]].filter(([, v]) => v != null).map(([src, v]) => `${src} ${n(v)}`).join(', ')}).${p.rosRank ? ` Experts rank him ${p.rosRank.replace(/(\D+)(\d+)/, '$1 #$2')} for the rest of the season.` : ''} Season pickups and trades use this.`, news: (news.get(id) ?? []).map(x => ({ ...x, s: freshSnip(x.s, p) })),
    byeText: !p.bye ? 'No bye listed.' : p.bye < week ? `Week ${p.bye} (done).` : p.bye === week ? 'This week. He won\'t play.' : `Week ${p.bye}.`,
  };
  // a defense is a whole team: "they", not "he"
  if (p.pos === 'D/ST') for (const k of ['play', 'advice']) if (pdata[id][k]) pdata[id][k] = [pdata[id][k][0], pdata[id][k][1].replace(/\bhe's\b/gi, 'they\'re').replace(/\bHe\b/g, 'They').replace(/\bhim\b/g, 'them')];
  if (p.pos === 'D/ST') pdata[id].sources = sources.replace(/he's a riskier/, 'they\'re a riskier').replace(/for him \(/, 'for them (');
  if (p.pos === 'D/ST') pdata[id].byeText = pdata[id].byeText.replace(/He plays/, 'They play').replace(/He won't/g, 'They won\'t').replace(/he won't/g, 'they won\'t');
}
const TAB_OF = { look: 'settings', account: 'settings', changes: 'home', ask: 'home', alerts: 'settings', todo: 'home', lineup: 'team', bench: 'team', pickups: 'pickups', pending: 'pending', check: 'compare', fleece: 'trades', byes: 'trades', buysell: 'trades', partners: 'trades', trades: 'trades', compare: 'compare', season: 'season', league: 'league', matchups: 'league', report: 'league', versus: 'league', allmoves: 'league', news: 'news', help: 'help' };
html = html.replace(/<section id="([a-z]+)"/g, (m, id) => TAB_OF[id] ? `${m} data-tab="${TAB_OF[id]}"` : m);
html = html.replace(/(<h2>[^<]*<\/h2>)<p class="sub">([\s\S]*?)<\/p>/g, (m, h, text) => {
  const cut = text.indexOf('. ');
  if (text.replace(/<[^>]+>/g, '').length < 110 || cut < 0) return m;
  return `${h}<p class="sub">${text.slice(0, cut + 1)}</p><details class="intro"><summary>How to read this</summary><p class="sub">${text.slice(cut + 2)}</p></details>`;
});
// extra sections fold to one line you tap to open, so each tab starts short
html = html.replace(/(<section id="(?:bench|fleece|byes|buysell|partners)"[^>]*>)(<h2>[^<]*<\/h2>)([\s\S]*?)<\/section>/g, '$1<details class="fold"><summary>$2</summary>$3</details></section>');
html = html.replace('__TOOLSJS__', () => TOOLS_JS.replace('__BESTLINEUP__', bestLineup.toString()));
html = html.replace('__MOVEJS__', () => MOVE_URL ? MOVE_JS.replace('__URL__', MOVE_URL) : '');
const lite = p => [p.name, p.pos, p.teamName ?? '', +(p.proj ?? 0).toFixed(2), +rate(p).toFixed(2), playable(p) ? 1 : 0, locked(p) ? 1 : 0, p.slot, p.rank ?? 0, Math.round(p.ceiling ?? 0), +(p.avg ?? 0).toFixed(1), p.bye ?? 0, statusWords(p), p.team ?? '', nextProj.has(p.id) ? +nextProj.get(p.id).toFixed(2) : null, rosSaved.future.by[p.id] ?? null, oddsOf(p)];
const faList = allFa.filter(p => rate(p) > 0 || (p.proj ?? 0) > 0).sort((a, b) => rate(b) - rate(a)).slice(0, 120);
// Swaps of one player each that make both lineups better, for two teams: [a's player, b's player, a's gain, b's gain], best first
function mutualSwaps(ra, rb, value, score, min = 0.5) {
  const pick = r => r.filter(p => !['K', 'D/ST'].includes(p.pos) && value(p) > 0).sort((p, q) => value(q) - value(p)).slice(0, 10);
  const baseA = score(ra), baseB = score(rb), out = [];
  for (const x of pick(ra)) for (const y of pick(rb)) {
    const ga = score(ra.map(p => p === x ? y : p)) - baseA, gb = score(rb.map(p => p === y ? x : p)) - baseB;
    if (ga >= min && gb >= min) out.push([x, y, ga, gb]);
  }
  return out.sort((a, b) => Math.min(b[2], b[3]) - Math.min(a[2], a[3]));
}
const teamMoves = new Map(teams.map(t => [t.id, { start: [], add: [], trade: [] }]));
try {
  const seasonScore = r => score(r, seasonValue);
  for (const t of teams) {
    const m = teamMoves.get(t.id), line = bestLineup(t.roster, seasonValue).lineup.map(x => x.player);
    // this week: the best lineup against who's in
    const wk = bestLineup(t.roster, p => weekValue(p) + (locked(p) && isStarter(p) ? 1e3 : 0)).lineup.map(x => x.player);
    const inn = wk.filter(p => !isStarter(p)).sort((a, b) => weekValue(b) - weekValue(a)), out = t.roster.filter(p => isStarter(p) && !wk.includes(p)).sort((a, b) => weekValue(a) - weekValue(b));
    m.start = inn.map((p, i) => out[i] && weekValue(p) - weekValue(out[i]) >= 0.5 ? [p.id, out[i].id, +(weekValue(p) - weekValue(out[i])).toFixed(1)] : null).filter(Boolean);
    // waivers: the free player who adds most, for whoever's least useful on the bench
    const spare = t.roster.filter(p => !line.includes(p) && p.slot !== 'IR').sort((a, b) => seasonValue(a) - seasonValue(b))[0];
    if (spare) {
      const base = seasonScore(t.roster);
      m.add = faList.filter(c => playable(c)).map(c => [c, seasonScore(t.roster.map(p => p === spare ? c : p)) - base]).filter(x => x[1] >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, g]) => [c.id, spare.id, +g.toFixed(1), c.wa ? 1 : 0]);
    }
  }
  if (tradesOpen) for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    const best = mutualSwaps(teams[i].roster, teams[j].roster, seasonValue, seasonScore)[0];
    if (!best) continue;
    teamMoves.get(teams[i].id).trade.push([best[0].id, best[1].id, teams[j].name, +best[2].toFixed(1), +best[3].toFixed(1)]);
    teamMoves.get(teams[j].id).trade.push([best[1].id, best[0].id, teams[i].name, +best[3].toFixed(1), +best[2].toFixed(1)]);
  }
  for (const m of teamMoves.values()) m.trade = m.trade.sort((a, b) => Math.min(b[3], b[4]) - Math.min(a[3], a[4])).slice(0, 3);
} catch (err) { console.warn('Team moves skipped:', err.message); }
// Team vs team: rest-of-season numbers from the same simulated seasons as the playoff chance
const oppLeft = new Map(teams.map(t => [t.id, []]));
left.forEach((g, gi) => { oppLeft.get(g.home.teamId)?.push(sideMean[gi][1][0]); oppLeft.get(g.away.teamId)?.push(sideMean[gi][0][0]); });
const oppAvg = id => { const l = oppLeft.get(id); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0; };
const sosRank = new Map([...teams].sort((a, b) => oppAvg(a.id) - oppAvg(b.id)).map((t, i) => [t.id, i + 1]));
const vsData = t => {
  const r = report.get(t.id), [made, wins, byes] = simBase.byTeam.get(t.id), l = lineups.get(t), sc = r?.scores ?? [], left_ = oppLeft.get(t.id).length;
  const avg = sc.reduce((a, x) => a + x[1], 0) / (sc.length || 1), hi = [...sc].sort((a, b) => b[1] - a[1])[0], lo = [...sc].sort((a, b) => a[1] - b[1])[0];
  const w = wins / SIMS;
  return { pct: Math.round(made / SIMS * 100), bye: playoffTeams > 1 && 2 ** Math.ceil(Math.log2(playoffTeams)) > playoffTeams ? Math.round(byes / SIMS * 100) : null, w: +w.toFixed(1), l: +(t.w + t.l + t.ties + left_ - w).toFixed(1), left: +(w - t.w - t.ties / 2).toFixed(1), sos: sosRank.get(t.id), ppg: +l.reduce((s, x) => s + rate(x.player), 0).toFixed(1),
    sd: sc.length ? +Math.sqrt(sc.reduce((a, x) => a + (x[1] - avg) ** 2, 0) / sc.length).toFixed(1) : null, hi: hi ?? null, lo: lo ?? null, ap: r?.weeks ? [r.apW, r.apL] : null, start: l.map(x => [x.slot, x.player.id]) };
};
const rdata = { week: league.scoringPeriodId, fw: week + 1, lastWeek, me: me.id, moves: !!MOVE_URL, tradesOpen, voice: VOICE, slotCounts, slotPos: SLOT_POS, slotName: SLOT, repl,
  teams: teams.map(t => { const b = board.find(r => r.t === t); return { id: t.id, name: t.name, mgr: mgrName(t), ids: t.roster.map(p => p.id), short: depth(t).short, rep: (r => r?.weeks ? { eff: +r.eff.toFixed(1), effRank: r.effRank, pf: +r.pf.toFixed(1), max: +r.max.toFixed(1), bench: +r.bench.toFixed(1), add: +r.add.toFixed(1), addRank: r.addRank, pfRank: r.pfRank, luck: +r.luck.toFixed(1), miss: r.miss, better: r.better, trades: r.trades ?? [], draft: r.draft ?? null, wire: r.wire ?? null, ap: [r.apW, r.apL], hi: [...r.scores].sort((a, b) => b[1] - a[1])[0], lo: [...r.scores].sort((a, b) => a[1] - b[1])[0] } : null)(report.get(t.id)), vs: vsData(t), moves: teamMoves.get(t.id), rec: `${t.w}-${t.l}`, now: b?.now ?? null, proj: b ? +b.proj.toFixed(1) : null,
    start: teamRows.get(t).filter(r => r[0]).map(r => r[1]), bench: teamRows.get(t).filter(r => !r[0]).map(r => r[1]) }; }), fa: faList.map(p => p.id),
  pl: Object.fromEntries([...exShown.values(), ...teams.flatMap(t => t.roster), ...faList].map(p => [p.id, lite(p)])) };
html = html.replace('__RDATA__', () => JSON.stringify(rdata).replace(/</g, '\\u003c'));
html = html.replace('__PDATA__', JSON.stringify(pdata).replace(/</g, '\\u003c'));

fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), process.env.SITE_PASSWORD ? await lockPage(html, process.env.SITE_PASSWORD) : html);
// App icons (Home Screen, browser tab) and the manifest that names the installed app
fs.cpSync(path.join(dir, 'icons'), path.join(dir, 'site'), { recursive: true });
if (cbsSaved) fs.writeFileSync(path.join(dir, 'site', 'cbs.json'), JSON.stringify(cbsSaved));
fs.writeFileSync(path.join(dir, 'site', 'ros.json'), JSON.stringify(rosSaved));
// Projections update until his game starts; what he scored is added once it's over
const r1 = v => v == null ? null : Math.round(v * 10) / 10, wkHist = srcHist.weeks[week] ??= {};
for (const p of byId.values()) {
  const g = gameNow[TEAM(p.team)]?.state;
  if (g === 'pre' && p.espn != null && [p.roto, p.cbs, p.fp].some(v => v != null)) wkHist[p.id] = [p.espn, p.roto, p.cbs, p.fp, null].map(r1);
  else if (g === 'post' && wkHist[p.id] && p.now != null) wkHist[p.id][4] = r1(p.now);
}
fs.mkdirSync(path.dirname(histFile), { recursive: true });
fs.writeFileSync(histFile, JSON.stringify(srcHist));
fs.writeFileSync(path.join(dir, 'site', 'sources.json'), JSON.stringify(srcHist));
fs.copyFileSync(path.join(dir, 'sw.js'), path.join(dir, 'site', 'sw.js'));

// Ask Claude's slow (half-price) answers that came in during the last day: one notification each
if (process.env.PUSH_SUB && process.env.SITE_PASSWORD) try {
  const r = await fetch(MOVE_URL + 'slow', { method: 'POST', headers: { 'x-live': crypto.createHash('sha256').update(process.env.SITE_PASSWORD + ':live').digest('hex') }, signal: AbortSignal.timeout(15000) });
  for (const id of (await r.json()).done ?? []) alerts.push([`slow:${id}`, 'Your Coach answer is ready', 'Tap to read it in Ask Coach.', true]);
} catch (err) { console.warn('Slow answers skipped:', err.message); }

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
// Small summary for the iPhone Home Screen widget (Scriptable).
fs.writeFileSync(path.join(dir, 'site', WIDGET), JSON.stringify({
  week, me: me.name, opp: opp?.name ?? null, myProj: n(myProj), oppProj: n(oppProj), win: winPct, live: isLive, updated: Date.now(),
  myNow: isLive ? n(mySide.totalPointsLive) : null, oppNow: isLive ? n(oppSide.totalPointsLive) : null,
  todo: todo.map(([lvl, title]) => ({ lvl, title })),
  // my starters' games this week, so while one is on the widget can show the latest play by one of them
  games: starters(me).filter(p => p.pos !== 'D/ST').flatMap(p => { const g = pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0]; return g ? [{ id: p.id, name: p.name, gid: g.id, kick: g.date }] : []; }),
}));
fs.writeFileSync(path.join(dir, 'site', 'manifest.json'), JSON.stringify({
  name: 'Gameday', short_name: 'Gameday', start_url: '.', display: 'standalone', background_color: '#0b0d10', theme_color: '#0b0d10',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}));
console.log(`Wrote site/index.html for ${me.name}, week ${week}. vs ${opp?.name}: ${n(myProj)}-${n(oppProj)}`);
todo.forEach(([l, t]) => console.log(`[${l}] ${t}`));
if (unlabeled.size) console.log(`::notice::ESPN stats with points but no label: ${[...unlabeled].join(", ")}`);
