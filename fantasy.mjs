// ESPN fantasy league report. Run: node fantasy.mjs  ->  writes site/index.html next to this file.
// Login comes from env ESPN_S2 / SWID / LEAGUE_ID (GitHub Actions) or league-config.json (local).
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, 'league-config.json');
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const ESPN_S2 = process.env.ESPN_S2 || cfg.espn_s2;
const SWID = process.env.SWID || cfg.SWID;
const LEAGUE_ID = process.env.LEAGUE_ID || cfg.leagueId;
const MOVE_URL = 'https://fantasy-workers.drbrodydisick.workers.dev/';
// fingerprint of this code: a new build with the same code only changed data, so the open page can swap it in place
const CODE = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);
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
} catch {}
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
  // Each player's own record when listed questionable or doubtful (nflverse injury reports + snap counts, last 5 seasons):
  // tagHist[name|pos] = { Q: [times listed, times played], D: [...] }. Only changes once a week, so it's reused until then.
  if (rosPrev?.tagHist && rosPrev.tagHistWeek === week) Object.assign(rosSaved, { tagHist: rosPrev.tagHist, tagHistWeek: week });
  else try {
    const csv = async url => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} on ${url.split('/').pop()}`);
      const [head, ...rows] = (await r.text()).trim().split('\n').map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(s => s.replace(/,$/, '').replace(/^"|"$/g, '')));
      return rows.map(f => Object.fromEntries(head.map((h, i) => [h, f[i]])));
    };
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
  if (p.status === 'DOUBTFUL') return { pct: 7, why: 'only about 7 in 100 doubtful players end up playing' };
  if (p.status !== 'QUESTIONABLE') return null;
  const pr = practice.get(pkey(p.name, p.pos, p.team));
  if (!pr) return { pct: 71, why: 'no practice report yet this week; about 71 in 100 questionable players end up playing' };
  const kind = ['concussion', 'knee', 'hamstring'].find(k => new RegExp(k, 'i').test(type ?? '')) ?? 'any';
  return { pct: PLAY_ODDS[kind][pr], why: `${PRACTICED[pr]}${kind === 'any' ? '' : ` (${kind} injury)`}, and players like that played ${PLAY_ODDS[kind][pr]}% of the time` };
}
function playOdds(p, type) {
  const base = leagueOdds(p, type);
  const [tags, played] = base ? rosSaved.tagHist?.[`${norm(p.name)}|${p.pos}`]?.[p.status[0]] ?? [0, 0] : [0, 0];
  if (!tags) return base;
  const pct = Math.round((played + SELF_WEIGHT * base.pct / 100) / (tags + SELF_WEIGHT) * 100);
  return { pct, base: base.pct, tags, played, why: `${base.why}. His own record: he played ${played} of ${tags} times he was listed ${p.status.toLowerCase()} since ${SEASON - 5}, so it's ${pct}%` };
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
  // expected points = average of ESPN, Rotowire and CBS, whichever have a number (none if ESPN has none, e.g. bye)
  const espn = proj?.appliedTotal ?? null, k = team === 'FA' && pos !== 'D/ST' ? [...sleeper.keys(), ...cbs.keys()].find(x => x.startsWith(`${norm(p.fullName)}|`)) ?? pkey(p.fullName, pos, team) : pkey(p.fullName, pos, team);
  const roto = espn == null ? null : sleeper.get(k) ?? null, cb = espn == null ? null : cbs.get(k) ?? null;
  const all = [espn, roto, cb].filter(v => v != null), wind = windFactor(pos, rosSaved.weather?.[TEAM(team)]);
  // ESPN's rest-of-season projection is statSourceId 1, statSplitTypeId 0 (per game = appliedAverage)
  const rosBy = [stat(p, 1, 0)?.appliedAverage ?? null, rosRoto.get(k) ?? null, rosCbs.get(k) ?? null];
  const rosAll = rosBy.filter(v => v != null);
  return {
    id: p.id, name: p.fullName, pos, proTeamId: p.proTeamId,
    team, teamName: proName[p.proTeamId] ?? 'No team', bye: proBye[p.proTeamId] ?? null,
    status: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    now: stat(p, 0, 1)?.appliedTotal ?? null, nowLine: scoring(stat(p, 0, 1)),
    pts: season?.appliedTotal ?? null, avg: season?.appliedAverage ?? null, ceiling: proj?.appliedTotalCeiling ?? null,
    proj: all.length ? all.reduce((s, v) => s + v, 0) / all.length * wind : null, wind, espn, roto, cbs: cb, split: split(all), vegas: vegas[TEAM(team)] ?? null,
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
  return { id: t.id, name: t.name.trim(), owners: t.owners, w: r.wins, l: r.losses, ties: r.ties ?? 0, div: t.divisionId ?? 0, pf: r.pointsFor, pa: r.pointsAgainst, waiver: t.waiverRank, roster };
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
// expected points this week, times his chance to play when he's questionable or doubtful (71% plays = 71% of his points)
const weekValue = p => (playable(p) && !(locked(p) && !isStarter(p)) ? (p.proj ?? 0) * ((playOdds(p, p.inj?.type)?.pct ?? 100) / 100) : 0);
// Long-term value: rest-of-season points per game (average of the sources), else his average so far
const rate = p => p.ros ?? p.avg ?? 0;
// out this week isn't out for the season: only IR or out-for-season takes him to 0 (his rest-of-season projection covers the rest)
const seasonValue = p => (p.slot !== 'IR' && p.status !== 'INJURY_RESERVE' && !p.inj?.season ? rate(p) : 0);
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
function bestSwap(roster, value, used = new Set()) {
  const sc = r => (value === weekValue ? weekScore(r) : score(r, value));
  const base = sc(roster);
  const seasonBase = score(roster, seasonValue), weekBase = weekScore(roster);
  // the next 2 weeks with byes taken out: never drop a bye-week fill-in (a second defense picked up for next
  // week looked free to drop, since it doesn't start this week or in the season-long lineup)
  const byeBase = byeScore(roster);
  // the league locks transactions: a player whose game has kicked off can't be added or dropped until next week.
  // A this-week pickup only uses a spare bench spot: a long-term keeper is never dropped for one week.
  const drops = roster.filter(p => p.slot !== 'IR' && (!HURT.includes(p.status) || p.inj?.season) && !used.has(p.id) && !locked(p) && !(value === weekValue && isKeeper(p)));
  const out = [];
  for (const add of allFa) {
    if (value(add) <= 0 || used.has(add.id) || locked(add)) continue;
    let top = null;
    for (const drop of drops) {
      const next = [...roster.filter(p => p !== drop), add];
      // a rest-of-season pickup also pays for points it costs this week (dropping someone who'd start this week), and the reverse
      const gain = sc(next) - base + (value === seasonValue ? Math.min(0, weekScore(next) - weekBase) : Math.min(0, score(next, seasonValue) - seasonBase)) + Math.min(0, byeScore(next) - byeBase);
      // on a tie, drop the weaker player
      if (!top || gain > top.gain + 0.05 || (gain > top.gain - 0.05 && weakness(drop, roster) < weakness(top.drop, roster))) top = { add, drop, gain };
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
const myStartersAt = (roster, pos) => bestLineup(roster, seasonValue).lineup.map(x => x.player).filter(p => p.pos === pos).sort((a, b) => rate(b) - rate(a));
// "Stefon Diggs (9.4), Jakobi Meyers (9.1) and Malik Washington (8.2)"
const startersText = ps => ps.map(p => `${esc(p.name)} (${n(rate(p))})`).join(', ').replace(/, (?=[^,]*$)/, ' and ');
// A team that ends a trade with fewer players (2 for 1) fills the open roster spot with the best free agent.
// That spot is real value for the side getting the one better player, so it's counted.
const faBest = allFa.filter(playable).sort((a, b) => seasonValue(b) - seasonValue(a));
const refill = (after, before) => (after.length < before.length ? [...after, ...faBest.slice(0, before.length - after.length)] : after);
// Effect of a trade on both teams. give = players I send, take = players I get.
function judge(give, take, them) {
  const mineAfter = [...me.roster.filter(p => !give.includes(p)), ...take];
  const theirsAfter = [...them.roster.filter(p => !take.includes(p)), ...give];
  return {
    mine: score(refill(mineAfter, me.roster), seasonValue) - score(me.roster, seasonValue),
    // this week: a starter of mine whose game has kicked off already scored for me, traded or not; a player
    // I'd get counts like a bench player (0 once his game has kicked off)
    mineWeek: weekScore([...me.roster.filter(p => !give.includes(p) || (locked(p) && isStarter(p))), ...take.map(p => ({ ...p, slot: 'Bench' }))]) - weekScore(me.roster),
    theirs: score(refill(theirsAfter, them.roster), seasonValue) - score(them.roster, seasonValue),
    vorGive: give.reduce((s, p) => s + vor(p), 0), vorTake: take.reduce((s, p) => s + vor(p), 0),
    after: mineAfter,
  };
}

// Trade ideas: 1-for-1, worth 2+ points a week to me, and fair to them on value over replacement.
// "Looser check" on the page also shows closer calls: 1+ a week to me, costing them up to 1.5.
// ponytail: 1-for-1 only; add 2-for-1 if this gets used a lot.
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
// up to 4 ideas per team (the page picks the team and how many show), at most 2 per player I give up
const tradePool = [];
for (const tr of trades) {
  const same = tradePool.filter(x => x.team === tr.team);
  if (same.length < 4 && same.filter(x => x.give === tr.give).length < 2) tradePool.push(tr);
}
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
  // If the re-pairing leaves any step under a point, keep the original pairing (every step was 1+ there).
  const original = plan.map(s => s.drop), drops = [...original];
  for (const s of plan) { const k = drops.findIndex(d => d.pos === s.add.pos); s.drop = drops.splice(Math.max(k, 0), 1)[0]; }
  const recount = () => {
    roster = [...baseRoster];
    for (const s of plan) {
      const value = s.kind === 'week' ? weekValue : seasonValue;
      const next = [...roster.filter(p => p !== s.drop), { ...s.add, slot: 'Bench' }];
      s.gain = (value === weekValue ? weekScore(next) - weekScore(roster) : score(next, value) - score(roster, value));
      roster = next;
    }
  };
  recount();
  if (plan.some(s => s.gain < 1)) { plan.forEach((s, i) => { s.drop = original[i]; }); recount(); }
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
const fleece = [];
// For picking any player on the page: per player, my best offer that helps me and looks fair to them, fleece or not
const bestOffer = new Map();
for (const d of tradesOpen ? partners : []) {
  // "looks fair on points per game" means nothing for a player who hasn't played yet
  // and nobody ESPN projects at 0 this week while not on bye (benched): his old average won't sell him
  const mine = me.roster.filter(p => tradeable(p) && p.avg > 0 && !(p.espn === 0 && p.bye !== week)), theirs = d.t.roster.filter(p => tradeable(p) && p.avg > 0);
  const gives = [...mine.map(p => [p]), ...mine.flatMap((a, i) => mine.slice(i + 1).map(b => [a, b]))];
  for (const give of gives) for (const take of theirs) {
    const j = judge(give, [take], d.t);
    const best = bestOffer.get(take);
    if (j.mine <= 0 || (j.mine < 1 || j.theirs > -0.5) && best && best.mine >= j.mine) continue;
    // what they'd see: their best lineup scored with season-so-far averages
    const looks = score([...d.t.roster.filter(p => p !== take), ...give], avgValue) - score(d.t.roster, avgValue);
    if (looks < -1) continue;
    const theirWeek = weekScore([...d.t.roster.filter(p => p !== take || (locked(p) && isStarter(p))), ...give.map(p => ({ ...p, slot: 'Bench' }))]) - weekScore(d.t.roster);
    const f = { d, give: [...give].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)), take, mine: j.mine, theirs: j.theirs, looks, theirWeek, strict: j.mine >= 2 && j.theirs <= -1 && looks >= 0 };
    if (!best || j.mine > best.mine) bestOffer.set(take, f);
    if (j.mine >= 1 && j.theirs <= -0.5) fleece.push(f);
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
const srcText = p => [['ESPN', p.espn], ['Rotowire', p.roto], ['CBS', p.cbs]].filter(([, v]) => v != null).map(([s, v]) => `${s} ${n(v)}`).join(', ');
// The (i) button on a suggestion: every number behind it and where it came from
const SOURCES_NOTE = "This week: average of ESPN, Rotowire (via Sleeper) and CBS Sports projections. Later weeks: ESPN only (the others don't project that far ahead). Rest of season: average of the three. Injuries and bye weeks: ESPN. Practice reports: NFL.com; chance to play: Footballguys' count of injury reports, 2017-2024, moved by each player's own record when listed (nflverse injury reports and snap counts, last 5 seasons). Rosters, waiver order and claims: your ESPN league.";
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
} catch {}
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
  if (p.bye === week) todo.push(['urgent', `Take ${p.name} out of your lineup`, `His team (${p.teamName}) has no game this week, so he'll score 0.`, bestMove, [p]]);
  else if (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && !locked(p)) todo.push(['urgent', `Take ${p.name} out of your lineup`, `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`, bestMove, [p]]);
}
for (const p of benchIn) todo.push(['urgent', `Start ${p.name}`, `He's expected to score ${n(weekValue(p))}${replaces.get(p) ? `, more than ${replaces.get(p).name} (${n(weekValue(replaces.get(p)))})` : ''}.`, bestMove, [p, replaces.get(p)].filter(Boolean)]);
const fillMove = f => ({ label: `Add ${f.add.name} on ESPN`, type: f.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: f.add.id }] });
for (const f of fills) todo.push([f.week >= 1 ? 'urgent' : 'week', f.byeFor.length ? `Add ${f.add.name} now for week ${week + 1} (${f.byeFor.map(p => p.name).join(' and ')} on bye)` : `Add ${f.add.name} (empty roster spot)`,
  `You have an empty spot on your roster, so nobody has to be dropped.${f.week >= 0.5 ? ` Adds about ${n(f.week)} points this week.` : ''}${byeText(f)} ${f.add.pos === 'D/ST' ? 'They\'re' : 'He\'s'} expected ${n(rate(f.add))} per game the rest of the season${f.season >= 0.5 ? `, which makes your lineup about ${n(f.season)} better per week` : f.rest >= 1 ? `. As a backup ${f.add.pos === 'D/ST' ? 'they add' : 'he adds'} about ${Math.round(f.rest)} points over the next two weeks by filling in when your starters are on bye` : ', a backup for injuries'}.${f.add.wa ? ` ${f.add.pos === 'D/ST' ? 'They\'re' : 'He\'s'} on waivers, so this is a claim.` : ''}${f.claim ? ` You also have a claim in for ${f.claim.add[0].name}. Keep trying for him, but make that claim drop ${f.add.name} (steps under Pending): win it and ${f.claim.add[0].name} replaces ${they(f.add) === 'they' ? 'them' : 'him'}, lose it and you still have ${f.add.name}.` : ''}`, fillMove(f), [f.add]]);
for (const [i, s] of plan.entries()) {
  todo.push([i === 0 && s.kind === 'week' && sitOut.length > benchIn.length ? 'urgent' : 'week', `Pickup step ${i + 1}: add ${s.add.name}, drop ${s.drop.name}`,
    (s.kind === 'week' ? `Adds about ${n(s.gain)} points to your score this week.` : `Makes your team about ${n(s.gain)} points per week better for the rest of the season.`) + alsoText(s.alts.map(a => a.add), s.kind === 'week' ? weekValue : rate), locked(s.add) || locked(s.drop) ? null : pickupMove(s), [s.add, s.drop]]);
}
// A better backup: free, and a backup 2+ a game better covers injuries and byes better. Only the best one, and only when the
// pickup plan doesn't already touch either player
const planIds = new Set(plan.flatMap(s => [s.add.id, s.drop.id]));
const bu = benchUps.find(x => !planIds.has(x.add.id) && !planIds.has(x.drop.id) && !locked(x.add) && !locked(x.drop));
if (bu) todo.push(['week', `Better backup: add ${bu.add.name}, drop ${bu.drop.name}`, `Neither starts for you now, so your score doesn't change, but ${bu.add.name} is expected ${n(rate(bu.add))} a game the rest of the season vs ${n(rate(bu.drop))} for ${bu.drop.name}. If a ${POS_NAME[bu.add.pos].toLowerCase()} of yours gets hurt or has a bye, that's the difference.${bu.add.wa ? " He's on waivers, so this is a claim." : ' Free agent: yours right away.'}`, pickupMove(bu), [bu.add, bu.drop]]);
// pending moves that need you: a claim to fix or cancel before waivers run, a trade offer to answer, my own bad offer
for (const m of claims) {
  const { v, stack } = claimCheck(m), fix = v[0] === 'bad' || m.better;
  if (!fix) continue;
  const why = stack ? `You'd have 3 ${m.add[0].pos === 'K' ? 'kickers' : 'defenses'}. Cancel it and claim ${m.add[0].name} again dropping ${stack.name}, so you keep ${m.drop.map(d => d.name).join(' and ')}.`
    : m.better && v[0] !== 'bad' ? `${m.better.c.name} would add about ${n(m.better.season)} a week instead of ${n(m.season)}, dropping the same player.` : `${v[1]}. Details under Pending.`;
  todo.push(['urgent', `Fix your ${m.add.map(p => p.name).join(' + ')} claim`, `${why} It goes through when waivers run ${cap(waiverDay)}.`, { label: 'Cancel this claim on ESPN', type: 'WAIVER', cancel: true, related: m.id, items: [] }, [...m.add, ...m.drop]]);
}
for (const m of pending.filter(m => m.kind === 'trade')) {
  if (!m.mineOffer) todo.push(['urgent', `Answer ${m.them.name}'s trade offer`, `You'd give ${m.give.map(p => p.name).join(', ')} for ${m.take.map(p => p.name).join(', ')}. ${m.mine >= 1 ? `Good for you: about +${n(m.mine)} a week, so accept` : m.mine <= -1 ? `Bad for you: about ${n(m.mine)} a week, so decline` : 'About even for you'}. Accept or decline under Pending.`, null, [...m.give, ...m.take]]);
  else if (m.mine <= -1) todo.push(['week', `Cancel your trade offer to ${m.them.name}`, `It would cost you about ${n(-m.mine)} points a week for the rest of the season. Cancel it under Pending.`, null, [...m.give, ...m.take]]);
}
const irUsed = me.roster.filter(p => p.slot === 'IR').length;
const dateStr = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
for (const p of me.roster) {
  if (p.status === 'INJURY_RESERVE' && p.slot !== 'IR' && irUsed < (slotCounts[21] ?? 0)) todo.push(['week', `Move ${p.name} to your IR spot`, 'He\'s hurt long-term. Putting him in the IR spot frees a bench spot for free, without dropping him.', locked(p) ? null : { label: 'Move him to IR on ESPN', type: 'ROSTER', items: [{ type: 'LINEUP', playerId: p.id, from: SLOT_ID[p.slot], to: SLOT_ID.IR }] }, [p]]);
  if (p.inj?.season && !plan.some(s => s.drop === p)) todo.push(['week', `Drop ${p.name}`, `He's out for the season (${p.inj.type?.toLowerCase() ?? 'injury'}), so he'll never score for you again. Use his spot on someone who plays.`, locked(p) ? null : { label: 'Drop him on ESPN', type: 'ROSTER', items: [{ type: 'DROP', playerId: p.id }] }, [p]]);
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
    if (w === p) todo.push(['week', `Drop ${p.name}`, `${p.inj?.back ? `He may be back around ${dateStr(p.inj.back)}, but even` : 'Even'} healthy he'd be your worst player (expected ${n(rate(p))} a game the rest of the season), so you'd drop him once he's back anyway. Holding him in IR gains nothing, and dropping him now opens the IR spot for your next injury.${locked(p) ? ` His game has started, so ESPN won't let you drop him until the week turns over (${turnNote}).` : ''}`, locked(p) ? null : { label: 'Drop him on ESPN', type: 'ROSTER', items: [{ type: 'DROP', playerId: p.id }] }, [p]]);
    else if (p.inj?.back && p.inj.back - Date.now() < 8 * 864e5) todo.push(['later', `${p.name} may be back around ${dateStr(p.inj.back)}`, `When ESPN takes him off IR you have to move him to your bench, which needs an open bench spot. Plan who you'd drop. Easiest: drop ${w.name} (expected ${n(rate(w))} a game the rest of the season).`, null, [p]]);
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
// --- Last week's recap from ESPN's box score: what my lineup scored vs the best lineup I could have set (hindsight),
// and, once there's a saved one, what the site's suggested lineup would have scored
let recap = null;
if (week > 1) try {
  const bx = await get(`${LEAGUE}?view=mBoxscore&view=mMatchupScore&scoringPeriodId=${week - 1}`);
  const g = bx.schedule.find(x => x.matchupPeriodId === week - 1 && (x.home?.teamId === me.id || x.away?.teamId === me.id));
  const [mine, theirs] = g.home.teamId === me.id ? [g.home, g.away] : [g.away, g.home];
  const ps = mine.rosterForMatchupPeriod.entries.map(e => ({ id: e.playerId, name: e.playerPoolEntry.player.fullName, pos: POS[e.playerPoolEntry.player.defaultPositionId], pts: e.playerPoolEntry.appliedStatTotal ?? 0, slot: SLOT[e.lineupSlotId] }));
  const started = ps.filter(p => p.slot !== 'Bench' && p.slot !== 'IR'), got = started.reduce((t, p) => t + p.pts, 0);
  // +100 so players who scored 0 or less still fill a spot (bestLineup skips values <= 0); the total uses real points
  const bestL = bestLineup(ps.filter(p => p.slot !== 'IR'), p => p.pts + 100);
  bestL.total = bestL.lineup.reduce((t, x) => t + x.player.pts, 0);
  const shouldIn = bestL.lineup.map(x => x.player).filter(p => !started.includes(p)).sort((a, b) => b.pts - a.pts);
  const shouldOut = started.filter(p => !bestL.lineup.some(x => x.player === p)).sort((a, b) => a.pts - b.pts);
  const advised = memo.advice?.[week - 1];
  recap = { wk: week - 1, got, opp: theirs?.totalPoints ?? null, oppName: teamName[theirs?.teamId] ?? '', best: bestL.total, misses: shouldIn.slice(0, 2).map(p => {
    const flex = ['RB', 'WR', 'TE'], k = shouldOut.findIndex(o => o.pos === p.pos), j = k >= 0 ? k : shouldOut.findIndex(o => flex.includes(o.pos) && flex.includes(p.pos));
    return j >= 0 ? [p, shouldOut.splice(j, 1)[0]] : null;
  }).filter(Boolean),
    site: advised ? ps.filter(p => advised.includes(p.id)).reduce((t, p) => t + p.pts, 0) : null };
  // for "why you won or lost" (worked out further down, once whyWeek's data is ready): each starter's ESPN player entry
  recap.started = started.map(p => ({ ...p, pl: mine.rosterForMatchupPeriod.entries.find(e => e.playerId === p.id).playerPoolEntry.player }));
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
const swapped = new Map(); // starter id -> who went in for him
for (const p of starters(me)) {
  const gone = HURT.includes(p.status) || inactive.has(p.id), doubt = !gone && p.status === 'DOUBTFUL' && soon(p, 1);
  if (!(gone && soon(p, 2)) && !doubt) continue;
  const slot = SLOT_ID[p.slot], sub = me.roster.filter(b => b.slot === 'Bench' && notStarted(b) && !HURT.includes(b.status) && b.status !== 'DOUBTFUL' && b.bye !== week &&
    SLOT_POS[slot]?.includes(b.pos) && ![...swapped.values()].includes(b) && weekValue(b) > 0).sort((a, b) => weekValue(b) - weekValue(a))[0];
  if (!sub || (doubt && weekValue(sub) <= (p.proj ?? 0))) continue;
  const r = await fetch(`https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}/transactions/`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ isLeagueManager: false, teamId: me.id, type: 'ROSTER', scoringPeriodId: league.scoringPeriodId, executionType: 'EXECUTE',
      items: [{ playerId: p.id, type: 'LINEUP', fromLineupSlotId: slot, toLineupSlotId: SLOT_ID.Bench }, { playerId: sub.id, type: 'LINEUP', fromLineupSlotId: SLOT_ID.Bench, toLineupSlotId: slot }] }),
  }).catch(err => ({ ok: false, json: async () => ({ messages: [err.message] }) }));
  if (r.ok) { swapped.set(p.id, sub); console.log(`Auto swap: benched ${p.name} (${inactive.has(p.id) ? 'inactive' : p.status}), started ${sub.name}`); continue; }
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
    ? [`q:${week}:${p.id}:${p.status}`, `${p.name} is playing`, bestIds.has(p.id) ? (starting ? 'He\'s in your lineup. Keep him there.' : 'Start him: he\'s in your best lineup.') : (starting ? 'He\'s playing, but someone on your bench is expected to score more. Check your to-do list.' : 'Keep him on your bench.'), true]
    : [`q:${week}:${p.id}:${p.status}`, `${p.name} ${p.status === 'DOUBTFUL' ? 'probably won\'t play' : p.status === 'OUT' ? 'is out' : 'won\'t play'}`, swapped.has(p.id) ? `The app benched him and started ${swapped.get(p.id).name} on ESPN.` : starting ? `He's in your lineup, so swap him out in the ESPN app${soon(p, 2) ? ' now' : ', or the app will 2 hours before his game'}.` : 'He\'s on your bench, so there\'s nothing to do.', true]);
}
memo.q = Object.fromEntries(me.roster.filter(p => ['QUESTIONABLE', 'DOUBTFUL'].includes(p.status) && notStarted(p)).map(p => [p.id, p.status]));
// Starter who won't play (bye, out, doubtful, IR, suspended)
for (const p of starters(me)) {
  const bye = p.bye === week;
  if (swapped.has(p.id) && !decided.has(p.id)) { alerts.push([`auto:${week}:${p.id}`, `${p.name} is out`, `The app benched him and started ${swapped.get(p.id).name} on ESPN.`, true]); continue; }
  if (decided.has(p.id) || !(bye || (['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.status) && notStarted(p)))) continue;
  alerts.push([`out:${week}:${p.id}`, `Bench ${p.name}`, `${bye ? 'His team has no game this week, so he\'d score 0.' : `${STATUS[p.status][0]}. If he doesn't play, he scores 0.`} Your to-do list shows who to start instead.`, !bye && soon(p, 3)]);
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
  alerts.push([`wrem:${week}`, `Waivers run ${cap(waiverDay)}`, `Claim ${s.add.name} and drop ${s.drop.name}: ${s.kind === 'week' ? `about ${n(s.gain)} more points this week` : `about ${n(s.gain)} more points per week`}. More ideas in the app.`, false]);
}
// Someone available beats a player you have, or fills an empty spot: tell me once per player per week, as soon as it shows up
for (const s of plan) alerts.push([`pickup:${week}:${s.add.id}`, `${s.add.name} is better than ${s.drop.name}`,
  `${s.kind === 'week' ? `About ${n(s.gain)} more points this week` : `About ${n(s.gain)} more points per week`}. ${s.add.wa ? 'On waivers, so put in a claim' : 'Free agent, so you can add him now'}.`, s.kind === 'week']);
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
    if (!bad && usual != null && fgm >= avg(4) + 1.5) out.push(`Lots of kicks: ${fgm} field goals made (usually about ${avg(4)}). His offense kept getting close but stalling.`);
    if (!bad && long) out.push(`Made ${long > 1 ? `${long} field goals` : 'a field goal'} from 50+ yards, worth extra points.`);
    if (!bad && xpm >= 4) out.push(`${xpm} extra points: his team scored a lot of touchdowns.`);
  } else {
    const [, opp, , allowed, sacks, ints, fum, tds] = w, to = ints + fum, usualTo = avg(5) + avg(6), usualSacks = avg(4);
    if (bad && allowed >= 24) out.push(`Gave up ${allowed} points. Points allowed is the biggest part of a defense's score.`);
    else if (good && allowed <= 13) out.push(`Gave up only ${allowed} points. Points allowed is the biggest part of a defense's score.`);
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
  if (blowout && margin > 0 && p.pos === 'RB' && !bad) out.push(`His team won ${sc[0]}–${sc[1]}. Teams far ahead run the ball a lot to use up the clock, which helps running backs.`);
  else if (blowout && !good) out.push(`His team ${margin > 0 ? 'won' : 'lost'} ${sc[0]}–${sc[1]}.${margin > 0 ? ' Teams far ahead stop passing late to use up the clock, and starters can sit.'
    : p.pos === 'RB' ? ' Teams that fall far behind stop running the ball and pass to catch up.' : ' A blowout loss usually means few good drives for the whole offense, and starters can sit late.'}`);
  // quarterback: pulled partway through (only when the usual starter really started: 5+ passes), or threw interceptions
  const squad = Object.entries(wd).filter(([key]) => key.endsWith('|' + team)), qbs = squad.filter(([, v]) => v[11] === 'QB' && v[9] >= 3).sort((a, b) => b[1][9] - a[1][9]);
  const uq = usualStarters(team).find(s => s.pos === 'QB'), sub = wd[uq?.k]?.[9] >= 5 && qbs.find(([key]) => key !== uq.k);
  const qb = qbs[0]?.[1], qbBad = !!sub || qb?.[10] >= 2;
  if (!good) {
    if (sub) out.push(uq.k === k ? `He was pulled for ${sub[1][12]}, who threw ${sub[1][9]} passes. Losing part of the game costs a QB a lot of points.`
      : sub[0] === k ? `He came in for ${uq.name} partway through, so he only played part of the game.`
      : `${uq.name} was pulled for ${sub[1][12]} partway through. Switching quarterbacks mid-game usually stalls the passing game.`);
    if (qb?.[10] >= 2) out.push(qbs[0][0] === k ? `He threw ${qb[10]} interceptions. Each one costs points and ends a drive.` : `${qb[12]}, his QB, threw ${qb[10]} interceptions, which ended drives and cost everyone chances.`);
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
    if (bad && w[6] === 0 && tds >= 3) out.push(`No touchdown. He has ${tds} in his other games, and each is worth 6 points, so a week without one hurts a lot.`);
    else if (!bad && w[6] >= 1 && (good || w[6] >= 2)) out.push(`He scored ${w[6] > 1 ? `${w[6]} touchdowns` : 'a touchdown'}, ${w[6] * 6} of his ${n(pts)} points.`);
  }
  const r = defRank(p.pos, w[1]), of = Object.keys(rosSaved.allowed?.[p.pos] ?? {}).length;
  if (!good && r && r > of - 6) out.push(`He faced ${w[1]}, one of the toughest defenses against ${POS_PL[p.pos]} (${ordinal(of - r + 1)} fewest points given up).`);
  else if (!bad && r && r <= 6) out.push(`He faced ${w[1]}, one of the easiest defenses for ${POS_PL[p.pos]} (${ordinal(r)} most points given up).`);
  for (const st of usualStarters(team)) {
    // missing only counts if he'd already played for them (a backup who took over later wasn't "missing" before that)
    if (st.k === k || wd[st.k] || !Object.entries(rosSaved.weeks).some(([w2, x]) => +w2 < wk && x[st.k])) continue;
    if (st.pos === 'QB') { if (!good) out.push(`His team's usual quarterback, ${st.name}, didn't play, so a backup was throwing. That usually means fewer points for everyone on the team.`); }
    else if (st.pos === p.pos) { if (!bad) out.push(`${st.name}, another top ${POS_ONE[p.pos]} on his team, didn't play, so more of the ball could go his way.`); }
    else out.push(`${st.name}, his team's top ${POS_ONE[st.pos]}, didn't play.`);
  }
  if (out.length === head) {
    if (bad) out.push('Nothing obvious: he played his usual snaps against an average defense with his main teammates. Some weeks just go this way.');
    else if (good) out.push('Nothing unusual about the setup: he just had a big game.');
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
    disagree: SLP_OUT.includes(sl) && !out ? `Injury reports disagree: ESPN says he ${ESPN_WORD[e] ?? 'is healthy'}, but Sleeper still lists him as ${sl === 'IR' ? 'on IR' : sl.toLowerCase()}. Check again before kickoff; teams announce who's out about 90 minutes before the game.` : null };
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
      + (p.wind < 1 ? ` Wind over 15 mph cuts ${p.pos === 'K' ? 'kicking' : 'passing'}, so his number is lowered ${Math.round((1 - p.wind) * 100)}%.` : p.pos === 'RB' && w.wind >= 15 ? ' Windy games lean on the run, which can help him.' : ''));
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
    else if (u.shareNow >= 25) out.push(`He gets ${u.shareNow}% of his team's ${u.kind}, a big share. Steady volume like that is the most reliable thing in fantasy.`);
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
function luck(p) {
  const k = pkey(p.name, p.pos, p.team), r = tdRate[p.pos];
  if (r == null) return null;
  const games = Object.keys(rosSaved.weeks ?? {}).map(Number).sort((a, b) => b - a).map(w => rosSaved.weeks[w][k]).filter(g => g && g[6] != null).slice(0, 5);
  if (games.length < 3) return null;
  const tot = i => games.reduce((s, g) => s + g[i], 0), got = tot(2) / games.length, td = tot(6), rz = tot(5);
  const gap = (td - rz * r) * 6 / games.length; // a rushing or receiving TD is 6 points
  return { games: games.length, got, worth: got - gap, gap, td, rz, exp: rz * r };
}
const roleText = l => `${l.td} touchdown${l.td === 1 ? '' : 's'} on ${l.rz} chances near the goal line in ${l.games} games (about ${n(l.exp)} is normal)`;
const sellHigh = me.roster.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && playable(p)).map(p => ({ p, l: luck(p) })).filter(x => x.l && x.l.gap >= 3 && x.l.got >= 8).sort((a, b) => b.l.gap - a.l.gap);
const buyLow = teams.filter(t => t !== me).flatMap(t => t.roster.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && playable(p)).map(p => ({ p, t, l: luck(p) })))
  .filter(x => x.l && x.l.gap <= -3 && x.l.worth >= 8).sort((a, b) => a.l.gap - b.l.gap).slice(0, 8);

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
  if (mode === 'out') say.push('Out of the playoff race. Teams like this often stop caring or sell good players cheap, so a low offer can work.');
  else if (mode === 'longshot') say.push(`${gb} game${gb === 1 ? '' : 's'} out of a playoff spot with ${gamesLeft} left, so they need wins now and will take risks for points this week.`);
  else if (mode === 'bubble') say.push('Fighting for a playoff spot, so help this week is worth more to them than help later.');
  else if (mode === 'safe') say.push('Comfortably in the playoffs, so they\'re not desperate. Expect them to want a clear upgrade.');
  if (hurt.length) say.push(`Missing ${hurt.map(p => `${p.name} (${p.pos}, ${STATUS[p.status]?.[0].toLowerCase() ?? 'out'})`).join(', ')}, so a healthy ${[...new Set(hurt.map(p => POS_NAME[p.pos].toLowerCase()))].join('/')} is worth extra to them right now.`);
  say.push(deals >= 4 ? `Busy manager: ${deals} adds, drops or trade offers in 3 weeks, so open to offers.` : deals === 0 ? 'No moves in 3 weeks; may ignore offers, so keep it simple and clearly good for them.' : `${deals} move${deals === 1 ? '' : 's'} in 3 weeks.`);
  return { rank, mode, hurt, deals, record: `${t.w}-${t.l}${t.ties ? `-${t.ties}` : ''}`, say };
}
const profiles = new Map(teams.filter(t => t !== me).map(t => [t, profile(t)]));
const MODE_WORD = { safe: 'safe in the playoffs', bubble: 'on the playoff bubble', longshot: 'long shot for the playoffs', out: 'out of the race' };
const situation = t => { const pr = profiles.get(t); return pr ? `${pr.record}, ${ordinal(pr.rank)}${pr.mode ? `, ${MODE_WORD[pr.mode]}` : ''}${pr.hurt.length ? `, missing ${pr.hurt.map(p => p.name).join(' and ')}` : ''}` : ''; };

// To-do and alerts for the new finds. Only big ones push (Brody's pick): a fill-in who'd start for me.
// Breakouts and buy low / sell high stay in the app.
const firstLater = todo.findIndex(x => x[0] !== 'urgent');
todo.splice(firstLater < 0 ? todo.length : firstLater, 0, ...fillIns.filter(f => f.p && f.gain >= 0.5).map(f => ['urgent', `Grab ${f.name} before anyone else`,
  `${f.starter.name} ${f.word}, so ${f.name} should take over as ${f.team}'s ${POS_NAME[f.pos].toLowerCase()}${f.long ? ' for a while' : ' this week'}. Nobody in your league has him yet and the experts' numbers haven't caught up. Starting work like that would add about ${n(f.gain)} a week to your lineup.${f.drop ? ` To make room, drop ${f.drop.name}.` : ''}`,
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
// his spot on his NFL team's depth chart: 1 = starter, 2 = 2nd string... (receivers: 1st at any of the three WR spots is a starter)
const depthAt = new Map(), dkey = (team, name) => team + '|' + norm(name).replace(/ (jr|sr|ii|iii|iv|v)$/, ''); // Sleeper often drops the Jr.
for (const [team, chart] of Object.entries(rosSaved.depth ?? {})) for (const [, o, name] of chart) { const k = dkey(team, name); if (!(depthAt.get(k) <= o)) depthAt.set(k, o); }
const depthWord = p => { if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(p.pos)) return ''; const o = depthAt.get(dkey(TEAM(p.team), p.name));
  return !o ? '' : o === 1 ? 'Starter' : o === 2 ? 'Backup' : ordinal(o); };
const shown = new Map();
const player = (p, extra = '') => { shown.set(p.id, p); return `<div class="player" data-pid="${p.id}" role="button" tabindex="0">${pic(p)}<div class="who">
  <div class="name">${esc(p.name)} <span class="more">&rsaquo;</span></div>
  <div class="meta"><span class="pos pos-${p.pos.replace('/', '')}">${p.pos}</span> ${esc(p.teamName)}${p.bye ? ` &middot; bye wk ${p.bye}` : ''}</div>
  ${(r => r.length ? `<div class="rank">${r.join(' &middot; ')}</div>` : '')([rankText(p), depthWord(p), hitLine(p)?.[0]].filter(Boolean))}<span data-chip="${p.id}" data-st="${p.status || 'ACTIVE'}">${chip(p)}</span>${extra}</div></div>`; };
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
  return [`Caught ${rec}/${tgt} (${pctOf(rec, tgt)})`, `Caught ${rec} of the ${tgt} passes thrown to him (${pctOf(rec, tgt)}${all?.[1] ? `; the average ${POS_NAME[p.pos].toLowerCase()} catches ${pctOf(...all)}` : ''}). Deep throws are caught less often, so a deep threat's number runs lower.`];
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
const big = (v, label, ceiling, p, kind) => { const t = tier(v, p, kind); return `<div class="big"><b${t ? ` class="t-${t[0]}"` : ''}${kind === 'week' && p ? liveBig(p) : ''}>${n(v)}</b>${t ? `<small class="tw t-${t[0]}">${t[1]}</small>` : ''}<small>${label}</small>${ceiling > v + 1 ? `<small class="up">up to ${Math.round(ceiling)}</small>` : ''}</div>`; };

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
const SIMS = 10000, byRecord = {};
let made = 0;
for (let k = 0; k < SIMS; k++) {
  const w = new Map(teams.map(t => [t.id, t.w + t.ties / 2])), pf = new Map(teams.map(t => [t.id, t.pf]));
  for (const g of left) {
    const [a, b] = [g.home, g.away].map(side => {
      const t = byId_.get(side.teamId), now = g.matchupPeriodId === week, fut = futLine.get(`${t.id}|${g.matchupPeriodId}`);
      if (!now) return fut.mean + gauss() * fut.sd;
      return (isLive && side.totalProjectedPointsLive > 0 ? side.totalProjectedPointsLive : nowMean.get(t.id)) + gauss() * nowSd.get(t.id);
    });
    pf.set(g.home.teamId, pf.get(g.home.teamId) + a); pf.set(g.away.teamId, pf.get(g.away.teamId) + b);
    const winner = a >= b ? g.home.teamId : g.away.teamId;
    w.set(winner, w.get(winner) + 1);
  }
  const inP = seedOrder(w, pf).order.indexOf(me) < playoffTeams;
  made += inP;
  const r = (byRecord[w.get(me.id)] ??= [0, 0]); r[0] += inP; r[1]++;
}
const playoffPct = Math.round(made / SIMS * 100);
// records that happen in at least 5% of seasons, with how often each one got in
const recordOdds = Object.entries(byRecord).filter(([, [, c]]) => c >= SIMS * 0.05).map(([wins, [m, c]]) => [+wins, Math.round(m / c * 100)]).sort((a, b) => b[0] - a[0]);
const fixedProj = best.total;
// projected score after pending claims and the to-do list (best lineup from that roster)
const planProj = weekScore(baseRoster) + weekPlanGain;
const lineupRows = [...me.roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
// the matchup line under the scores: 'final' = all games over, 'decided' = ESPN gives 0% or 100%
const verdictText = (win, by, how) => how === 'final' ? `<b style="color:var(--${win ? 'good' : 'bad'})">You ${win ? 'won' : 'lost'}</b> by ${by} points. Final.`
  : how === 'decided' ? `<b style="color:var(--${win ? 'good' : 'bad'})">${win ? 'Locked up' : 'Out of reach'}:</b> you'll ${win ? 'win' : 'lose'} by about ${by} points. ESPN gives ${win ? 'them' : 'you'} no chance with the games left.`
  : `<b style="color:var(--${win ? 'good' : 'bad'})">You're expected to ${win ? 'win' : 'lose'}</b> by ${by} points.`;
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
  opp ? `This week vs ${opp.name} (${opp.w}-${opp.l}): projected ${n(myProj)} to ${n(oppProj)}, win chance ${winPct}%${liveWin ? ' (ESPN live estimate)' : ''}.` : '',
  `${week > lastWeek ? '' : `Playoff chance: ${playoffPct}% (top ${playoffTeams} of ${teams.length}, simulated).`}${recap ? ` Last week (wk ${recap.wk}) I scored ${n(recap.got)}${recap.opp != null ? ` vs ${n(recap.opp)}` : ''}; best possible lineup was ${n(recap.best)}.` : ''}`,
  `Starters:\n${starters(me).map(p => `- ${p.slot}: ${line(p)}`).join('\n')}`,
  `Bench:\n${me.roster.filter(p => p.slot === 'Bench').map(p => `- ${line(p)}`).join('\n')}`,
  me.roster.some(p => p.slot === 'IR') ? `IR:\n${me.roster.filter(p => p.slot === 'IR').map(p => `- ${line(p)}`).join('\n')}` : '',
  pending.length ? `Pending moves:\n${pending.map(m => m.kind === 'waiver' ? `- Waiver claim: add ${m.add.map(p => p.name).join(', ')}, drop ${m.drop.map(p => p.name).join(', ')}`
    : `- Trade ${m.mineOffer ? 'I offered' : 'offered to me by'} ${m.them.name}: I give ${m.give.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}; I get ${m.take.map(p => `${p.name} (${p.pos}, ${n(rate(p))}/g ahead)`).join(', ')}`).join('\n')}` : '',
  `Best free agents (points per game expected rest of season, expected this week):\n${Object.entries(fa).map(([pos, list]) => `- ${pos}: ${[...list].filter(p => !HURT.includes(p.status)).sort((a, b) => rate(b) - rate(a)).slice(0, 4).map(p => `${p.name} ${n(rate(p))}/g ahead, ${n(p.proj)} exp`).join('; ')}`).join('\n')}`,
  ahead.length ? `My remaining schedule: ${ahead.map(g => `wk ${g.week} ${g.t.name} (${g.t.w}-${g.t.l}, projected ${n(g.proj)} that week${g.off.length ? `, without ${g.off.map(p => p.name).join(', ')}` : ''})`).join('; ')}.` : '',
  '__NEWSFACTS__',
  'Explain things simply, I\'m new to football. My question:',
].filter(Boolean).join('\n\n');

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Fantasy"><meta name="theme-color" content="#0b0d10"><meta name="color-scheme" content="dark">
<meta name="built" content="${Date.now()}"><meta name="code" content="${CODE}">
<link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="manifest" href="manifest.json">
<title>${esc(me.name)}</title>
<script>try { const l = localStorage.getItem('look'); if (l !== 'classic') document.documentElement.classList.add(l === 'glass' ? 'glass' : 'term'); } catch { document.documentElement.classList.add('term'); }</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
/* Stadium Lime: dark only. Graphite surfaces, one lime accent (matches the ESPN Fantasy icon); green/amber/red mean good/so-so/bad. */
:root{color-scheme:dark;--bg:#0b0d10;--card:#15181d;--fg:#f2f4f7;--muted:#9aa3b2;--line:#232830;--accent:#c6f432;--onaccent:#0b0d10;
--good:#3ddc84;--goodbg:#0f2a1c;--warn:#ffb23f;--warnbg:#2e2310;--bad:#ff5c5c;--badbg:#341616;--chip:#1e2229;--glass:rgba(21,24,29,.72);--glassline:rgba(255,255,255,.08);
--num:'Geist Mono',ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
/* The body scrolls, not the page: iOS 26 moves fixed bars (the tab bar) up and down while the page itself scrolls */
body{height:100%;overflow-y:auto;scroll-behavior:smooth;scroll-padding-top:calc(env(safe-area-inset-top) + 12px);margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Geist,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
/* Home screen app: 100% stops a status bar's height short of the bottom, 100vh is the whole screen */
@media (display-mode:standalone){html,body{height:100vh}}
button,a,summary,[role=button]{touch-action:manipulation}
button,nav a,summary{-webkit-user-select:none;user-select:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
.wrap{max-width:720px;margin:0 auto;padding:0 16px calc(120px + env(safe-area-inset-bottom))}
body::before{content:'';position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top);z-index:6;background:var(--glass);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
header{background:radial-gradient(120% 90% at 85% 0%,rgba(198,244,50,.10),transparent 60%),linear-gradient(180deg,#161a20,var(--bg));color:var(--fg);padding:calc(env(safe-area-inset-top) + 18px) 0 56px}
header .wrap{padding-bottom:0}
.league{color:var(--muted);font-size:13px;font-weight:500}
h1{font-size:28px;font-weight:700;margin:6px 0 2px;letter-spacing:-.025em;line-height:1.1}
.record{font-size:14px;color:var(--muted)}
.match{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:20px;padding:16px;margin:-40px 0 16px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
.match h2{margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.vs{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center}
.vs .t{font-weight:600;overflow-wrap:anywhere}.vs .p{font:600 18px var(--num);text-align:right}
.bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--chip);overflow:hidden;margin-bottom:6px}.bar i{display:block;height:100%;border-radius:3px}
.verdict{margin-top:8px;font-size:14px}
/* Bottom bar, frosted glass like iOS. Fixed so it's always one tap away. */
nav{position:fixed;left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 80px));bottom:calc(env(safe-area-inset-bottom) + 8px);z-index:10;display:flex;gap:2px;padding:4px;border-radius:24px;background:var(--glass);border:1px solid var(--glassline);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
/* 5 tabs that all fit: icon over label, like a phone app */
nav a{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 0 6px;border-radius:20px;color:var(--muted);text-decoration:none;font-weight:600;font-size:11px;line-height:14px;transition:background .2s,color .2s,transform .1s ease-out}
nav svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
nav{touch-action:none}nav a,#fab{-webkit-touch-callout:none}
nav a.on{color:var(--accent);background:rgba(198,244,50,.1)}
nav a.press{background:rgba(255,255,255,.14);color:var(--fg);transform:scale(1.1)}
nav .dot{position:absolute;top:3px;left:calc(50% + 6px);min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--bad);color:#fff;font-size:10px;line-height:16px;text-align:center}
/* the switch at the top of a tab that holds two or more pages (Moves, Trades, More) */
.seg{display:flex;gap:3px;margin-top:20px;padding:3px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
.seg button{flex:1;padding:9px 4px;border:0;border-radius:9px;background:none;color:var(--muted);font:600 13px Geist,system-ui,sans-serif;cursor:pointer}
.seg button.on{background:var(--line);color:var(--fg)}
/* sections and lists you tap to open */
details.fold{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:0 14px;margin:0 0 10px}
details.fold>summary{align-items:center;padding:14px 0;margin:0}details.fold>summary h2,details.fold>summary.group{margin:0;font-size:17px}
details.fold>summary.group{text-transform:none;letter-spacing:0;color:var(--fg)}
details.fold[open]>summary{margin-bottom:4px}details.fold .card{background:var(--bg)}
section:has(>details.fold){margin-top:12px}
section{margin-top:26px}h2{font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.card{background:var(--card);border-radius:16px;padding:14px;margin-bottom:10px;border:1px solid var(--line)}
.todo{display:flex;gap:12px;align-items:flex-start}
.todo .lvl{flex:none;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:6px;margin-top:2px}
.lvl.urgent{background:var(--badbg);color:var(--bad)}.lvl.week{background:var(--warnbg);color:var(--warn)}.lvl.later{background:var(--chip);color:var(--muted)}
details.info{margin-top:6px}details.info>summary{list-style:none;position:relative;display:inline-grid;place-items:center;place-content:center;width:22px;height:22px;border-radius:50%;border:1.5px solid var(--muted);color:var(--muted);font:italic 700 13px/1 Georgia,serif;cursor:pointer}
details.info>summary::before{content:'';position:absolute;inset:-11px}/* 44px tap area around the small (i) */details.info>summary::-webkit-details-marker{display:none}details.info[open]>summary{color:var(--fg);border-color:var(--fg);margin-bottom:0}
/* the generic details "+" marker hung under the (i) circle */details.info>summary::after,details.info[open]>summary::after{content:none}details.info>div{margin-top:6px;font-size:13px;color:var(--muted)}details.info p{margin:0 0 4px}
.tpics{display:flex;gap:6px;margin:6px 0 2px}.tpics .pic{width:36px;height:36px}.tpics [data-pid]{cursor:pointer}
.todo b{display:block;font-size:15px}.todo p{margin:2px 0 0;color:var(--muted);font-size:14px}
.player{display:flex;gap:12px;align-items:center;min-width:0;flex:1}
.pic{flex:none;width:48px;height:48px;border-radius:50%;background:var(--chip);overflow:hidden;position:relative;display:grid;place-items:center}
.pic::before{content:attr(data-i);font-weight:700;color:var(--muted);font-size:14px}
.pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.pic.logo img{object-fit:contain;padding:6px}
.who{min-width:0}.name{font-weight:700;line-height:1.25;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:13px;line-height:1.35}
.pos{display:inline-block;font-size:11px;font-weight:800;padding:1px 6px;border-radius:5px;color:#fff;margin-right:2px;vertical-align:1px}
.pos-QB{background:#e5484d}.pos-RB{background:#12a150}.pos-WR{background:#3e63dd}.pos-TE{background:#f76b15}.pos-K{background:#8e4ec6}.pos-DST{background:#646f82}
.chip{display:inline-block;margin-top:4px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px}
.chip.bad{background:var(--badbg);color:var(--bad)}.chip.good{background:var(--goodbg);color:var(--good)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.row{display:flex;align-items:center;gap:10px}
.slot{flex:none;width:30px;font-size:10px;font-weight:700;letter-spacing:.02em;color:var(--muted);text-transform:uppercase}
.big{flex:none;text-align:right;max-width:84px}.big b{display:block;font:600 21px/1.1 var(--num);letter-spacing:-.02em}.big small{display:block;font-size:11px;line-height:1.3;color:var(--muted)}
/* lineup slot (QB/RB/FLEX) as a small corner tag instead of its own column: gives the player name ~40px more on a phone */
.card.row{position:relative}.card.row .slot{position:absolute;left:12px;top:10px;width:auto;font-size:9px;line-height:1;padding:3px 5px;border-radius:4px;background:var(--chip)}
.card.row .slot:empty{display:none}.card.row .slot:not(:empty)+.player{padding-top:8px}
@media (max-width:420px){.card.row .pic{width:42px;height:42px}.card.row{gap:8px}}
.big small.up{color:var(--good);font-weight:600}
.big .t-good{color:var(--good)}.big .t-weak{color:var(--warn)}.big small.tw{font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:11px}
.rank{font-size:12px;color:var(--muted);line-height:1.35}
.btn{background:var(--accent);color:var(--onaccent);border:0;border-radius:12px;padding:13px 16px;min-height:46px;font:600 15px Geist,system-ui,sans-serif;cursor:pointer;width:100%;margin-top:10px;transition:transform .1s ease-out,filter .1s}
.btn:active{transform:scale(.97);filter:brightness(.9)}
.ask{display:grid;gap:2px}.askout{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:15px;line-height:1.5}.askout p{margin:0 0 8px}.askout p:last-child{margin:0}.askout ul{margin:0 0 8px;padding-left:20px}.linkbtn{background:none;border:0;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;padding:10px 0 0;cursor:pointer;justify-self:center}
.chg{padding:8px 10px;border-radius:10px;margin-bottom:6px;font-size:14px;font-weight:600;background:var(--chip)}
.chg.good{background:var(--goodbg);color:var(--good)}.chg.bad{background:var(--badbg);color:var(--bad)}
.lnk{text-decoration:underline dotted;text-underline-offset:3px;color:var(--fg)}
[data-pid]{cursor:pointer;-webkit-tap-highlight-color:transparent}.more{color:var(--muted);font-weight:400}
#sheet{position:fixed;inset:0;z-index:20}.sheet-bg{position:absolute;inset:0;background:rgba(5,10,25,.55)}
.sheet-card{position:absolute;left:0;right:0;bottom:0;max-width:720px;margin:0 auto;max-height:88vh;max-height:88dvh;background:var(--bg);border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;animation:up .35s cubic-bezier(.32,.72,0,1)}
.sheet-card.closing{animation:down .2s cubic-bezier(.4,0,1,1) forwards}
@keyframes up{from{transform:translateY(100%)}}@keyframes down{to{transform:translateY(100%)}}
.sheet-body{overflow-y:auto;padding:20px 16px calc(24px + env(safe-area-inset-bottom))}
.sheet-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border-radius:50%;border:0;background:var(--chip);color:var(--fg);font-size:22px;line-height:1;cursor:pointer;z-index:1}
.sheet-x::after{content:'';position:absolute;inset:-5px}/* 44px tap area around the 34px close button */
.sh-top{display:flex;gap:14px;align-items:center;margin-bottom:14px;padding-right:40px}.sh-top .pic{width:64px;height:64px}
.sh-name{font-size:20px;font-weight:800}
.sh-q{border-radius:14px;padding:12px 14px;margin-bottom:10px;background:var(--card);border:1px solid var(--line)}
.sh-q small{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.sh-q b{display:block;font-size:16px;margin:2px 0}.sh-q span{font-size:13px;color:var(--muted)}
.sh-q.yes{border-left:4px solid var(--good)}.sh-q.no{border-left:4px solid var(--bad)}.sh-q.maybe{border-left:4px solid var(--warn)}
.bars{display:flex;gap:8px;align-items:flex-end;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.bars div{flex:1;text-align:center}.bars i{display:block;background:var(--accent);border-radius:4px 4px 0 0;margin:0 auto 4px;width:70%}
.bars b{display:block;font-size:13px}.bars small{font-size:11px;color:var(--muted)}
a.news{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;color:var(--fg);text-decoration:none}
a.news b{display:block;font-size:14px;font-weight:600}a.news .nsnip{display:block;font-size:13px;color:var(--muted);margin:3px 0 2px}a.news small{color:var(--muted);font-size:12px}
.wp{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}.wp b{font:600 44px/1 var(--num);letter-spacing:-.04em}
.live{display:inline-block;background:var(--badbg);color:var(--bad);font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:2px}
.stat{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat div{background:var(--chip);border-radius:12px;padding:10px}.stat b{display:block;font:600 20px var(--num)}.stat small{color:var(--muted);font-size:12px}
.lv{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase}.lv.hard{background:var(--badbg);color:var(--bad)}.lv.medium{background:var(--warnbg);color:var(--warn)}.lv.easy{background:var(--goodbg);color:var(--good)}
.list .card{margin-bottom:0;border-radius:0;border-bottom:none}.list .card:first-child{border-radius:16px 16px 0 0}.list .card:last-child{border-radius:0 0 16px 16px;border-bottom:1px solid var(--line)}
.list .card:only-child{border-radius:16px}
.group{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 8px}
.swap{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.row{min-width:0}
.arrow{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase}
.arrow::after{content:"";flex:1;height:1px;background:var(--line)}
.gain{display:inline-block;background:var(--goodbg);color:var(--good);font-weight:800;padding:4px 10px;border-radius:8px;font-size:14px}
.why{color:var(--muted);font-size:14px;margin:10px 0 0}
[hidden]{display:none!important}
html:not(.term):not(.glass) #bg-field,html:not(.term) .bgring{display:none}
.gl{text-decoration:underline dotted var(--accent);text-decoration-thickness:1.5px;text-underline-offset:3px;cursor:help}
#gloss{position:fixed;z-index:30;background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.45;max-width:min(320px,calc(100vw - 32px));box-shadow:0 8px 24px rgba(0,0,0,.5)}
#gloss b{color:var(--accent);display:block;margin-bottom:2px}
.pline{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:14px}
.plays{margin-top:10px}.plays summary{cursor:pointer;font-size:14px}.plays p{margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.4}
.plays small{font-family:var(--num);color:var(--fg);margin-right:4px}.plays .td{color:var(--accent)}
.nowpts{font-size:12px;color:var(--muted);margin-top:2px}.card.row:has(.nowpts[data-ball="1"]),.card.row:has(.nowpts[data-ball="2"]){--c:var(--warn);background:color-mix(in srgb,var(--c) 30%,var(--card));border-color:var(--c)}.card.row:has(.nowpts[data-ball="2"]){--c:var(--bad)}
/* in a stacked list the next card draws the line under him, so paint it in his color */
.list .card.row:not(:last-child):has(.nowpts[data-ball="1"],.nowpts[data-ball="2"]){z-index:1;box-shadow:0 1px 0 var(--c)}
#todo h2 .dot{display:inline-block;vertical-align:middle;min-width:20px;height:20px;padding:0 6px;margin-left:6px;border-radius:99px;background:var(--bad);color:#fff;font-size:12px;line-height:20px;text-align:center}#todo h2 .dot[hidden]{display:none}.nowpts b{color:var(--accent);font-family:var(--num)}
.tag{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:9px 4px;border-bottom:1px solid var(--line)}
td.num{text-align:right;font-family:var(--num);font-size:13px;color:var(--muted);white-space:nowrap}tr.me td{font-weight:800;color:var(--fg)}
tr.cut td{border-bottom:2px dashed var(--good)}
tr[data-team]{cursor:pointer}tr[data-team] td:nth-child(2){text-decoration:underline dotted;text-underline-offset:3px}
details summary{cursor:pointer;font-weight:700;list-style:none;display:flex;justify-content:space-between}
details summary::-webkit-details-marker{display:none}
details summary::after{content:"+";color:var(--muted);font-weight:400;font-size:20px;line-height:1}details[open]>summary::after{content:"\\2212"}
/* the league row is a sentence, not label + value: keep it as running text with the +/- on the right */
details.board>summary{display:block;position:relative;padding:12px 30px 12px 0;margin:0;font-weight:400;font-size:14px;color:var(--muted);border-top:1px solid var(--line)}
details.board>summary b{color:var(--fg)}details.board>summary::after{position:absolute;right:2px;top:12px}
details[open]>summary{margin-bottom:8px}
dl{margin:0}dt{font-weight:700;margin-top:12px}dd{margin:2px 0 0;color:var(--muted);font-size:14px}
.empty{color:var(--muted);text-align:center;padding:18px}
.worder{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}.worder span{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--chip);color:var(--muted)}
.worder span.ahead{color:var(--fg)}.worder span.me{background:var(--accent);color:var(--onaccent);font-weight:700}
.vhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
[class^=verdict-]{flex:none;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px}
.verdict-good{background:var(--goodbg);color:var(--good)}.verdict-bad{background:var(--badbg);color:var(--bad)}.verdict-meh{background:var(--chip);color:var(--muted)}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:32px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
#refresh{flex:none;position:relative;background:rgba(255,255,255,.06);color:var(--fg);border:1px solid var(--line);border-radius:999px;padding:9px 14px;font:600 13px Geist,system-ui,sans-serif;cursor:pointer;transition:transform .1s ease-out}
#refresh::after{content:'';position:absolute;inset:-6px -4px}
#refresh:active{background:rgba(255,255,255,.12);transform:scale(.96)}#refresh.spin span{display:inline-block;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
details.intro{margin:-8px 0 12px}details.intro summary{display:inline;font-weight:600;font-size:13px;color:var(--accent)}
details.intro summary::after{content:none}details.intro[open] summary{margin-bottom:4px;display:block}details.intro p{margin:0}
.off{display:none!important}
body:not(.home) header{padding-bottom:22px}body:not(.home) .match{display:none}
.sel{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--chip);color:var(--fg);font:16px Geist,system-ui,sans-serif;margin-bottom:6px}
.tc-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pick{display:flex;gap:8px;align-items:flex-start;font-size:14px;padding:8px 0;border-bottom:1px solid var(--line);line-height:1.3}.pick input{margin-top:3px;flex:none}
table.cmp td{font-size:14px}table.cmp td.num{text-align:right;color:var(--fg)}table.cmp td.win{color:var(--good);font-weight:800}
/* whole-league board: small column labels, score so far dimmer than the bold expected final */
table.cmp tr.bh td{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding-bottom:2px}table.cmp td[data-now]{color:var(--muted)}table.cmp td[data-proj]{font-weight:700}
.cmp-picks{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.cmp-slot,.pickrow{display:flex;gap:8px;align-items:center;text-align:left;min-width:0;color:var(--fg);font:14px Geist,system-ui,sans-serif;cursor:pointer}
.cmp-slot{justify-content:flex-start;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--chip);min-height:64px}
.cmp-slot .pic,.pickrow .pic{width:40px;height:40px}
.cmp-who{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.cmp-res{max-height:50vh;overflow:auto;margin-bottom:8px}.pickrow{width:100%;padding:8px 4px;background:none;border:0;border-bottom:1px solid var(--line)}
.tools2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.tools2 .btn{margin:0;background:var(--chip);color:var(--fg)}
.chip.bye{background:rgba(110,140,255,.16);color:#9db4ff}
.pitch{background:var(--chip);border-radius:12px;padding:10px 12px;margin:0;font-size:14px}
.pick .pic{width:34px;height:34px}#fab{position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom) + 10px);z-index:11;width:46px;height:46px;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.35);touch-action:none;-webkit-tap-highlight-color:transparent}
#fab img{width:100%;height:100%;display:block;pointer-events:none}#fab.drag{opacity:.85;transform:scale(1.08)}#fab{transition:opacity .5s}#fab.idle{opacity:.35}
details.all summary{font-size:14px;color:var(--muted);padding:10px 2px}
.sheet-body{overscroll-behavior:contain}
/* Watch: live game. The field is 120 yards (two 10-yard end zones), stripes every 10 */
.btn[data-watch]{margin-bottom:14px}#gc{margin:0 0 14px}.gc-sit{grid-template-columns:repeat(3,1fr);margin-top:12px}.gc-sit b{font-size:15px}.gc-score{display:flex;align-items:center;gap:18px}.gc-score div{display:flex;gap:8px;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.gc-score span{color:var(--muted)}.gc-score .has span::after{content:' \\25CF';color:var(--accent);font-size:10px;vertical-align:middle}.gc-score small{margin-left:auto;color:var(--bad);font-weight:600}
.gc-fs{display:block;width:100%;height:auto;margin-top:12px;border-radius:12px;background:#0b1410}.gc-fs text{font-family:system-ui,sans-serif;font-weight:800}
.gc-wrap{position:relative}.gc-crowd{opacity:0;animation:gcCrowd .78s step-end infinite}@keyframes gcCrowd{0%{opacity:1}16.67%{opacity:0}}@media (prefers-reduced-motion:reduce){.gc-crowd{animation:none}}@keyframes gcHop{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}.gc-hop{animation:gcHop .55s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.gc-hop{animation:none}}.gc-replay{position:absolute;right:8px;bottom:8px;padding:5px 10px;border:0;border-radius:999px;background:#000a;color:#fff;font:600 11px system-ui,sans-serif;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.gc-pager{left:8px;right:auto;display:flex;align-items:center;gap:4px;padding:2px 4px;font-variant-numeric:tabular-nums}.gc-pager button{border:0;background:none;color:inherit;font:inherit;font-size:20px;line-height:1;padding:6px 14px;cursor:pointer}.gc-pager button:disabled{opacity:.3;cursor:default}
html.term .gc-replay{border-radius:0;font-family:inherit;text-transform:uppercase;letter-spacing:.08em}
.gc-p{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)}.gc-p small{color:var(--muted);text-align:right}
html.term .gc-fs{border-radius:0}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.sheet-card{animation:fade .2s ease-out}@keyframes fade{from{opacity:0}}
#refresh.spin span{animation:none}.btn,nav a,#refresh{transition:none}}
@media (prefers-reduced-transparency:reduce){nav,body::before{background:var(--card);-webkit-backdrop-filter:none;backdrop-filter:none}}
/* ===== Terminal theme: the look of the password screen. Black, mono letters, square edges, glow for good/bad. =====
   Everything above is the base layout; this block only restyles it, every rule starts with html.term, so it only applies when the Terminal look is picked (Classic = the base styles above). */
html.term{--bg:#000;--card:rgba(0,0,0,.78);--fg:#fff;--muted:#ffffff8c;--line:#ffffff45;--accent:#39ff88;--onaccent:#000;
--good:#39ff88;--goodbg:#39ff8814;--warn:#ffb020;--warnbg:#ffb02014;--bad:#ff3b3b;--badbg:#ff3b3b14;--chip:#ffffff12;--glass:rgba(0,0,0,.82);--glassline:#ffffff40;
--num:'JetBrains Mono',ui-monospace,Menlo,monospace}
html.term{background:#000}
html.term body{background:transparent;font:14px/1.55 'JetBrains Mono',ui-monospace,Menlo,monospace}
html.term body,html.term button,html.term .btn,html.term .seg button,html.term .sel,html.term #refresh,html.term .cmp-slot,html.term .pickrow{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
/* moving background: dot grid with rings of light, two slow spinning circles */
html.term #bg-field,html.glass #bg-field{position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
html.term .bgring{position:fixed;left:50%;top:38%;width:min(140vw,700px);aspect-ratio:1;translate:-50% -50%;border:1px dashed #ffffff1c;border-radius:50%;animation:spin 140s linear infinite;pointer-events:none;z-index:-1}
html.term .bgring.r2{width:min(95vw,460px);border:1px solid #ffffff10;animation-duration:50s;animation-direction:reverse}
html.term .bgring.r2::after{content:'';position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 14px #fff}
html.term header{background:none}
html.term .league{letter-spacing:.12em;text-transform:uppercase;font-size:11px}
html.term h1{text-transform:uppercase;letter-spacing:.1em;font-size:22px;font-weight:700}
html.term h1::after{content:'_';animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
html.term .record{letter-spacing:.1em;text-transform:uppercase;font-size:11px}
html.term h2{text-transform:uppercase;letter-spacing:.14em;font-size:15px}
html.term section>h2::before,html.term details.fold>summary h2::before{content:'// ';color:var(--muted)}
html.term .group,html.term .match h2,html.term .sh-q small{letter-spacing:.2em;font-size:10px}
html.term .sub,html.term .why,html.term .tag,html.term .meta{font-size:12.5px}
/* square edges everywhere */
html.term .card,html.term .match,html.term details.fold,html.term .seg,html.term .seg button,html.term .btn,html.term .chip,html.term .lvl,html.term .lv,html.term .pos,html.term .gain,html.term .live,html.term .stat div,html.term .sh-q,html.term .bars,html.term a.news,html.term .sel,html.term .cmp-slot,html.term .pitch,html.term .chg,html.term .worder span,html.term [class^=verdict-],html.term #gloss,html.term #refresh,html.term .card.row .slot,html.term .bar,html.term .bar i{border-radius:0!important}
html.term .list .card:first-child,html.term .list .card:last-child,html.term .list .card:only-child{border-radius:0}
html.term .card,html.term .match,html.term details.fold,html.term a.news,html.term .sh-q{background:var(--card);border-color:var(--line)}
html.term .match{border-color:#ffffff59;box-shadow:none;position:relative}
html.term .wp b{text-shadow:0 0 18px currentColor}
html.term .bar{height:2px}html.term .bar i{box-shadow:0 0 8px currentColor}
/* tags: outlined, like the ACCESS GRANTED stamp */
html.term .chip,html.term .lvl,html.term .lv,html.term .live,html.term [class^=verdict-],html.term .gain{background:transparent!important;border:1px solid currentColor;letter-spacing:.12em;text-transform:uppercase;font-size:10px}
html.term .live{animation:blink 1.4s steps(1) infinite}
html.term .pos{border-radius:0}
/* things that were boxes by their gray fill get an outline, so they still read as boxes on black */
html.term .stat div,html.term .worder span,html.term .pitch,html.term .chg,html.term .card.row .slot,html.term .sh-q,html.term .bars,html.term .tools2 .btn,html.term #cmp-out table,html.term .sel{border:1px solid var(--line)}
html.term .worder span.me{border-color:var(--accent)}html.term .chg.good{border-color:var(--good)}html.term .chg.bad{border-color:var(--bad)}
/* buttons: white outline, flips to white when pressed */
html.term .btn{background:transparent;color:#fff;border:1px solid #fff;font-weight:700;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase}
html.term .btn:active,html.term .btn:hover{background:#fff;color:#000;filter:none}
html.term .btn[disabled]{opacity:.5}
html.term .tools2 .btn{background:transparent;color:#fff}
html.term #refresh{background:transparent;border-color:#ffffff59;text-transform:uppercase;letter-spacing:.12em;font-size:11px}
/* bottom bar: black glass strip, glowing tab */
html.term nav{border-radius:0;background:var(--glass);border-color:var(--glassline)}
html.term nav a{border-radius:0;letter-spacing:.12em;text-transform:uppercase;font-size:9.5px}
html.term nav a.on{color:#fff;background:#ffffff12;text-shadow:0 0 10px #fff}
html.term nav a.on svg{filter:drop-shadow(0 0 5px #fff)}
html.term nav a.press{background:#ffffff26}
html.term nav .dot,html.term #todo h2 .dot{border-radius:0;background:var(--bad);box-shadow:0 0 10px var(--bad)}
html.term .seg button{text-transform:uppercase;letter-spacing:.08em;font-size:11px}/* .08em: 5 buttons on More still fit a phone */
html.term .seg button.on{background:#fff;color:#000}
html.term .gl{text-decoration-color:var(--good)}
html.term #gloss{border-color:var(--good);box-shadow:0 0 24px #39ff8826}
html.term #gloss b{color:var(--good);letter-spacing:.1em;text-transform:uppercase;font-size:12px}
html.term .sheet-card{border-radius:0;border-top:1px solid #ffffff59;background:#000}
html.term .sheet-x{border-radius:0}
html.term .pic{border:1px solid var(--line)}
html.term footer{letter-spacing:.1em;text-transform:uppercase;font-size:10px}
/* each page boots in when you open it */
html.term section:not(.off){animation:boot .35s ease-out}
@keyframes boot{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){html.term .bgring,html.term h1::after,html.term .live{animation:none}html.term section:not(.off){animation:none}}
/* Glass look: Apple's Liquid Glass (iOS 26), as close as CSS gets on an iPhone. Like iOS, glass is only for the controls that
   float over the page: the tab bar and the player sheet. The page itself stays solid (iOS dark grouped
   style: black, #1c1c1e cards), so the glass has real content scrolling under it and never sits on other glass. The glass is a
   light blur that keeps the colours behind it (it bends light more than it frosts), a bright rim that is brightest top-left and
   bottom-right where light catches a curved edge, a faint glow along the inside of the edge, and a soft shadow. Only the main
   action is tinted (blue). ponytail: no real refraction; that needs SVG filters in backdrop-filter, which Safari doesn't do.
   Every rule starts with html.glass. */
html.glass{--bg:#000;--card:rgba(30,30,33,.85);--fg:#fff;--muted:rgba(235,235,245,.6);--line:rgba(84,84,88,.65);--chip:#2c2c2e;--accent:#0a84ff;--onaccent:#fff;
--good:#30d158;--goodbg:rgba(48,209,88,.16);--warn:#ff9f0a;--warnbg:rgba(255,159,10,.16);--bad:#ff453a;--badbg:rgba(255,69,58,.16);
--glass:rgba(255,255,255,.07);--glassline:transparent;--num:-apple-system,'SF Pro Display',Geist,system-ui,sans-serif;background:#000}
html.glass body{background:transparent;font-family:-apple-system,'SF Pro Text',Geist,system-ui,sans-serif;font-variant-numeric:tabular-nums}
html.glass button,html.glass .btn,html.glass .seg button,html.glass #refresh{font-family:inherit}
html.glass header{background:none}html.glass h1{font-size:34px;letter-spacing:-.02em}
/* the page: solid, flat, iOS grouped lists */
html.glass .card,html.glass .match,html.glass details.fold,html.glass a.news,html.glass .sh-q{background:var(--card);border:0;box-shadow:none}
html.glass .card,html.glass details.fold,html.glass .match{border-radius:26px}html.glass .sh-q,html.glass a.news{border-radius:20px}
html.glass .sh-q.yes{border-left:4px solid var(--good)}html.glass .sh-q.no{border-left:4px solid var(--bad)}html.glass .sh-q.maybe{border-left:4px solid var(--warn)}
html.glass .list .card{border-radius:0}html.glass .list .card+.card{border-top:.5px solid var(--line)}
html.glass .list .card:first-child{border-radius:26px 26px 0 0}html.glass .list .card:last-child{border-radius:0 0 26px 26px}html.glass .list .card:only-child{border-radius:26px}
html.glass details.fold .card{background:none;border:0;border-top:.5px solid var(--line);border-radius:0!important;padding:12px 0;margin:0}
/* the glass: only on what floats over the page (tab bar, player sheet, its close button). Almost no fill, so the page shows
   through; a sharp rim, brightest top-left and bottom-right; and a band along the inside of the edge where what's behind is
   brighter and more saturated, like light bunching up in the thick curved edge of real glass. Soft glows and solid fills
   read as plastic, so there are none. */
html.glass :is(nav,.seg,.sheet-x,.sheet-card){border:0;-webkit-backdrop-filter:blur(4px) saturate(180%) brightness(1.05);backdrop-filter:blur(4px) saturate(180%) brightness(1.05);box-shadow:0 6px 20px rgba(0,0,0,.28)}
html.glass :is(nav,.seg,.sheet-x,.sheet-card,.blob)::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;z-index:1;
background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,255,255,.18) 20%,rgba(255,255,255,0) 45%,rgba(255,255,255,0) 60%,rgba(255,255,255,.2) 82%,rgba(255,255,255,.6));
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
html.glass :is(nav,.seg,.sheet-card)::after{content:'';position:absolute;inset:0;border-radius:inherit;padding:6px;pointer-events:none;
-webkit-backdrop-filter:blur(6px) brightness(1.35) saturate(220%);backdrop-filter:blur(6px) brightness(1.35) saturate(220%);
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
html.glass nav{border-radius:999px;background:rgba(20,20,22,.22)}
html.glass nav a{border-radius:999px;color:rgba(255,255,255,.75)}
html.glass nav a.on{color:var(--accent)}html.glass :is(nav a,.seg button):is(.on,.press){background:none;transform:none;box-shadow:none}
/* the bubble on the picked tab or switch button: a small clear lens (brighter and more saturated than the bar, its own rim)
   that slides over with a springy overshoot, and swells a little while you hold the tab bar (placed by placeBlobs()) */
.blob{display:none}
html.glass .blob{display:block;position:absolute;left:0;top:0;border-radius:999px;pointer-events:none;background:rgba(255,255,255,.1);-webkit-backdrop-filter:brightness(1.25) saturate(160%);backdrop-filter:brightness(1.25) saturate(160%);
transition:transform .55s cubic-bezier(.3,1.4,.5,1),width .55s cubic-bezier(.3,1.4,.5,1),scale .3s cubic-bezier(.3,1.6,.5,1),background .2s,--spin .55s cubic-bezier(.3,1.4,.5,1)}
/* its edge splits light into a thin rainbow, like real glass bending light (dispersion); the colours travel around the edge
   as the bubble moves (--spin follows where it is along the bar, set by placeBlobs() and the drag) */
@property --spin{syntax:'<angle>';inherits:true;initial-value:0deg}
html.glass .blob::after{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:2px;pointer-events:none;mix-blend-mode:screen;filter:blur(.6px);
background:conic-gradient(from var(--spin),rgba(255,140,0,0),rgba(255,140,0,.75) 12%,rgba(255,0,170,.6) 22%,rgba(90,60,255,.7) 32%,rgba(0,190,255,.6) 42%,rgba(0,190,255,0) 55% 62%,rgba(0,190,255,.45) 72%,rgba(255,0,170,.4) 84%,rgba(255,140,0,.5) 94%,rgba(255,140,0,0));
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
html.glass .blob.held{scale:1.12;background:rgba(255,255,255,.16)}
html.glass .blob{z-index:1}html.glass .blob.drag{transition:scale .3s cubic-bezier(.3,1.6,.5,1),background .2s}html.glass :is(nav a,.seg button){z-index:2}
html.glass .sheet-x{background:rgba(255,255,255,.06)}
/* buttons and switches inside the page sit on solid cards, so they're flat iOS controls, not glass */
html.glass .btn{border-radius:999px;color:#fff;background:var(--accent);box-shadow:none}
html.glass .tools2 .btn,html.glass #refresh{background:rgba(118,118,128,.24);color:var(--fg);border:0}
html.glass .btn:active,html.glass #refresh:active{transform:scale(.97);filter:brightness(1.1)}
html.glass .seg{position:relative;border-radius:999px;background:rgba(20,20,22,.22);touch-action:pan-y}html.glass .seg button{position:relative;border-radius:999px}html.glass .seg button.on{color:#fff}
/* the player sheet floats in from the edges like an iOS 26 sheet, darker glass so its text stays easy to read */
html.glass .sheet-bg{background:rgba(0,0,0,.4)}
html.glass .sheet-card{left:8px;right:8px;bottom:8px;border-radius:34px;background:rgba(28,28,30,.55);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%)}
/* top edge: the page fades and softens as it scrolls under the status bar, instead of a hard bar */
html.glass body::before{height:calc(env(safe-area-inset-top) + 28px);background:linear-gradient(rgba(0,0,0,.8),transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);-webkit-mask-image:linear-gradient(#000 40%,transparent);mask-image:linear-gradient(#000 40%,transparent)}
/* behind the page: a football field seen from above, faint yard lines and hash marks under a soft stadium light, with plays
   drawing themselves on top (the chalkboard canvas), so the glass has something moving to bend */
html.glass::before{content:'';position:fixed;left:0;right:0;top:-80px;bottom:0;z-index:-1;pointer-events:none;
background:radial-gradient(90% 55% at 50% 0%,rgba(255,255,255,.09),transparent 70%),
repeating-linear-gradient(180deg,rgba(255,255,255,.11) 0 1px,transparent 1px 16px) 30% 0/10px 100% repeat-y,repeating-linear-gradient(180deg,rgba(255,255,255,.11) 0 1px,transparent 1px 16px) 70% 0/10px 100% repeat-y,
repeating-linear-gradient(180deg,transparent 0 79px,rgba(255,255,255,.1) 79px 80px);
-webkit-mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent);mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent)}
@media (prefers-reduced-transparency:reduce){html.glass :is(nav,.sheet-card){background:#1c1c1e;-webkit-backdrop-filter:none;backdrop-filter:none}}
</style></head><body>
<canvas id="bg-field" aria-hidden="true"></canvas><div class="bgring" id="bg-ring1"></div><div class="bgring r2" id="bg-ring2"></div>

<header><div class="wrap">
  <div class="top"><div class="league">${esc(league.settings.name)} &middot; Week ${week} &middot; <span id="ago">just updated</span></div>
  <button id="refresh" type="button"><span>&#8635;</span> Refresh</button></div>
  <h1>${esc(me.name)}</h1>
  <div class="record">${me.w}-${me.l} record &middot; ${ordinal(myRank)} of ${teams.length}</div>
</div></header>

<div class="wrap">
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
  <div class="wp"><b id="lv-wp" style="color:${wp >= 60 ? 'var(--good)' : wp < 40 ? 'var(--bad)' : 'var(--warn)'}">${wp}%</b><span>chance you win <span class="tag" id="lv-wpsrc">(${liveWin ? 'ESPN live estimate' : 'from the averaged projections'})</span></span></div>
  <div class="tag" id="lv-score" style="margin-bottom:8px"${live ? '' : ' hidden'}>${done ? 'Final score' : 'Score right now'}: <b>${n(mySide.totalPointsLive ?? 0)}</b> to <b>${n(oppSide.totalPointsLive ?? 0)}</b>.${done ? '' : ' Final guess below.'}</div>
  ${live && pre ? `<div class="tag" style="margin:-4px 0 8px">Guess before games started: <b>${n(pre[0])}</b> to <b>${n(pre[1])}</b>.</div>` : ''}
  <div class="vs">
  <div class="t">You</div><div class="p" id="lv-a" data-base="${n(a)}">${n(a)}</div><div class="bar"><i id="lv-abar" style="width:${Math.min(100, a / Math.max(a, b, 1) * 100)}%;background:var(--accent)"></i></div>
  <div class="t">${esc(opp.name)}</div><div class="p" id="lv-b">${n(b)}</div><div class="bar"><i id="lv-bbar" style="width:${Math.min(100, b / Math.max(a, b, 1) * 100)}%;background:var(--muted)"></i></div>
</div><div class="verdict" id="lv-verdict">${(() => {
  // 0% or 100% from ESPN: decided, just not official yet
  const [x, y] = done ? [mySide.totalPointsLive ?? 0, oppSide.totalPointsLive ?? 0] : [a, b], by = n(Math.abs(Math.round(x * 10) - Math.round(y * 10)) / 10);
  return verdictText(x >= y, by, done ? 'final' : live && (wp <= 0 || wp >= 100) ? 'decided' : '');
})()}
${!live && planProj > myProj + 0.5 ? ` ${claims.length ? (plan.length ? 'Your pending claims plus the to-do list get' : 'Your pending claims get') : 'Doing the to-do list below gets'} you to about <b>${n(planProj)}</b>.` : ''}</div>
<div class="tag" style="margin-top:6px">${esc(playoffLine)}</div>
<details class="board" style="margin-top:10px"><summary><b>Whole league this week:</b> you're ${ordinal(myBoardRank)} of ${board.length}, ${below.length} team${below.length === 1 ? '' : 's'} below you. <b style="color:${lowestPct >= 15 ? 'var(--bad)' : lowestPct >= 5 ? 'var(--warn)' : 'var(--good)'}">${lowestPct < 1 ? 'Under 1' : lowestPct}% chance</b> you're the lowest score.</summary>
<table class="cmp" style="margin-top:8px"><tr class="bh"><td></td><td></td>${isLive ? '<td class="num">Now</td>' : ''}<td class="num">Expected</td></tr>${board.map((r, i) => `<tr data-team="${r.t.id}"${r.t === me ? ' style="font-weight:700"' : ''}><td class="num" style="text-align:left">${i + 1}</td><td>${esc(r.t === me ? 'You' : r.t.name)}</td>${isLive ? `<td class="num" data-now>${n(r.now)}</td>` : ''}<td class="num" data-proj>${n(r.proj)}</td></tr>`).reverse().join('')}</table>
<p class="tag" style="margin:6px 0 0">${isLive ? 'Expected final score (ESPN live projection)' : 'Expected score with every lineup as set right now (averaged projections)'}. ${below.length ? `Below you: ${esc(below.map(r => r.t.name).join(', '))}.` : 'Nobody is projected below you.'} Lineups can still change before games start.</p></details></div>`;
})() : ''}
<div id="stale" class="card" hidden style="background:var(--badbg);border-color:var(--bad)"><b style="color:var(--bad)">&#9888; This page stopped updating</b><div class="tag" id="staletext"></div></div>
${down.length ? `<div class="card" style="background:var(--warnbg);border-color:var(--warn)"><b style="color:var(--warn)">&#9888; ${esc(down.join(' and '))} didn't load this time.</b>
<div class="tag">${down.includes('Vegas lines') && down.length === 1 ? 'Player notes won\'t say how many points Vegas expects his team to score.' : '"Expected" points use only the sources that worked, so they\'re a bit less reliable.'} It usually fixes itself on a later update. If this stays for a day, ask Claude to check it.</div></div>` : ''}

<a id="fab" href="https://fantasy.espn.com/football/league?leagueId=${LEAGUE_ID}&amp;seasonId=${SEASON}" aria-label="Open the ESPN Fantasy app"><img src="https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/1c/b2/68/1cb2683b-9dce-d70c-8905-2562c0482eda/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/120x120bb.jpg" alt=""></a>
<nav>${[['home', 'Home', '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>'], ['team', 'Team', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>'], ['moves', 'Moves', '<path d="M12 5v14M5 12h14"/>'], ['trades', 'Trades', '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'], ['more', 'More', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>']].map(([h, label, icon]) => `<a href="#${h}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}${h === 'home' ? '<span class="dot" hidden></span>' : ''}</a>`).join('')}</nav>
<div id="seg" class="seg" hidden></div>

<section id="todo"><h2>Do this now <span class="dot" hidden></span></h2><p class="sub">Your to-do list, most important first. Tap a button to do it on ESPN.</p>
${adviceIssues.length ? `<div class="card" style="border-color:var(--warn)"><b style="color:var(--warn)">Advice check: ${adviceIssues.length} problem${adviceIssues.length > 1 ? 's' : ''} found</b><p class="why" style="margin:4px 0 0">The site re-tested its own advice and something doesn't add up. Treat these with care:</p><ul style="margin:6px 0 0;padding-left:18px">${adviceIssues.map(([where, text]) => `<li><b>${esc(where)}:</b> ${esc(text)}</li>`).join('')}</ul></div>` : `<p class="tag" style="margin:0 0 8px">&#10003; Advice check: all ${ADVICE_RULES} rules passed this update.</p>`}
${todo.length ? (() => { const card = ([lvl, title, why, move, who = []]) => `<div class="card todo"><span class="lvl ${lvl}">${levelName[lvl]}</span><div><b>${esc(title)}</b>${who.length ? `<div class="tpics">${who.map(p => { shown.set(p.id, p); return `<span data-pid="${p.id}" role="button" tabindex="0" title="${esc(p.name)}">${pic(p)}</span>`; }).join('')}</div>` : ''}<p>${esc(why)}</p>${info(who)}${/^(Pickup step|Better backup)/.test(title) && who.length === 2 ? exBtns([who[1]], [who[0]]) : ''}${MOVE_URL && move ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...move, week: league.scoringPeriodId }))}">${esc(move.label)}</button>` : ''}</div></div>`;
  return todo.slice(0, 3).map(card).join('') + (todo.length > 3 ? `<details class="all"><summary>${todo.length - 3} more to do</summary>${todo.slice(3).map(card).join('')}</details>` : ''); })() : '<div class="card empty">You\'re all set this week.</div>'}
</section>

<section id="changes" hidden><h2>What changed</h2><p class="sub">Since you last tapped "Got it".</p>
<div class="card"><div id="changelist"></div><button type="button" id="seen" class="btn">Got it</button></div></section>

<section id="ask"><div class="card ask"><div><b>Ask Claude about your team</b><p class="tag" style="margin:2px 0 0">Type your question. Claude gets it with your team's facts, plus any other player or team you name, and the answer shows right here.</p></div>
<textarea id="askq" class="sel" rows="3" aria-label="Your question" placeholder="Should I trade Kelce for Bijan? Who should I pick up at RB?" style="width:100%;min-height:72px;resize:vertical;margin-top:10px"></textarea>
<div class="seg" id="askmode" style="margin-top:10px"><button type="button" data-mode="auto">Auto</button><button type="button" data-mode="quick">Quick</button><button type="button" data-mode="smart">Smart</button></div>
<p class="tag" id="askmodetip" style="margin:6px 0 0"></p>
<button type="button" id="askbtn" class="btn">Ask Claude</button><div id="askout" class="askout" hidden></div>
<button type="button" id="askopen" class="linkbtn">Or open it in the Claude app</button></div></section>

<section id="alerts" hidden><div class="card"><b>Phone alerts</b>
<p class="tag" style="margin:2px 0 0">Get a notification when a starter won't play, a hurt player's status is decided before kickoff, a trade offer comes in, and more.</p>
<button type="button" id="alertbtn" class="btn">Turn on alerts</button>
<div id="alertcode" hidden><p class="tag">Last step: copy this code, then in GitHub open your Fantasy-app repo &rsaquo; Settings &rsaquo; Secrets and variables &rsaquo; Actions &rsaquo; New repository secret. Name it <b>PUSH_SUB</b> and paste the code. You'll get an "Alerts are on" notification within a few minutes.</p>
<textarea id="alerttext" aria-label="Alert setup code" readonly rows="4" style="width:100%;font:12px monospace"></textarea>
<button type="button" id="alertcopy" class="btn">Copy code</button></div></div></section>


<section id="news"><h2>News</h2><p class="sub">Latest updates on your players and pickups, from Rotowire via ESPN. Tap a name for details.</p>
<div class="list">__NEWS__</div></section>

<section id="lineup"><h2>My team</h2><p class="sub">Big number = points he's expected to score this week (average of ESPN, Rotowire and CBS). Top starter, starter or below starter compares him with the players who start at his position across your league. Green "up to" = his score if he has a great game. Tap any player to see if he plays, when, his last games and news.</p>
${[['Starting', p => p.slot !== 'Bench' && p.slot !== 'IR'], ['Bench', p => p.slot === 'Bench'], ['Injured reserve', p => p.slot === 'IR']].map(([label, f]) => {
  const ps = lineupRows.filter(f);
  const rows = ps.map(p => `<div class="card row"><span class="slot">${p.slot === 'Bench' || p.slot === 'IR' ? '' : p.slot}</span>${player(p, nowPts(p))}${big(weekValue(p), 'this week', weekValue(p) > 0 ? p.ceiling : null, p, 'week')}</div>`).join('');
  // starters show; bench and injured reserve fold to one line
  return !ps.length ? '' : label === 'Starting' ? `<div class="group">${label}</div><div class="list">${rows}</div>` : `<details class="fold"><summary class="group">${label} (${ps.length})</summary><div class="list">${rows}</div></details>`;
}).join('')}
</section>

<section id="bench"><h2>Bench check</h2><p class="sub">Does each bench player earn his spot? Keep = he starts this week or in the next ${benchHorizon.length || 'few'} weeks (byes, injuries), or he's your top backup and clearly better than any free player at his spot. If not, here's a better use of the spot.</p>
${benchCheck.length ? `<div class="list">${benchCheck.map(b => `<div class="card"><div class="vhead"><b>${lnk(b.p)}</b><span class="verdict-${b.keep ? 'good' : 'meh'}">${b.keep ? 'Keep' : 'Not needed'}</span></div>
  <p class="why" style="margin:0">${b.keep ? esc(b.keep) : [
    `He doesn't start in any of the next ${benchHorizon.length} weeks, and a free player could back up about as well.`,
    b.planned ? 'Your pickup plan already swaps him out.' : '',
    b.swap ? `<b>Waivers:</b> drop him for ${lnk(b.swap.add)} (${b.swap.add.pos}, ${n(rate(b.swap.add))} a game${b.swap.add.wa ? ', on waivers' : ''}): about +${n(b.swap.gain)} points over the next ${benchHorizon.length} weeks.` : '',
    b.trade ? `<b>Trade:</b> him for ${lnk(b.trade.take)} with ${esc(b.trade.team.name)}, +${n(b.trade.mine)} a week for you${b.trade.strict ? '' : ' (a closer call)'}.` : '',
    b.steal ? `<b>Trade:</b> ${b.steal.give.map(lnk).join(' + ')} for ${lnk(b.steal.take)} with ${esc(b.steal.d.t.name)}, +${n(b.steal.mine)} a week for you (they lose about ${n(-b.steal.theirs)}, so it may be a hard sell).` : '',
    !b.swap && !b.trade && !b.steal ? 'Nothing better on waivers or in trades right now. Keep him as depth until you need the spot.' : '',
  ].filter(Boolean).join(' ')}</p>${b.keep || !(b.swap || b.trade || b.steal) ? '' : `<div class="tools2">${b.swap ? cmpBtn(b.p, b.swap.add, `Compare with ${esc(b.swap.add.name)}`) : ''}${b.trade ? tcBtn([b.p], [b.trade.take], `Trade check: ${esc(b.trade.take.name)}`) : ''}${b.steal ? tcBtn(b.steal.give, [b.steal.take], `Trade check: ${esc(b.steal.take.name)}`) : ''}</div>`}</div>`).join('')}</div>` : '<div class="card empty">Nobody on your bench.</div>'}
</section>

<section id="pickups"><h2>Pickup plan</h2><p class="sub">Do these in order. Each step swaps one player for one free player nobody in your league has. Two kinds: <b>this week only</b> (a better start this week, using a spare bench spot, never costing you a long-term player or a bye-week fill-in) and <b>long-term upgrade</b> (better for the rest of the season). Tap the button on a step to make that move on ESPN.</p>
<div class="card"><div class="vhead"><span class="group" style="margin:0">Waiver order</span><span class="verdict-meh">You pick ${ordinal(me.waiver)} of ${teams.length}</span></div>
<details class="all" style="margin:-4px 0 4px"><summary>See the full order</summary><div class="worder">${[...teams].sort((a, b) => a.waiver - b.waiver).map(t => `<span class="${t === me ? 'me' : t.waiver < me.waiver ? 'ahead' : ''}">${t.waiver}. ${esc(t.name)}</span>`).join('')}</div></details>
${nextRun ? `<p class="why" style="margin:0 0 6px"><b>Next waiver run: ${nextRun}.</b></p>` : ''}<p class="tag" style="margin-bottom:0">When two teams claim the same player, the one higher on this list gets him. ${me.waiver > 1 ? `${me.waiver - 1} team${me.waiver > 2 ? 's' : ''} pick before you.` : 'You pick first.'} Free agents (not on waivers) go to whoever adds them first.</p></div>
${fillIns.length ? `<div class="group">Injury fill-ins: grab them first</div><p class="sub">A team's starting quarterback, running back or tight end is out, and his backup is free in your league. The backup usually takes over the work, and most managers (and the experts' numbers) take hours to react.</p><div class="list">${fillIns.map(f => `<div class="card"><div class="row">${freeCard(f.p, f.name, f.team, f.pos)}${f.gain >= 0.5 ? `<span class="verdict-good">+${n(f.gain)} a week for you</span>` : '<span class="verdict-meh">Keep from rivals</span>'}</div>
  <p class="why">${lnk(f.starter)} ${esc(f.word)}${f.long ? ' and will be out a while' : ''}, so ${esc(f.name)} is next up (${esc(f.owner.name)} has ${esc(f.starter.name)}). ${f.gain >= 0.5 ? `As the starter he'd add about ${n(f.gain)} a week to your lineup.` : 'He wouldn\'t start for you, but adding him keeps him from a rival who needs him.'}${f.p ? ` ${f.p.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}` : ' Search his name in the ESPN app to add him.'}${f.drop ? ` To make room: drop ${esc(f.drop.name)}.` : ''}</p>
  ${MOVE_URL && addMove(f.p, f.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...addMove(f.p, f.drop), week: league.scoringPeriodId }))}">${esc(addMove(f.p, f.drop).label)}</button>` : ''}</div>`).join('')}</div>` : ''}
${plan.length ? plan.map((s, i) => { const wk = s.kind === 'week'; return `<div class="card">
  <div class="group" style="margin:0 0 10px">Step ${i + 1} &middot; ${wk ? 'this week only (uses a spare bench spot)' : 'long-term upgrade'}</div>
  <div class="row">${player(s.add)}${big(wk ? s.add.proj : rate(s.add), wk ? 'this week' : 'per game, rest of season', null, s.add, wk ? 'week' : 'season')}</div>
  <p class="why"><span class="gain">+${n(s.gain)}</span> ${wk ? 'more points this week' : 'more points per week'}. To make room, drop <b>${esc(s.drop.name)}</b> (${n(wk ? weekValue(s.drop) : rate(s.drop))} ${wk ? 'this week' : 'per game, rest of season'}).${wk ? ` He isn't a long-term keeper (${n(seasonValue(s.drop))} a game from here on; free players come close), so this spot is for streaming. Your long-term players are never dropped for one week.` : ''}<br>
  <span class="tag">${s.add.wa ? 'On waivers: your claim goes through in about a day.' : 'Free agent: yours right away.'}</span>
  ${s.add.wa ? (() => { const r = rivalsFor(s.add, wk ? weekValue : seasonValue); return r.length
    ? `<br><span class="tag" style="color:var(--warn)">${r.length} team${r.length > 1 ? 's' : ''} that pick${r.length > 1 ? '' : 's'} before you could use him too: ${r.slice(0, 3).map(t => esc(t.name)).join(', ')}${r.length > 3 ? '&hellip;' : ''}.</span>`
    : '<br><span class="tag" style="color:var(--good)">No team that picks before you needs him, so you\'ll probably get him.</span>'; })() : ''}
  ${notes(s.add).map(t => `<br><span class="tag">&#9432; ${esc(t)}</span>`).join('')}
  ${s.alts.length ? `<br><span class="tag">If someone else gets him first, take ${s.alts.map(a => `<b>${esc(a.add.name)}</b> (${n(wk ? a.add.proj : rate(a.add))})`).join(' or ')} instead.</span>` : ''}</p>${info([s.add, s.drop])}
  ${MOVE_URL && !locked(s.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `${s.add.wa ? 'Claim' : 'Add'} ${s.add.name}, drop ${s.drop.name}`, type: s.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: s.add.id }, { type: 'DROP', playerId: s.drop.id }], week: league.scoringPeriodId }))}">${s.add.wa ? 'Claim' : 'Add'} ${esc(s.add.name)}, drop ${esc(s.drop.name)}</button>` : ''}</div>`; }).join('')
  : `<div class="card empty">Nobody out there would make your starting lineup better${claims.length ? ', counting your pending claims (see Pending)' : ''}.</div>`}
${benchUps.length ? `<details class="fold"><summary class="group">Better backups available (${benchUps.length})</summary><p class="sub">Free players clearly better than one of your bench players. Small upgrades: a backup only scores when a starter is out or on bye.</p><div class="list">${benchUps.map(x => `<div class="card"><div class="row">${player(x.add)}${big(rate(x.add), 'per game, rest of season', null, x.add, 'season')}</div>
  <p class="why">Instead of <b>${esc(x.drop.name)}</b> (${n(rate(x.drop))} per game). ${x.add.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}${esc(alsoText(x.alts, rate))}</p>${info([x.add, x.drop, ...x.alts])}
  ${exBtns([x.drop], [x.add])}
  ${MOVE_URL && !locked(x.drop) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `Add ${x.add.name}, drop ${x.drop.name}`, type: x.add.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: x.add.id }, { type: 'DROP', playerId: x.drop.id }], week: league.scoringPeriodId }))}">Add ${esc(x.add.name)}, drop ${esc(x.drop.name)}</button>` : ''}</div>`).join('')}</div></details>` : ''}
${trending.length ? `<details class="fold"><summary class="group">Trending in other leagues (${Math.min(5, trending.length)})</summary><div class="list">${trending.slice(0, 5).map(p => `<div class="card"><div class="row">${player(p)}${p.proj != null ? big(weekValue(p), 'this week', weekValue(p) > 0 ? p.ceiling : null, p, 'week') : '<span class="tag">No projection for him this week</span>'}</div>${pickBtn(p)}</div>`).join('')}</div>
<p class="tag">Often means news broke (an injury ahead of him, a bigger role). Not always worth it for you, but worth a look.</p></details>` : ''}
${breakouts.length ? `<details class="fold"><summary class="group">Breakout watch: bigger role (${breakouts.length})</summary><p class="sub">His playing time or share of his team's targets/carries jumped over his last 3 games. Role changes come before the points, and the experts' numbers follow the points, so these players are cheapest right now. Good use of a spare bench spot.</p><div class="list">${breakouts.map(b => `<div class="card"><div class="row">${freeCard(b.p, b.name, b.team, b.pos)}${b.recent != null ? big(b.recent, 'per game, last 3', null, b.p ?? null, 'season') : ''}</div>
  <p class="why"><b>Why:</b> his team is using him a lot more. ${b.cause.length ? `${esc(b.cause.join(' and '))} ${b.cause.length > 1 ? 'are' : 'is'} out, so more of the work goes to him. ` : ''}In his last 3 games he was on the field for <b>${b.u.snapNow}%</b> of his team's plays (${b.u.snapBefore}% before that), and <b>${b.u.shareNow}%</b> of his team's ${b.u.kind === 'carries' ? 'runs went to him' : 'passes were thrown to him'} (${b.u.shareBefore}% before).</p>
  <p class="why"><b>When:</b> more playing time usually turns into more points this week or next. Most managers only notice once the big games show up, so right now he's easy to get.${b.p ? ` ${b.p.wa ? 'On waivers, so it\'s a claim.' : 'Free agent: yours right away.'}` : ' Search his name in the ESPN app to add him.'}</p>
  ${pickBtn(b.p)}</div>`).join('')}</div></details>` : ''}
${fills.length ? `<div class="group">Empty roster spots: ${fills.length}</div><div class="list">${fills.map(f => `<div class="card"><div class="row">${player(f.add)}${big(rate(f.add), 'per game, rest of season', null, f.add, 'season')}</div>
  <p class="why">No drop needed.${f.week >= 0.5 ? ` Adds about ${n(f.week)} points this week.` : ''}${esc(byeText(f))}${f.season >= 0.5 ? ` About ${n(f.season)} better per week after that.` : f.rest >= 1 ? ` As a backup, about ${Math.round(f.rest)} points over the next two weeks covering your starters' bye weeks.` : ' A backup for injuries.'}</p>${info([f.add, ...f.byeFor, ...f.alts])}
  ${MOVE_URL && !locked(f.add) ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ ...fillMove(f), week: league.scoringPeriodId }))}">${f.add.wa ? 'Put in a claim for him on ESPN' : 'Add him on ESPN'}</button>` : ''}</div>`).join('')}</div>` : ''}
</section>
<section id="pending"><h2>Your pending moves</h2><p class="sub">Waiver claims and trade offers that haven't gone through yet, checked with the same math as everything else.</p>
${pending.length ? pending.map(m => {
  if (m.kind === 'waiver') {
    const { backup, worseBackup, kp, spare, stack, covers, ahead, worse, keeps, rental, v } = claimCheck(m);
    return `<div class="card"><div class="vhead"><span class="tag">Waiver claim</span><span class="verdict-${v[0]}">${esc(v[1])}</span></div>
    <div class="swap">${m.add.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}<div class="arrow">drop</div>${m.drop.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}</div>
    <p class="why">${stack ? `<b>You'd have ${spare.length + 1} ${kp === 'K' ? 'kickers' : 'defenses'} and only start ${slotCounts[FA_SLOT[kp]] || 1}. Drop ${esc(stack.name)} (${n(rate(stack))} a game) for ${esc(m.add[0].name)} and keep ${esc(m.drop.map(d => d.name).join(' and '))}.</b> ` : ''}<b>${(backup || worseBackup) && Math.abs(m.week) < 1 && Math.abs(m.season) < 1 ? `Neither of them makes your starting lineup right now, so your score doesn't change. But ${esc(m.add[0].name)} is a much ${backup ? 'better' : 'worse'} backup (${n(rate(m.add[0]))} vs ${n(rate(m.drop[0]))} a game) for bye weeks and injuries.` : ''}${(backup || worseBackup) && Math.abs(m.week) < 1 && Math.abs(m.season) < 1 ? '' : Math.abs(m.week) < 0.5 ? 'No change this week' : `${m.week > 0 ? 'Adds' : 'Costs'} about ${n(Math.abs(m.week))} points this week`}${Math.abs(m.season) < 0.5 ? (rental ? `, but ${esc(m.drop[0].name)} is the better player after that.` : ', about the same after that.') : `, and ${m.season > 0 ? 'adds' : 'costs'} about ${n(Math.abs(m.season))} a week after that.`}${Math.abs(m.nextGain) >= 0.5 ? ` Next week (week ${week + 1}): ${m.nextGain > 0 ? 'adds' : 'costs'} about ${n(Math.abs(m.nextGain))}.` : ''}</b>${nextRun ? ` It goes through ${nextRun}.` : ''}</p>
    ${rental ? `<p class="why">One-week rental: ${worse ? `${esc(m.drop[0].name)} is expected ${n(seasonValue(m.drop[0]))} a game from here on vs ${n(seasonValue(m.add[0]))} for ${esc(m.add[0].name)}` : 'it helps this week only'}${ahead <= -1 ? `, and your lineups the next 2 weeks get about ${n(-ahead)} points worse` : ''}. ${keeps.length ? `${esc(keeps[0].name)} is worth keeping long-term (free players at his spot are clearly worse), so cancel it.` : 'Fine if you want this week\'s points, since a player like the one you drop is easy to find again.'}</p>` : ''}
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
  <p class="why"><b style="color:var(--${v[0] === 'meh' ? 'fg' : v[0]})">${Math.abs(m.mine) < 1 ? 'About even for you' : `You'd ${m.mine > 0 ? 'gain' : 'lose'} about ${Math.round(Math.abs(m.mine))} point${Math.round(Math.abs(m.mine)) === 1 ? '' : 's'} a week`} for the rest of the season.</b>
  ${Math.abs(m.mineWeek) >= 1 ? `This week alone: ${m.mineWeek > 0 ? '+' : ''}${n(m.mineWeek)} points.` : ''} They'd ${Math.abs(m.theirs) < 1 ? 'come out about even' : `${m.theirs > 0 ? 'gain' : 'lose'} about ${Math.round(Math.abs(m.theirs))} a week`}.
  ${m.mineWeek > 2 && m.mine < -1 ? '<br><b>Trap:</b> it only helps this week (your players are on bye or hurt). After that you\'re worse off.' : ''}
  ${lost.length ? `<br>After the trade, ${lost.join('; ')}.` : ''}
  ${m.vorTake < m.vorGive * 0.7 ? '<br>You\'re giving up more real value than you get back.' : m.vorTake > m.vorGive * 1.3 ? '<br>You get more real value than you give.' : ''}</p>
  ${exBtns(m.give, m.take, true)}
  ${MOVE_URL && !m.mineOffer ? `<div class="tools2"><button type="button" class="btn do" style="background:var(--good);color:var(--onaccent)" data-move="${esc(JSON.stringify({ label: 'Accept this trade on ESPN (it can\'t be undone)', type: 'TRADE_ACCEPT', related: m.id, items: [], week: league.scoringPeriodId }))}">Accept</button><button type="button" class="btn do" style="background:var(--bad);color:#fff" data-move="${esc(JSON.stringify({ label: 'Decline this trade on ESPN', type: 'TRADE_DECLINE', related: m.id, items: [], week: league.scoringPeriodId }))}">Decline</button></div>` : ''}</div>`;
}).join('') : '<div class="card empty">Nothing pending right now.</div>'}
</section>

<section id="trades"><h2>Trade ideas</h2><p class="sub">Swaps worth 2+ points a week to you that the other team could see as fair. "Value" counts how hard a player is to replace, so stars at scarce spots like tight end count extra. Offer them in ESPN under Trade.</p>
<div class="card"><select id="tp-team" class="sel" aria-label="Show trades with"><option value="">All teams</option>${teams.filter(t => t !== me).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
<label class="pick" style="border:0;padding-bottom:0"><input type="checkbox" id="tp-loose"> Looser check: also show closer calls (trade ideas worth 1+ point a week to you, fleeces with a weaker pitch)</label></div>
<div class="pool-list" data-step="6">${tradePool.map(t => { const s = myStartersAt(t.after, t.give.pos); return `<div class="card" data-team="${t.team.id}" data-strict="${t.strict ? 1 : 0}"><div class="tag" style="margin-bottom:8px">with <b>${esc(t.team.name)}</b></div><div class="swap">
  <div class="row">${player(t.give, '')}${big(rate(t.give), 'per game, rest of season', null, t.give, 'season')}</div>
  <div class="arrow">for</div>
  <div class="row">${player(t.take, '')}${big(rate(t.take), 'per game, rest of season', null, t.take, 'season')}</div></div>
  <p class="why"><span class="gain">+${n(t.mine)}</span> points per week for you. You get a ${POS_NAME[t.take.pos].toLowerCase()}; they get a ${POS_NAME[t.give.pos].toLowerCase()}${t.theirs > 0.2 ? `, which helps them too (+${n(t.theirs)})` : ''}.
  <br>Your starting ${POS_NAME[t.give.pos].toLowerCase()}${s.length > 1 ? 's' : ''} after: ${s.length ? `${startersText(s)} per game, rest of season` : 'nobody, so you\'d need to pick one up'}.</p>${exBtns([t.give], [t.take], true)}</div>`; }).join('')}${poolEmpty}</div>
${poolMore}
</section>

<section id="fleece"><h2>Fleece finder</h2><p class="sub">Trades that look fair on points per game so far, but the rest-of-season projections say clearly favor you. Only trades with a believable, true pitch show up.</p>
<select id="tp-player" class="sel" aria-label="Player to get" hidden><option value="">Any player</option>${(tradesOpen ? teams : []).filter(t => t !== me).flatMap(t => t.roster.filter(tradeable).sort((a, b) => rate(b) - rate(a)).map(p => `<option value="${p.id}" data-team="${t.id}">${esc(p.name)} (${p.pos})</option>`)).join('')}</select>
<div class="pool-list" data-step="5">${fleecePool.map(f => `<div class="card" data-team="${f.d.t.id}" data-take="${f.take.id}"${f.extra ? ' data-extra="1"' : ''} data-strict="${f.strict ? 1 : 0}"><div class="vhead"><span class="tag">with <b>${esc(f.d.t.name)}</b></span><span class="${f.alt ? 'verdict-meh' : 'verdict-good'}">+${n(f.mine)} a week for you${f.alt ? ', not a fleece' : ''}</span></div>
  <div class="swap"><div class="arrow">you give</div>${f.give.map(p => `<div class="row">${player(p)}${big(rate(p), 'per game, rest of season', null, p, 'season')}</div>`).join('')}
  <div class="arrow">you get</div><div class="row">${player(f.take)}${big(rate(f.take), 'per game, rest of season', null, f.take, 'season')}</div></div>
  <p class="tag" style="margin:6px 0 0">Their situation: ${esc(situation(f.d.t))}. ${esc(profiles.get(f.d.t)?.say[0] ?? '')}</p>
  <p class="why">${f.alt ? 'No clear fleece for this player, so this is your best offer for him. ' : ''}Why it looks fair to them: going by points per game so far, it ${f.looks >= 0.5 ? `helps their lineup by about ${n(f.looks)} a week` : 'comes out about even'}. Going by the rest-of-season projections, ${f.theirs < -0.2 ? `they lose about ${n(-f.theirs)} a week` : f.theirs > 0.2 ? `it helps them too, about ${n(f.theirs)} a week` : 'it comes out about even for them'}.${f.give.length > 1 ? ' They would also have to drop a bench player.' : ''}</p>
  ${exBtns(f.give, [f.take], true)}
  <div class="group">Text to send</div><p class="pitch">${esc(f.texts[0])}</p>
  <div class="tools2"><button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-copy="${esc(f.texts[0])}">Copy text</button>${f.texts.length > 1 ? `<button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-versions="${esc(JSON.stringify(f.texts))}">Another version</button>` : ''}</div>
  <button type="button" class="btn" style="background:var(--chip);color:var(--fg)" data-claude="${esc(claudePrompt(f))}">Have Claude write it (copies the facts, opens Claude)</button>
  ${MOVE_URL ? `<button type="button" class="btn do" data-move="${esc(JSON.stringify({ label: `Propose ${f.give.map(p => p.name).join(' + ')} for ${f.take.name} on ESPN`, type: 'TRADE_PROPOSAL', other: f.d.t.id, sms: f.d.t.name, items: [...f.give.map(p => ({ type: 'GIVE', playerId: p.id })), { type: 'GET', playerId: f.take.id }], week: league.scoringPeriodId }))}">Propose on ESPN, then text them</button>` : ''}</div>`).join('')}${poolEmpty}</div>
${poolMore}
</section>

<section id="buysell"><h2>Buy low, sell high</h2><p class="sub">Touchdown luck over the last 5 games: how many touchdowns he scored vs how many his chances near the goal line usually bring (this season's rate at his position). The chances repeat week to week; scoring on them mostly doesn't, so lucky and unlucky streaks tend to even out. Most managers judge by recent points, which is the opening.</p>
${sellHigh.length ? `<div class="group">Sell high: yours, scoring above his role</div><div class="list">${sellHigh.map(x => `<div class="card"><div class="row">${player(x.p)}${big(x.l.got, `per game, last ${x.l.games}`, null, x.p, 'season')}</div>
  <p class="why">${esc(roleText(x.l))}. With normal touchdown luck he'd be at about <b>${n(x.l.worth)}</b> a game, not ${n(x.l.got)}, so expect him to cool off. His numbers look great to other managers right now, so this is when he gets the most back in a trade. Try him in the Trade checker.</p></div>`).join('')}</div>` : '<div class="card empty">None of your players are running way above their role right now.</div>'}
${buyLow.length ? `<div class="group">Buy low: theirs, scoring below his role</div><div class="list">${buyLow.map(x => `<div class="card"><div class="tag" style="margin-bottom:8px">on <b>${esc(x.t.name)}</b> &middot; ${esc(situation(x.t))}</div><div class="row">${player(x.p)}${big(x.l.got, `per game, last ${x.l.games}`, null, x.p, 'season')}</div>
  <p class="why">${esc(roleText(x.l))}. With normal touchdown luck he'd be at about <b>${n(x.l.worth)}</b> a game, not ${n(x.l.got)}. The chances are what stick, so expect the touchdowns to come, and his manager sees the low number. Pick ${esc(x.t.name)} in Fleece finder and choose him to see your best offer.</p></div>`).join('')}</div>` : '<div class="card empty">Nobody on other teams is running way below his role right now.</div>'}
</section>

<section id="partners"><h2>Trade partners</h2><p class="sub">Who's short at a position and who has extra. The best trades are with teams that have extra of what you're short on, and are short on what you have extra of.</p>
<div class="card"><div class="group" style="margin:0 0 6px">Your team</div>
<p class="why" style="margin:0">Short on: <b>${myDepth.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}</b>. Extra: <b>${myDepth.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(p => esc(p.name)).join(', ')})`).join('; ') || 'nothing'}</b>.</p></div>
${(() => { const card = d => `<div class="card"><div class="vhead"><b>${esc(d.t.name)}</b>${d.theyHave.length && d.youHave.length ? '<span class="verdict-good">Good match</span>' : d.theyHave.length ? '<span class="verdict-meh">Has what you need</span>' : ''}</div>
  <div class="worder" style="margin:0 0 6px"><span>Has:</span>${Object.entries(d.count).map(([pos, k]) => `<span>${k} ${pos}${k === 1 ? '' : 's'}</span>`).join('')}</div>
  <p class="tag" style="margin:0">Short on: ${d.short.map(p => POS_NAME[p].toLowerCase()).join(', ') || 'nothing'}.
  ${d.extra.length ? `Extra: ${d.extra.map(([pos, ps]) => `${POS_NAME[pos].toLowerCase()} (${ps.map(lnk).join(', ')})`).join('; ')}.` : 'No extra starters.'}
  ${d.theyHave.length && d.youHave.length ? `<br><b style="color:var(--good)">Pitch:</b> your extra ${d.youHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')} for their extra ${d.theyHave.map(([pos]) => POS_NAME[pos].toLowerCase()).join('/')}.` : ''}</p>
  ${profiles.get(d.t) ? `<p class="why" style="margin:8px 0 0"><b>${esc(situation(d.t))}.</b> ${profiles.get(d.t).say.map(esc).join(' ')}</p>` : ''}</div>`;
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


<section id="season"><h2>Season outlook</h2><p class="sub">How you've really played, and who's coming up.</p>
${week > lastWeek ? '' : `<div class="card"><div class="group" style="margin:0 0 10px">Playoff chances</div><div class="stat">
  <div><b style="color:var(--${playoffPct >= 50 ? 'good' : 'bad'})">${playoffPct}%</b><small>chance you make the playoffs (top ${playoffTeams})</small></div>
  <div><b>${me.w}-${me.l}</b><small>now, with ${lastWeek - week + 1} games left</small></div></div>
  <p class="why">From playing out the rest of the season 10,000 times with everyone's projected lineups. What it takes:</p>
  <div class="worder" style="margin:0">${recordOdds.map(([wins, pct]) => `<span class="${pct >= 50 ? 'me' : ''}">${wins}-${lastWeek - wins}: ${pct}% get in</span>`).join('')}</div></div>`}
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
    : apPct < realPct - 0.08 ? 'You\'ve been <b>lucky</b>: your record is better than your points. Keep improving the lineup.'
    : 'Your record matches how you\'ve played.'}${pfRank > teams.length / 2 ? ' Your team scores less than most, so pickups and trades matter.' : ''}</p></div>
${ahead.length ? `<div class="card"><div class="group" style="margin:0 0 4px">Your schedule ahead</div><table>
${ahead.map(g => `<tr><td class="num" style="text-align:left">Wk ${g.week}</td><td>${esc(g.t.name)} <span class="tag">${g.t.w}-${g.t.l}</span></td><td class="num">proj ~${Math.round(g.proj)}${g.off.length ? `<br><small>no ${esc(g.off.map(p => p.name.split(' ').pop()).join(', '))}</small>` : ''}</td><td style="text-align:right"><span class="lv ${g.level}">${g.level}</span></td></tr>`).join('')}</table>
<p class="tag">Each opponent's best lineup that week (ESPN's projection, so NFL matchups count; byes and injured players left out) vs the league average that week. "No" lists their starters who are off. Missing 15+ points of starters makes it easy.</p></div>` : ''}
</section>

<section id="league"><h2>League</h2><p class="sub">Dashed line = playoff cutoff. Waiver # = who gets first pick of new players (1 goes first).</p>
<div class="card"><table><tr><td class="num" style="text-align:left">#</td><td class="num" style="text-align:left">Team</td><td class="num">W-L</td><td class="num">Points</td><td class="num">Waiver #</td></tr>
${standings.map((t, i) => `<tr data-team="${t.id}" class="${t === me ? 'me' : ''} ${i + 1 === playoffTeams ? 'cut' : ''}"><td class="num" style="text-align:left">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.w}-${t.l}</td><td class="num">${Math.round(t.pf)}</td><td class="num">${t.waiver}</td></tr>`).join('')}</table></div>
${intel.size || othersPending.size ? `<div class="card"><details open><summary>Behind the scenes: trades in progress, and offers and claims that didn't happen</summary>
<p class="tag" style="margin-top:0">The ESPN app doesn't show these. A team that offered a player in a trade is shopping him; a team that tried to claim someone needs that position.</p><table>
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
<dt>Injury tags</dt><dd><b>Might not play</b> (questionable): about 7 in 10 of these players end up playing. The % on each player uses his practices this week from the official NFL injury report: 86% play after a full practice, 71% after a limited one, 29% after none. <b>Probably won't play</b> (doubtful): only about 1 in 15 play. (From Footballguys' count of QB, RB, WR and TE injury reports, 2017 to 2024.) <b>Out</b>: won't play. <b>IR</b>: hurt for weeks; move him to your IR spot so he doesn't take up a bench spot. <b>Day to day</b>: a minor injury ESPN is watching; he hasn't been ruled out, so check his tag again before kickoff.</dd>
<dt>Phone widget</dt><dd>The Home Screen widget (Scriptable) reads <code style="overflow-wrap:anywhere">https://mrbrofo.github.io/Fantasy-app/${WIDGET}</code>. The name is secret so only you can read it; it changes if the site password changes.</dd>
<dt>Waivers vs free agents</dt><dd>Recently dropped players go on <b>waivers</b> for about a day. Your league processes claims ${procText}${runMin != null ? `, starting as early as ${clock(runMin)} Pacific (get claims in before then)` : ''}. Everyone can claim them, and the team with the best waiver # gets him. After that he's a <b>free agent</b>: first to add him gets him.</dd>
<dt>Scoring in this league</dt><dd>Half-point PPR: players get half a point for every catch, on top of points for yards and touchdowns.</dd>
<dt>Where these tips come from</dt><dd>"Expected" points are the average of ESPN's, Rotowire's and CBS Sports' projections, and Vegas betting lines show which games should be high-scoring. Season stats come from ESPN. Breaking news can take a while to reach these sources, so for big decisions it's worth a second opinion.</dd>
</dl></div>
<div class="card"><div class="group" style="margin:0 0 4px">Football dictionary</div><p class="tag" style="margin:0">Every underlined word on this site, A to Z.</p><dl id="dict"></dl></div>
<details class="fold"><summary class="group">More football words (not used on this site)</summary><dl id="dict2" style="padding-bottom:12px"></dl></details></section>

<section id="look"><h2>Settings</h2><div class="card"><div class="group" style="margin:0 0 8px">Look</div><div class="seg" style="margin:0"><button type="button" data-look="term">Terminal</button><button type="button" data-look="classic">Classic</button><button type="button" data-look="glass">Glass</button></div><p class="tag" style="margin:8px 0 0">Saved on this phone. Everything else works the same in all of them.</p></div></section>
${process.env.SITE_PASSWORD ? '<section id="account"><button type="button" id="signout" class="btn" style="background:none;border:1px solid #8886;color:inherit;margin:8px 0 16px">Sign out</button></section>' : ''}
<footer>Updated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET &middot; new data about every 3 minutes &middot; this page checks for it every minute</footer>
</div>
<div id="sheet" hidden><div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="Player details"><button class="sheet-x" type="button" data-close aria-label="Close">&times;</button><div class="sheet-body"></div></div></div>
<script type="application/json" id="pdata">__PDATA__</script>
<script type="application/json" id="rdata">__RDATA__</script>
<script type="application/json" id="snap">${JSON.stringify(snap).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="facts">${JSON.stringify(facts).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="live">${JSON.stringify(MOVE_URL && process.env.SITE_PASSWORD ? { url: MOVE_URL, token: crypto.createHash('sha256').update(process.env.SITE_PASSWORD + ':live').digest('hex'), week, me: me.id, teams: Object.fromEntries(teams.map(t => [t.id, t.name])) } : null)}</script>
<script>
// Load the newest build when there is one: on the button, every minute, and when you come back to the app.
// GitHub caches pages ~10 min, so a timestamped URL is used to skip the cache.
let built = +document.querySelector('meta[name=built]').content;
const code = document.querySelector('meta[name=code]')?.content;
const btn = document.getElementById('refresh'), ago = document.getElementById('ago');
const fresh = () => location.pathname + '?t=' + Date.now();
// cron-job.org starts a run on each 3-minute mark and it takes ~90s to publish, so the next
// update is the mark after the one that made this build, plus 90s. GitHub can run late; then "any moment".
const STEP = 3 * 60000, PUBLISH = 90000;
const nextAt = () => Math.floor(built / STEP) * STEP + STEP + PUBLISH;
let lastCheck = 0;
function showAgo() {
  const m = Math.round((Date.now() - built) / 60000);
  // updates normally land every few minutes; 30+ minutes means they're failing
  const stale = document.getElementById('stale');
  stale.hidden = m < 30;
  if (m >= 30) document.getElementById('staletext').textContent = 'The last update was ' + (m < 120 ? m + ' minutes' : Math.round(m / 60) + ' hours') + ' ago, so the advice below may be out of date. If it lasts, ask Claude to check the GitHub runs (the ESPN login may have expired).';
  const left = Math.ceil((nextAt() - Date.now()) / 1000);
  const next = left > 0 ? 'next in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'next any moment';
  ago.textContent = (m < 1 ? 'updated just now' : m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + ' hr ago') + ' \\u00b7 ' + next + liveNote;
  if (ready) { if (!busy()) load(); return; }
  // once the countdown is over, look for the new version every 15s instead of every minute
  if (left <= 0 && !document.hidden && Date.now() - lastCheck > 15000) { lastCheck = Date.now(); check(false); }
}
// A new build usually only changes numbers and text (same code). Then it's decrypted with the key this phone saved
// and merged into the open page (idiomorph), so nothing reloads and you keep your place. Left as they are: an open
// player, the menu bar, the trade and compare tools, and any section where you changed a menu or box.
// A build with new code still needs a reload: that happens by itself only when it can't interrupt anything
// (not within a minute of a tap or scroll, not with a player open, never once a menu or box was changed);
// otherwise the Refresh button turns into "New update, tap to load".
let touched = 0, changed = false, ready = false, morphLib = null;
const changedIn = new Set();
['pointerdown', 'keydown', 'scroll'].forEach(t => addEventListener(t, () => { touched = Date.now(); }, { capture: true, passive: true }));
document.addEventListener('change', ev => { changed = true; const s = ev.target.closest('section'); if (s) changedIn.add(s); }, true);
const busy = () => changed || Date.now() - touched < 60000 || !document.getElementById('sheet').hidden;
function load() {
  try { sessionStorage.setItem('scroll', document.body.scrollTop); } catch {}
  location.replace(fresh() + location.hash);
}
const verdictText = ${verdictText.toString()};
const KEEP = /^(sheet|gloss|fab|changes|lv-tx|tc-|cmp-|tp-|seg|dict|bg-)/;
const keep = n => n.nodeType === 1 && (KEEP.test(n.id) || n.tagName === 'NAV' || (n.tagName === 'SCRIPT' && !n.type) || n.classList?.contains('blob') || changedIn.has(n));
async function swap(html) {
  let page = html;
  const m = html.match(/salt: '([^']+)', iv: '([^']+)', data: '([^']+)'/);
  if (m) {
    let saved = null;
    try { saved = localStorage.getItem('siteKey'); } catch {}
    if (!saved) return false;
    const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', b(saved), 'AES-GCM', false, ['decrypt']);
    page = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(m[2]) }, key, b(m[3])));
  }
  const doc = new DOMParser().parseFromString(page, 'text/html');
  morphLib ??= new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/idiomorph@0.7.3/dist/idiomorph.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
  await morphLib;
  // (the body's HTML, not the body element: given an element, idiomorph nests a second <body> inside this one)
  Idiomorph.morph(document.body, doc.body.innerHTML, { morphStyle: 'innerHTML', callbacks: { beforeNodeMorphed: o => !keep(o), beforeNodeRemoved: o => !keep(o), beforeAttributeUpdated: a => a !== 'open' } }); // a section you opened stays open
  built = +doc.querySelector('meta[name=built]').content;
  const np = JSON.parse(document.getElementById('pdata').textContent);
  for (const k in P) delete P[k];
  Object.assign(P, np);
  if (typeof R === 'object' && document.getElementById('rdata')) { const nr = JSON.parse(document.getElementById('rdata').textContent); for (const k in R) delete R[k]; Object.assign(R, nr); }
  if (typeof showTab === 'function') showTab(location.hash.slice(1), false);
  if (typeof showLook === 'function') showLook();
  if (!sheet.hidden && P[sheet.dataset.pid]) { body.innerHTML = render(P[sheet.dataset.pid]); drawGc(); }
  else if (!sheet.hidden && sheet.dataset.team && typeof teamPage === 'function') body.innerHTML = teamPage(sheet.dataset.team);
  gloss(document.body);
  liveTick();
  return true;
}
async function check(clicked) {
  if (clicked && ready) return load();
  if (clicked) btn.classList.add('spin');
  try {
    const html = await (await fetch(fresh(), { cache: 'no-store' })).text();
    const next = +(html.match(/name="built" content="(\\d+)"/) || [])[1];
    if (next > built) {
      const same = code && (html.match(/name="code" content="([0-9a-f]+)"/) || [])[1] === code;
      // don't shift the page under a finger that's on it right now; the next check (15s) tries again
      if (same && (clicked || Date.now() - touched > 3000) && await swap(html).catch(() => false)) {
        btn.classList.remove('spin');
        if (clicked) { btn.innerHTML = '&#10003; Updated'; setTimeout(() => (btn.innerHTML = '<span>&#8635;</span> Refresh'), 2500); }
        return;
      }
      if (same && !clicked) return btn.classList.remove('spin');
      if (clicked || !busy()) return load();
      ready = true;
      btn.innerHTML = '<span>&#8635;</span> New update, tap to load';
      btn.style.cssText = 'background:var(--accent);color:var(--onaccent)';
      btn.classList.remove('spin');
      return;
    }
    if (clicked) btn.innerHTML = '&#10003; Up to date';
  } catch { if (clicked) btn.textContent = 'Offline'; }
  btn.classList.remove('spin');
  if (clicked) setTimeout(() => (btn.innerHTML = '<span>&#8635;</span> Refresh'), 2500);
}
// Live scores from the Cloudflare Worker: every 30s while a game is on, every 5 minutes otherwise. Points so far,
// the score, win chance, ESPN's final guess and game clocks change in place.
const LIVE = JSON.parse(document.getElementById('live')?.textContent || 'null');
// liveNote: shown after "updated ... ago" so you can tell live scores are working
let liveOn = false, liveNote = '', LD = null; // LD: the last live answer, for the Watch view
async function liveTick() {
  if (!LIVE || document.hidden) return;
  try {
    const fa = faIds(), r = await fetch(LIVE.url + '?week=' + LIVE.week + (fa.length ? '&fa=' + fa.join(',') : ''), { headers: { 'x-live': LIVE.token } });
    if (!r.ok) { liveNote = ' \u00b7 live scores off (' + (r.status === 401 ? 'password mismatch' : 'ESPN login rejected') + ')'; return showAgo(); }
    const d = await r.json(), $ = id => document.getElementById(id), f = v => (Math.round(v * 10) / 10).toFixed(1);
    LD = d; drawGc(); for (const p of Object.values(P)) if (p.pro) { gcG(p); break; } // starts loading last week's games
    liveOn = Object.values(d.games).some(g => g[0] === 'in');
    liveNote = liveOn ? ' \u00b7 live scores on' : ' \u00b7 live scores ready'; showAgo();
    for (const el of document.querySelectorAll('[data-live]')) {
      const x = d.players[el.dataset.live], pts = Array.isArray(x) ? x[0] : x, g = d.games[el.dataset.pro];
      if (pts == null || !g || (g[0] === 'pre' && !pts)) continue;
      el.hidden = false;
      // like ESPN: yellow while his team has the ball, red inside the other team's 20;
      // a defense (D/ST) is yellow while the other team has the ball, since that's when it's on the field
      const b = g[0] === 'in' ? g[2] || 0 : 0, dst = el.closest('.card')?.querySelector('.pos')?.textContent === 'D/ST';
      const ball = dst ? (b === 3 ? 1 : 0) : b === 3 ? 0 : b;
      el.dataset.ball = ball;
      el.innerHTML = '<b>' + f(pts) + ' pts</b> ' + (g[0] === 'post' ? 'final' : 'so far &middot; ' + e(g[1])) + (ball === 2 ? ' &middot; red zone' : ball ? (dst ? ' &middot; on the field' : ' &middot; has the ball') : '');
      const p = P[el.dataset.live];
      if (p) p.now = { line: [], why: [], ...p.now, pts: f(pts), game: g[0] === 'post' ? 'Game over' : g[0] === 'in' ? 'Playing now (' + g[1] + ')' : g[1] };
    }
    liveProj(d, f); liveExtras(d, f);
    const shift = startShift(d);
    // before games start: my expected total moves with my starters' new numbers (once they start, ESPN's live guess takes over)
    if ($('lv-a') && !(d.me?.pts > 0 || d.opp?.pts > 0)) {
      const a = +$('lv-a').dataset.base + shift, b = +$('lv-b').textContent, top = Math.max(a, b, 1);
      $('lv-a').textContent = f(a); $('lv-abar').style.width = Math.min(100, a / top * 100) + '%'; $('lv-bbar').style.width = Math.min(100, b / top * 100) + '%';
      $('lv-verdict').innerHTML = verdictText(a >= b, f(Math.abs(a - b)), '');
    }
    if (!d.me || !d.opp || !$('lv-wp') || !(d.me.pts > 0 || d.opp.pts > 0)) return;
    $('lv-badge').hidden = false;
    $('lv-score').hidden = false;
    const done = Object.keys(d.games || {}).length && Object.values(d.games).every(g => g[0] === 'post');
    $('lv-score').innerHTML = done ? 'Final score: <b>' + f(d.me.pts) + '</b> to <b>' + f(d.opp.pts) + '</b>.' : 'Score right now: <b>' + f(d.me.pts) + '</b> to <b>' + f(d.opp.pts) + '</b>. Final guess below.';
    if (d.me.win != null) {
      const wp = Math.round(d.me.win * 100);
      $('lv-wp').textContent = wp + '%';
      $('lv-wp').style.color = wp >= 60 ? 'var(--good)' : wp < 40 ? 'var(--bad)' : 'var(--warn)';
      $('lv-wpsrc').textContent = '(ESPN live estimate)';
    }
    if (d.me.proj != null && d.opp.proj != null) {
      const a = d.me.proj, b = d.opp.proj, top = Math.max(a, b, 1);
      $('lv-a').textContent = f(a); $('lv-b').textContent = f(b);
      $('lv-abar').style.width = Math.min(100, a / top * 100) + '%'; $('lv-bbar').style.width = Math.min(100, b / top * 100) + '%';
      const wp = d.me.win == null ? 50 : Math.round(d.me.win * 100), x = done ? d.me.pts : a, y = done ? d.opp.pts : b;
      $('lv-verdict').innerHTML = verdictText(x >= y, f(Math.abs(x - y)), done ? 'final' : wp <= 0 || wp >= 100 ? 'decided' : '');
    }
  } catch {}
}
// Injury news from the same feed: when ESPN changes a player's status or projection, his tag and this week's number
// change right away (Out = 0; cleared = full number). Returns how much my starters' total moved. The rest of the
// advice (lineup, to-do list) catches up with the next build, a few minutes later.
const LIVE_TAG = { QUESTIONABLE: ['Might not play', 'warn'], DOUBTFUL: ['Probably won\\'t play', 'bad'], OUT: ['Out this week', 'bad'], INJURY_RESERVE: ['Hurt long-term (IR)', 'bad'], SUSPENSION: ['Suspended', 'bad'], DAY_TO_DAY: ['Day to day', 'warn'] };
function liveProj(d, f) {
  for (const [id, x] of Object.entries(d.players)) {
    if (!Array.isArray(x)) continue;
    const st = x[1] || 'ACTIVE', espn = x[2];
    for (const c of document.querySelectorAll('[data-chip="' + id + '"]')) {
      if (st === (c.dataset.now || c.dataset.st)) continue;
      c.dataset.now = st;
      c.innerHTML = st === c.dataset.st ? c.dataset.orig ?? c.innerHTML : (c.dataset.orig ??= c.innerHTML, LIVE_TAG[st] ? '<span class="chip ' + LIVE_TAG[st][1] + '">' + LIVE_TAG[st][0] + ' (just now)</span>' : '<span class="chip good">Cleared to play (just now)</span>');
    }
    const p = P[id];
    if (p && st !== (p.liveSt || '')) {
      p.liveSt = st;
      if (['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(st)) p.play = ['no', 'No. ESPN just listed him as ' + LIVE_TAG[st][0].toLowerCase() + '.'];
      else if (st === 'ACTIVE' && p.play?.[0] !== 'yes') p.play = ['yes', 'Yes. ESPN just cleared him to play.'];
    }
    for (const b of document.querySelectorAll('[data-big="' + id + '"]')) {
      const ds = b.dataset, num = s => (s === '' || s == null ? null : +s), r1 = v => (v == null ? null : Math.round(v * 10) / 10);
      const newEspn = espn == null ? r1(num(ds.espn)) : r1(espn);
      if (st === (ds.lst || ds.st) && newEspn === (ds.lespn != null ? num(ds.lespn) : r1(num(ds.espn)))) continue;
      ds.lst = st; ds.lespn = newEspn ?? '';
      // the other sources only count when ESPN has a number (same rule as the build)
      const srcs = newEspn == null ? [] : [newEspn, num(ds.roto), num(ds.cbs)].filter(v => v != null);
      const pct = ['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(st) ? 0 : st === ds.st && ['QUESTIONABLE', 'DOUBTFUL'].includes(st) ? +ds.odds : st === 'DOUBTFUL' ? 7 : st === 'QUESTIONABLE' ? 71 : 100;
      const v = srcs.length ? srcs.reduce((t, s) => t + s, 0) / srcs.length * +ds.wind * pct / 100 : 0;
      ds.cur = v; b.textContent = f(v);
    }
  }
}
// The rest of the live feed: pickups someone just took, lineup moves made in the ESPN app, the whole league's
// scores, my trades and claims, and news. Each change shows once, marked "just now"; the next build folds it in.
const SLOT_NAME = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: '', 21: '', 23: 'FLEX' };
const seenLive = new Set();
const moveOf = b => { try { return JSON.parse(b.dataset.move); } catch { return null; } };
// players the site suggests adding: the Worker checks if they're still free
const faIds = () => [...new Set([...document.querySelectorAll('button.do[data-move]')].flatMap(b => (moveOf(b)?.items || []).filter(i => i.type === 'ADD').map(i => i.playerId)))].slice(0, 40);
// my starters' total vs the build: new numbers, plus players moved in or out of the lineup on ESPN
function startShift(d) {
  let shift = 0;
  const seen = new Set();
  for (const b of document.querySelectorAll('[data-big][data-mine]')) {
    const ds = b.dataset;
    if (seen.has(ds.big)) continue;
    seen.add(ds.big);
    const slot = d.lineup?.[ds.big], startNow = slot == null ? 'start' in ds : slot !== 20 && slot !== 21;
    shift += (startNow ? +(ds.cur ?? ds.v) : 0) - ('start' in ds ? +ds.v : 0);
  }
  return shift;
}
function txText(t, name, team) {
  const got = t.items.filter(i => i[3] === LIVE.me).map(i => name(i[0])), gave = t.items.filter(i => i[2] === LIVE.me).map(i => name(i[0])), list = a => a.join(', ');
  const swap = got.length || gave.length ? ': you get ' + list(got) + ' for ' + list(gave) : '';
  if (t.type === 'TRADE_PROPOSAL' && t.status === 'PENDING' && t.team !== LIVE.me) return 'New trade offer from ' + team(t.team) + swap + '. See the Trades tab.';
  if (t.type === 'TRADE_PROPOSAL' && /CANCEL|DECLIN|VETO|REJECT/.test(t.status || '')) return (t.team === LIVE.me ? 'Your trade offer' : 'The trade offer from ' + team(t.team)) + ' is off (turned down or canceled).';
  if (t.type === 'TRADE_ACCEPT' || (t.type === 'TRADE_PROPOSAL' && t.status === 'EXECUTED')) return 'Trade done' + (swap ? swap.replace('you get', 'you got') : '') + '.';
  if (t.type === 'WAIVER' && t.status === 'EXECUTED') return 'Your claim went through: added ' + list(got) + (gave.length ? ', dropped ' + list(gave) : '') + '.';
  if (t.type === 'WAIVER' && /^FAILED/.test(t.status || '')) return 'Your claim for ' + list(t.items.filter(i => i[1] === 'ADD').map(i => name(i[0]))) + ' did not go through.';
  if (t.type === 'FREEAGENT' && t.status === 'EXECUTED') return 'Added ' + list(got) + (gave.length ? ', dropped ' + list(gave) : '') + '.';
  return '';
}
function liveExtras(d, f) {
  const name = id => d.names?.[id] || P[id]?.name || 'a player', team = id => (id === LIVE.me ? 'you' : LIVE.teams?.[id] || 'another team');
  for (const b of document.querySelectorAll('button.do[data-move]')) {
    const m = moveOf(b), card = b.closest('.card');
    if (!m || !card) continue;
    // a suggested pickup someone else just took
    const add = (m.items || []).find(i => i.type === 'ADD'), t = add && d.taken?.[add.playerId];
    if (t && t !== LIVE.me && !card.dataset.taken) {
      card.dataset.taken = 1; b.disabled = true; b.textContent = 'Taken by ' + team(t);
      card.insertAdjacentHTML('afterbegin', '<span class="chip bad">' + e(name(add.playerId)) + ' was just taken by ' + e(team(t)) + '</span>');
    }
    // a lineup move the site suggested that's now done on ESPN
    const ln = (m.items || []).filter(i => i.type === 'LINEUP');
    if (m.type === 'ROSTER' && ln.length && !b.dataset.done && ln.every(i => d.lineup?.[i.playerId] === i.to)) { b.dataset.done = 1; b.disabled = true; b.textContent = 'Done on ESPN'; }
  }
  // slot labels on My team follow the lineup as set on ESPN
  for (const [id, slot] of Object.entries(d.lineup || {})) for (const el of document.querySelectorAll('#lineup .row [data-pid="' + id + '"]')) {
    const s = el.closest('.row').querySelector('.slot');
    if (s && slot in SLOT_NAME && s.textContent !== SLOT_NAME[slot]) s.textContent = SLOT_NAME[slot];
  }
  // a team's page that's open: its total so far
  for (const el of document.querySelectorAll('[data-teamnow]')) { const x = d.board?.[el.dataset.teamnow]; if (x) el.textContent = f(x[0]); }
  // whole league this week
  if (d.board && Object.values(d.board).some(x => x[0] > 0)) for (const tr of document.querySelectorAll('tr[data-team]')) {
    const x = d.board[tr.dataset.team], now = tr.querySelector('[data-now]'), proj = tr.querySelector('[data-proj]');
    if (!x) continue;
    if (now) now.textContent = f(x[0]);
    if (proj && x[1] != null) proj.textContent = f(x[1]);
  }
  // my trades and claims since this build
  const box = document.getElementById('lv-tx');
  for (const t of (d.tx || []).slice().sort((a, b) => a.date - b.date)) {
    const key = 'tx' + t.id + t.status, text = t.date > built && !seenLive.has(key) && txText(t, name, team);
    if (!text) continue;
    seenLive.add(key);
    box?.insertAdjacentHTML('afterbegin', '<div class="card" style="margin-bottom:10px"><span class="chip warn" style="margin:0 6px 0 0">Just now</span>' + e(text) + '</div>');
  }
  // news on players in my matchup since this build
  const list = document.querySelector('#news .list');
  for (const x of (d.news || []).slice().sort((a, b) => a.t - b.t)) {
    if (!(x.t > built) || seenLive.has('n' + x.id)) continue;
    seenLive.add('n' + x.id);
    const p = P[x.pid];
    if (p) { p.liveNews = [x, ...(p.liveNews || [])]; if (!sheet.hidden && sheet.dataset.pid == x.pid) { body.innerHTML = render(p); drawGc(); } }
    list?.insertAdjacentHTML('afterbegin', '<div class="card"><div class="vhead"><span data-pid="' + x.pid + '" class="lnk">' + e(name(x.pid)) + '</span><span class="chip warn" style="margin:0">Just in</span></div><p class="why" style="margin:6px 0 0">' + e(x.h) + '</p></div>');
  }
}
// every 30s while the page is open (a phone in your pocket doesn't ask); the Worker shares one ESPN answer per 20s
(function liveLoop() { liveTick().finally(() => setTimeout(liveLoop, 30000)); })();
try { const y = sessionStorage.getItem('scroll'); if (y) { sessionStorage.removeItem('scroll'); document.body.scrollTo(0, +y); } } catch {}
btn.onclick = () => check(true);
showAgo(); setInterval(showAgo, 1000);
// coming back to the app counts as idle (you weren't mid-tap), unless a menu or box was changed
document.addEventListener('visibilitychange', () => { if (!document.hidden) { touched = 0; ready ? !busy() && load() : check(false); liveTick(); } });

// Player sheet: tap any player to see, in plain English, if he plays, when, how he's been doing, and news.
const P = JSON.parse(document.getElementById('pdata').textContent);
const sheet = document.getElementById('sheet'), body = sheet.querySelector('.sheet-body');
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let gcOpen = false; // the Watch view is open on this sheet
function render(p) {
  const max = Math.max(1, ...p.games.map(g => g.pts ?? 0));
  return '<div class="sh-top">' + (document.querySelector('[data-pid="' + p.id + '"] .pic')?.outerHTML ?? '') +
    '<div><div class="sh-name">' + e(p.name) + '</div><div class="meta">' + e(p.posName) + ' &middot; ' + e(p.teamName) + '</div><div class="tag">' + e(p.owner) + '</div></div></div>' +
    '<div class="sh-q ' + p.play[0] + '"><small>Will he play this week?</small><b>' + e(p.play[1]) + '</b>' + (p.game ? '<span>' + e(p.game) + '</span>' : '') + '</div>' +
    (p.advice ? '<div class="sh-q ' + p.advice[0] + '"><small>What to do</small><b>' + e(p.advice[1]) + '</b></div>' : '') +
    (g => LD?.field?.[g?.[3]] || g?.[0] === 'post' ? (l => '<button type="button" class="btn" data-watch data-label="' + l + '">' + (gcOpen ? 'Hide the game' : l) + '</button><div id="gc"' + (gcOpen ? '' : ' hidden') + '></div>')(LD.field?.[g[3]] ? 'Watch his game live' : g.last ? 'Watch his plays last week' : 'Watch his plays') : '')(gcG(p)) +
    (p.liveNews?.length ? '<div class="group">Just in</div>' + p.liveNews.map(x => '<p class="why" style="margin:4px 0 0">' + e(x.h) + '</p>').join('') : '') +
    (p.now ? '<div class="group">This week so far</div><p class="why" style="margin:0"><b>' + e(p.now.pts) + ' points</b> &middot; ' + e(p.now.game) + '</p>' +
      (p.now.line.length ? '<ul class="pline">' + p.now.line.map(x => '<li>' + e(x) + '</li>').join('') + '</ul>' : '') +
      (p.now.why?.length ? '<p class="why" style="margin:6px 0 0"><b>Why:</b> ' + e(p.now.why.join(' ')) + '</p>' : '') : '') +
    (p.plays.length ? '<details class="plays"' + (p.plays.length <= 8 ? ' open' : '') + '><summary><b>His plays this game</b> (' + p.plays.length + ', newest first)</summary>' +
      p.plays.map(x => '<p' + (x.td ? ' class="td"' : '') + '><small>' + e(x.when) + '</small> ' + e(x.text) + '</p>').join('') + '</details>' : '') +
    '<div class="stat">' +
      '<div><b>' + e(p.proj) + '</b><small>expected this week' + (p.ceiling ? ' (up to ' + e(p.ceiling) + ')' : '') + '</small></div>' +
      '<div><b>' + e(p.avg) + '</b><small>points per game this season</small></div>' +
      '<div><b>' + e(p.rank) + '</b><small>' + e(p.rankWhy || 'rank at his position') + '</small></div>' +
      '<div><b>' + e(p.started) + '</b><small>of ESPN managers start him</small></div></div>' +
    (p.trend ? '<p class="why"><b>' + e(p.trend) + '</b></p>' : '') +
    (p.hit ? '<div class="group">How often he connects</div><p class="why" style="margin:0">' + e(p.hit) + '</p>' : '') +
    (p.sources ? '<div class="group">Where "expected" comes from</div><p class="why" style="margin:0">' + e(p.sources) + '</p>' : '') +
    (p.notes.length ? '<div class="group">What&rsquo;s affecting him</div>' + p.notes.map(t => '<p class="why" style="margin:0 0 6px">' + e(t) + '</p>').join('') : '') +
    (p.rosText ? '<div class="group">Rest of the season</div><p class="why" style="margin:0">' + e(p.rosText) + '</p>' : '') +
    (p.games.length ? '<div class="group">Last games (fantasy points)</div><div class="bars">' + p.games.map(g =>
      '<div><i style="height:' + (g.pts == null ? 0 : Math.max(4, g.pts / max * 64)) + 'px"></i><b>' + (g.pts == null ? e(g.note) : g.pts.toFixed(1)) + '</b><small>wk ' + g.wk + '</small></div>').join('') + '</div>' +
      p.games.filter(g => g.why.length || g.line.length).map(g => '<p class="why" style="margin:8px 0 0"><b>Week ' + g.wk + (g.pts == null ? '' : ' (' + g.pts.toFixed(1) + ' pts)') + ':</b> ' + e(g.line.join(', ')) + (g.line.length && g.why.length ? '. ' : '') + e(g.why.join(' ')) + '</p>').join('') : '') +
    '<div class="group">Bye week</div><p class="why" style="margin:0">' + e(p.byeText) + '</p>' +
    (p.news.length ? '<div class="group">Latest news</div>' + p.news.map(x => '<a class="news" href="' + e(x.url) + '" target="_blank" rel="noopener"><b>' + e(x.h) + '</b>' + (x.s ? '<span class="nsnip">' + e(x.s) + '</span>' : '') + '<small>' + e(x.when) + ' &rsaquo;</small></a>').join('') : '') +
    (p.id > 0 ? '<a class="news" href="https://www.espn.com/nfl/player/_/id/' + p.id + '" target="_blank" rel="noopener"><b>Full stats and news on ESPN</b><small>opens ESPN &rsaquo;</small></a>' : '') + toolBtns(p) + addHim(p);
}
// Watch: his game right now, like ESPN's gamecast. Score, down, a field with the drive, the last play,
// the starters from my matchup in that game, and the game's leaders. Redrawn on every live update.
// The live marks drawn over field.webp, a Blender render (1600x490). x is yards from the left end line (0-120),
// z yards from the near sideline (0-53.3). Numbers come from the render's camera: the near sideline is 13.28 px a
// yard wide at y 402.8, the far one 9.11 px a yard at y 102.9; one yard up is 0.868 of a yard across.
function gcField(F, A, H, ball, from, first, fx) {
  const k = z => 1 / (0.075309 + 0.00064582 * z);
  const pt = (x, z, up = 0) => { const s = k(z); return [800 + (x - 60) * s, 402.79 + (s - 13.2787) * 72.0 - up * 0.868 * s]; };
  const xy = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const quad = (x1, x2, z1, z2, attrs) => '<polygon points="' + [pt(x1, z1), pt(x2, z1), pt(x2, z2), pt(x1, z2)].map(xy).join(' ') + '" ' + attrs + '/>';
  const line = (x, col) => { const p = pt(x, 0), q = pt(x, 53.3); return '<line x1="' + xy(p).replace(',', '" y1="') + '" x2="' + xy(q).replace(',', '" y2="') + '" stroke="' + col + '" stroke-width="7"/>'; };
  // a touchdown: the scoring team's end zone glows in its colour and TOUCHDOWN is painted across it, lying flat on the turf
  const td = F.play?.[4], tdLeft = td && F.play[2] !== A[0], tdTeam = td && F.teams.find(t => t[0] === F.play[2]);
  // something lying flat in an end zone, centred z yards from the near sideline: one unit is one yard, it reads along
  // the end zone with its top toward the end line (an affine stand-in for the perspective, close enough over a few yards)
  // given a width w, the frame is fitted to that many yards so both ends land where the perspective puts them
  const flat = (x1, z, w) => { const sg = x1 ? -1 : 1, u = w || 2, c = pt(x1 + 5, z), r = pt(x1 + 6, z), a = pt(x1 + 5, z - sg * u / 2), b = pt(x1 + 5, z + sg * u / 2), o = w ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : c;
    return 'matrix(' + [(b[0] - a[0]) / u, (b[1] - a[1]) / u, (r[0] - c[0]) * sg, (r[1] - c[1]) * sg, o[0], o[1]].map(v => v.toFixed(3)).join(' ') + ')'; };
  const painted = (x1, el) => '<clipPath id="gcP' + x1 + '">' + el.replace(/ stroke="[^"]*"| stroke-width="[^"]*"/g, '') + '</clipPath><g filter="url(#gcSoft)" opacity=".86">' + el + '</g>' +
    '<image href="field.webp" width="1600" height="490" clip-path="url(#gcP' + x1 + ')" style="mix-blend-mode:multiply" opacity=".45"/>';
  const logo = abbr => 'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/' + e(String(abbr).toLowerCase()) + '.png&amp;w=200';
  // the team's nickname in block letters, white with an outline in its second colour (dark when that colour is near white),
  // stretched to a set length, with a small logo past each end
  const ink = t => { const alt = /^[0-9a-f]{6}$/i.test(t[4] || '') ? t[4] : '000000';
    return '#' + (parseInt(alt.slice(0, 2), 16) * 0.3 + parseInt(alt.slice(2, 4), 16) * 0.59 + parseInt(alt.slice(4), 16) * 0.11 > 200 ? '111' : alt); };
  const logos = (x1, t, len) => [-1, 1].map(sd => '<image href="' + logo(t[1]) + '" x="-3" y="-3" width="6" height="6" transform="' + flat(x1, 26.65 + sd * (len / 2 + 4.2)) + '"/>').join('');
  const name = (x1, t) => { const n = String(t[5] || t[1]).toUpperCase(), len = Math.min(34, n.length * 4.6);
    return painted(x1, '<text transform="' + flat(x1, 26.65, len) + '" font-size="5.6" font-weight="900" fill="#fff" stroke="' + ink(t) + '" stroke-width=".4" stroke-linejoin="round" style="paint-order:stroke" text-anchor="middle" dominant-baseline="central" textLength="' + len + '" lengthAdjust="spacingAndGlyphs">' + e(n) + '</text>') + logos(x1, t, len); };
  // TOUCHDOWN painted big across the scoring end zone: slanted block letters with a thick outline in the team's second
  // colour, with a dark step under them so they stand up off the turf, a logo past each end
  const tdWord = (x1, t) => { const len = 36, c = ink(t), w = at => '<text transform="' + flat(x1, 26.65, len) + '" font-size="6.6" font-weight="900" font-style="italic" text-anchor="middle" dominant-baseline="central" textLength="' + len + '" lengthAdjust="spacingAndGlyphs"' + at + '>TOUCHDOWN</text>';
    return painted(x1, [0.75, 0.5, 0.25].map(d => w(' x="' + d * 0.6 + '" y="' + d + '" fill="#000" fill-opacity=".55"')).join('') + w(' fill="#fff" stroke="' + c + '" stroke-width="1" stroke-linejoin="round" style="paint-order:stroke"')) + logos(x1, t, len); };
  const zone = (x1, t, scored) => { return quad(x1, x1 + 10, 0, 53.3, 'fill="#' + e(t[3] || '333') + '" style="mix-blend-mode:multiply"') +
    (scored ? '<g class="gc-tdz" style="opacity:.7">' + quad(x1, x1 + 10, 0, 53.3, 'fill="#' + e(tdTeam[3] || '333') + '"') + quad(x1, x1 + 10, 0, 53.3, 'fill="#fff" fill-opacity=".25"') + '</g><g class="gc-tdt">' + tdWord(x1, tdTeam) + '</g>' : '') +
    (scored ? '' : name(x1, t)); };
  const mid = (() => { const c = pt(60, 26.65), r = pt(61, 26.65), d = pt(60, 25.65); return 'matrix(' + [r[0] - c[0], r[1] - c[1], d[0] - c[0], d[1] - c[1], c[0], c[1]].map(v => v.toFixed(3)).join(' ') + ')'; })();
  const midLogo = '<image href="' + logo(H[1]) + '" x="-6.5" y="-6.5" width="13" height="13" opacity=".82" transform="' + mid + '"/>';
  // crowd0-5.webp are the stands (the top 240 rows of field.webp) six times over, fans jumping each on their own beat;
  // the page shows them in turn, nonstop
  let o = '<image href="field.webp" width="1600" height="490"/>' + [0, 1, 2, 3, 4, 5].map(i => '<image class="gc-crowd" href="crowd' + i + '.webp" width="1600" height="240" style="animation-delay:-' + (i * 0.13).toFixed(2) + 's"/>').join('') + zone(0, A, td && tdLeft) + zone(110, H, td && !tdLeft) + midLogo;
  if (F.poss && !td) o += quad(fx(Math.min(from, ball)), fx(Math.max(from, ball)), 21, 32.3, 'fill="#fff" fill-opacity=".1"');
  if (first != null) o += line(fx(first), '#f5d90a');
  let cam = null;
  if (F.poss || td) {
    if (!td) o += line(fx(ball), '#3b82f6');
    const key = F.last + '|' + F.play;
    if (key !== gcKey) { gcKey = key; gcAt = Date.now(); }
    gcFly = null;
    // the last play, by kind: a pass or a kick arcs through the air, a run or a sack lies flat on the turf. ESPN gives no
    // spot for an incompletion, so it lands 8 yards past the line, 20 if deep; a field goal flies from the hold, 7 yards
    // back, to the posts on the end line (a good one on through, coming down past them); a touchdown ends with the scorer in the middle of the end zone
    const [y0 = 0, y1 = 0, tid, type = ''] = F.play || [], own = y => tid === A[0] ? y : 100 - y;
    const kind = /field goal|extra point/i.test(type) ? (/good/i.test(type) ? 'fg' : /block/i.test(type) ? 'block' : 'miss') : /incomplet/i.test(type) ? 'inc' : /punt|kickoff/i.test(type) ? 'kick' : /interception/i.test(type) ? 'pick' : /pass|reception/i.test(type) ? 'pass' : 'run';
    // an interception lands where it was picked ("INTERCEPTED by D.Overshown at DAL 30"), not where the return ended
    const pk = kind === 'pick' && / at ([A-Z]+) ([0-9]+)/.exec(F.last.split('INTERCEPTED')[1] ?? ''), pick = pk ? (pk[1] === F.teams.find(t => t[0] === tid)?.[1] ? +pk[2] : 100 - pk[2]) : y1;
    const hold = /fg|miss|block/.test(kind), sx = fx(own(hold ? y0 - 7 : y0));
    // where the play started: a dashed line, next to the blue one where the ball is now
    if (F.play && Math.abs(fx(own(y0)) - fx(ball)) > 0.5) o += line(fx(own(y0)), '#fff').replace('/>', ' stroke-dasharray="14 10" stroke-opacity=".7"/>');
    const post = fx(own(110)), lx = td ? fx(ball) : kind === 'fg' ? post + Math.sign(post - sx) * Math.min(8, 3 + Math.abs(post - sx) * 0.2) : fx(own(kind === 'miss' ? 110 : kind === 'block' ? y0 - 5 : kind === 'inc' ? y0 + (/ deep /.test(F.last) ? 20 : 8) : kind === 'pick' ? pick : y1)), dl = Math.abs(lx - sx);
    // across the field: a play starts in the middle and ends on the side the play text names ("pass short left",
    // "right end", "up the middle"), from the offense's view; facing right on screen its left is the far sideline (z up)
    const sd = /(?:short|deep) (left|right)|(left|right) (end|tackle|guard)/.exec(F.last || ''), z0 = 26.65,
      z1 = !sd || !/run|pass|inc|pick/.test(kind) || td ? z0 : z0 + (sd[1] ? 13 : { end: 15, tackle: 9, guard: 5 }[sd[3]]) * ((sd[1] || sd[2]) === 'left' ? 1 : -1) * Math.sign(fx(own(100)) - fx(own(0)));
    // every play throws its own ball, picked from the play itself so a replay flies the same: how high, how much the air
    // slows it (fast off the foot or hand, slower at the end, so it comes down steeper than it went up), how fast it turns
    const rnd = (() => { let h = 2166136261; for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => (h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909), (h >>> 0) / 4294967296); })();
    const kicked = /fg|miss|kick|block/.test(kind), drag = kicked ? 0.8 + rnd() * 0.7 : 0.25 + rnd() * 0.5;
    let H = (kind === 'run' || kind === 'block' ? 0 : /fg|miss|kick/.test(kind) ? Math.min(17.5, 3 + dl * 0.28) : dl >= 5 ? Math.min(7, 1.5 + dl * 0.22) : 0) * (0.8 + rnd() * 0.45);
    // height at a share u of the way there: the flight's time at u, then up and down over that time
    const tau = u => -Math.log(1 - u * (1 - Math.exp(-drag))) / drag, up = u => { const tm = tau(u); return H * 4 * tm * (1 - tm); };
    // a good field goal goes through the uprights: over the crossbar (10 feet, 3.3 yards up) with room to spare, under their tops
    if (kind === 'fg') { const tp = tau(Math.abs(post - sx) / dl); H = Math.min(22, (8 + rnd() * 3) / (4 * tp * (1 - tp))); }
    // lost yards, an interception, a missed or blocked kick: red; an incompletion: faint grey
    const bad = !td && ((y1 < y0 && /run|pass/.test(kind)) || /pick|miss|block/.test(kind)), grey = kind === 'inc';
    const p = pt(F.play ? lx : fx(ball), z1), pb = pt(fx(ball), z1), s = k(z1), X = p[0].toFixed(1);
    // an interception: the defender runs in from a few yards downfield, catches it where it was picked, and carries it back
    // to where the return ended (px: the same sideline distance, so only x moves)
    const run = kind === 'pick' && F.play ? pt(lx + 4 * Math.sign(lx - sx || 1), z1)[0] - p[0] : 0, ret = run && Math.abs(fx(ball) - lx) > 0.5 ? pb[0] - p[0] : 0, pe = ret ? pb : p;
    if (F.play) {
      const path = lift => Array.from({ length: 31 }, (_, i) => { const u = i / 30; return pt(sx + (lx - sx) * u, z0 + (z1 - z0) * u, lift ? up(u) : 0); });
      cam = (pt(sx, 26.65)[0] + p[0]) / 2;
      // a thrown ball spirals, a kicked one tumbles end over end
      gcFly = { b: path(true), g: path(false), x0: pt(sx, 26.65)[0], spin: !H ? '' : /pass|inc|pick/.test(kind) ? 'spiral' : kicked ? 'tumble' : '', drag: H ? drag : 0, rate: kicked ? 1.5 + rnd() * 1.2 : 1.8 + rnd() * 1.2, // a spiral stays under 3 turns a second: spin.webp's 16 frames faster than a 60Hz screen would look like it turns backwards
        run, ret, inc: kind === 'inc' && s, a0: rnd() * 360, f0: Math.floor(rnd() * 16), wob: rnd() * rnd() * 7, wf: 1.5 + rnd() * 2.5, td:td && { c: pt(tdLeft ? 5 : 115, 26.65), cols: ['#' + (tdTeam[3] || 'fff'), '#' + (tdTeam[4] || 'fff'), '#fff'] } };
    }
    // a wide arrow from where the play started to the ball; the tip stops short of the ball so it shows (less on a short play)
    if (F.play) {
      // laid out on the turf in yards: along the play (dx, dz) and across it (the normal), so it keeps its shape at any angle
      const D = Math.hypot(lx - sx, z1 - z0) || 1, dx = (lx - sx) / D, dz = (z1 - z0) / D, len = D - Math.min(1.5, D * 0.1);
      if (len > 1) {
        // the camera squashes yards across the field to about 1/2.3 of yards along it, so a width that points along the
        // field is narrowed to match: the arrow looks as thick at any angle as it does going straight down the field
        const uh = 1 - Math.min(4, len * 0.4) / len, thin = 1 / Math.hypot(2.3 * dz, dx);
        const at = (u, w, lift) => { w *= thin; const q = pt(sx + dx * u * len - dz * w, z0 + dz * u * len + dx * w, lift ? up(u * len / D) : 0); return q[0].toFixed(1) + ',' + q[1].toFixed(1); };
        const us = Array.from({ length: 25 }, (_, i) => uh * i / 24), back = [...us].reverse();
        const shape = lift => [...us.map(u => at(u, -2.2, lift)), at(uh, -4.5, lift), at(1, 0, lift), at(uh, 4.5, lift), ...back.map(u => at(u, 2.2, lift))].join(' ');
        const g0 = pt(sx, z0), g1 = pt(sx + dx * len, z0 + dz * len);
        o += '<linearGradient id="gcPlay" gradientUnits="userSpaceOnUse" x1="' + g0[0].toFixed(1) + '" y1="' + g0[1].toFixed(1) + '" x2="' + g1[0].toFixed(1) + '" y2="' + g1[1].toFixed(1) + '"><stop offset="0" stop-color="' + (bad ? '#f87171' : grey ? '#cbd5e1' : '#fff') + '" stop-opacity="' + (grey ? '.25' : '.5') + '"/><stop offset="1" stop-color="' + (bad ? '#ef4444' : grey ? '#cbd5e1' : '#fff') + '" stop-opacity="' + (grey ? '.6' : '.95') + '"/></linearGradient>' +
          (gcFly ? '<clipPath id="gcReveal"><rect x="0" y="0" width="1600" height="600"/></clipPath>' : '') +
          '<g class="gc-trail"' + (gcFly ? ' clip-path="url(#gcReveal)"' : '') + '><polygon points="' + shape(true) + '" fill="url(#gcPlay)"/></g>';
      }
    }
    if (F.play) {
      const who = gcWho(F), r = 31;
      // ESPN's headshots are cut out (transparent), so the player stands on a stem with no frame; no photo: initials in a dot
      const mine = w => td && w.p && Object.values(P).find(q => q.side && q.pro === tid && q.name === w.p.displayName);
      const tag = (w, X, y) => { const q = mine(w); if (!q) return ''; const t = (q.side === 'me' ? 'YOUR TD' : 'THEIR TD') + ' \u00b7 ' + f1(LD?.players?.[q.id]?.[0] ?? 0), wd = t.length * 8.6 + 18;
        return '<rect x="' + (+X - wd / 2).toFixed(1) + '" y="' + (y - 15).toFixed(1) + '" width="' + wd.toFixed(1) + '" height="22" rx="11" fill="' + (q.side === 'me' ? '#16a34a' : '#dc2626') + '"/><text x="' + X + '" y="' + (y - 4).toFixed(1) + '" font-size="13" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="central" letter-spacing=".4">' + t + '</text>'; };
      const pin = (x, w, i, dx = 0, z = z0) => { const q = pt(x, z), cy = q[1] - 78, X = (q[0] + dx).toFixed(1), Y = cy.toFixed(1);
        // on a touchdown everyone shown hops up and down, each on their own beat
        return '<line x1="' + q[0].toFixed(1) + '" y1="' + q[1].toFixed(1) + '" x2="' + X + '" y2="' + (cy + (w.p ? r : w.logo ? r * 1.1 : 0)).toFixed(1) + '" stroke="#fff" stroke-width="3" stroke-opacity=".8"/><g' + (td ? ' class="gc-hop"' + (i ? '' : ' style="animation-delay:-.27s"') : '') + '>' + tag(w, X, cy - r * 1.32 - 10) +
          (!w.p && w.logo ? '<image href="' + logo(w.logo) + '" x="' + (q[0] + dx - r * 1.1).toFixed(1) + '" y="' + (cy - r * 1.1).toFixed(1) + '" width="' + (r * 2.2).toFixed(1) + '" height="' + (r * 2.2).toFixed(1) + '" style="filter:drop-shadow(0 3px 4px #000a)"/>' +
              '<text x="' + X + '" y="' + (cy - r * 1.1 - 6).toFixed(1) + '" font-size="15" font-weight="600" fill="#fff" fill-opacity=".7" text-anchor="middle" letter-spacing=".5">' + e(w.label) + '</text>'
          : w.p ?'<image href="https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/' + e(w.p.id) + '.png&amp;w=200" x="' + (q[0] + dx - r * 1.6).toFixed(1) + '" y="' + (cy + r - r * 2.32).toFixed(1) + '" width="' + (r * 3.2).toFixed(1) + '" height="' + (r * 2.32).toFixed(1) + '" style="filter:drop-shadow(0 3px 4px #000a)"/>' +
              '<text x="' + X + '" y="' + (cy - r * 1.32 + 10).toFixed(1) + '" font-size="15" font-weight="600" fill="#fff" fill-opacity=".7" text-anchor="middle" letter-spacing=".5">' + e((w.p.shortName ?? w.n).split(' ').pop()) + '</text>'
            : '<circle cx="' + X + '" cy="' + Y + '" r="' + r + '" fill="#2a3340" stroke="#fff" stroke-width="4"/><text x="' + X + '" y="' + Y + '" font-size="26" fill="#fff" text-anchor="middle" dominant-baseline="central">' + e(w.n.split('.').pop().slice(0, 2)) + '</text>') + '</g>'; };
      // two photos close together are pushed apart, their stems leaning to where each stood
      // one player who isn't a runner (a kicker, a passer with no target) stands where the play started
      const gap = pt(lx, z1)[0] - pt(sx, z0)[0], push = Math.max(0, (3.2 * r + 8 - Math.abs(gap)) / 2) * Math.sign(gap || 1), solo = who.length === 1 && kind !== 'run' && !F.dt;
      if (who.length === 2 || solo) o += '<g class="gc-qb">' + pin(sx, who[0], 0, solo ? 0 : -push) + '</g>';
      if (who.length && !solo) o += '<g class="gc-catch"' + (ret ? ' transform="translate(' + ret.toFixed(1) + ' 0)"' : '') + (kind === 'inc' ? ' style="opacity:.45"' : '') + '>' + pin(lx, who[who.length - 1], 1, who.length === 2 ? push : 0, z1) +
        // an interception: a red INTERCEPTED tag under the defender, carried with him on the return
        (kind === 'pick' ? '<g class="gc-int"><rect x="' + (p[0] - 70).toFixed(1) + '" y="' + (p[1] + 18).toFixed(1) + '" width="140" height="26" rx="13" fill="#dc2626"/><text x="' + X + '" y="' + (p[1] + 31).toFixed(1) + '" font-size="13" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="central" letter-spacing="1.5">INTERCEPTED</text></g>' : '') + '</g>';
      // an incomplete pass: the target fades, the ball bounces off the turf, and INCOMPLETE shows under the spot
      if (kind === 'inc') o += '<g class="gc-inc"><rect x="' + (p[0] - 62).toFixed(1) + '" y="' + (p[1] + 18).toFixed(1) + '" width="124" height="26" rx="13" fill="#000" fill-opacity=".6"/><text x="' + X + '" y="' + (p[1] + 31).toFixed(1) + '" font-size="13" font-weight="800" fill="#cbd5e1" text-anchor="middle" dominant-baseline="central" letter-spacing="1.5">INCOMPLETE</text></g>';
    }
    // spin.webp is 16 Blender renders of the ball from the field camera, side by side, each turned 1/16 further around its long
    // axis: each 240x160, its ground point at (120, 106.9), 0.3 yards across is 109 px
    // the ball's middle sits about 32 px above its ground point, its long axis tipped 20 degrees nose up
    const bw = 3.6 * s / 109;
    if (gcFly) gcFly.cy = -32 * bw;
    if (F.rz && !td) o += '<ellipse cx="' + pb[0].toFixed(1) + '" cy="' + pb[1].toFixed(1) + '" rx="' + (3 * s).toFixed(1) + '" ry="' + (1.1 * s).toFixed(1) + '" fill="none" stroke="#ef4444" stroke-width="3" stroke-opacity=".8"/>';
    o += '<g id="gcShad" transform="translate(' + xy(pe).replace(',', ' ') + ')"><ellipse rx="' + (2 * s).toFixed(1) + '" ry="' + (0.6 * s).toFixed(1) + '" fill="url(#gcShadow)"/></g>' +
      '<g id="gcBall" transform="translate(' + xy(pe).replace(',', ' ') + ')"><g id="gcSpin"><svg id="gcFrame" x="' + (-120 * bw).toFixed(1) + '" y="' + (-106.9 * bw).toFixed(1) + '" width="' + (240 * bw).toFixed(1) + '" height="' + (160 * bw).toFixed(1) + '" viewBox="0 0 240 160"><image href="spin.webp" width="3840" height="160"/></svg></g></g>';
  }
  // show the 60% of the field around the play (or the ball), like a TV camera following it
  const cx = Math.max(480, Math.min(1120, cam ?? pt(fx(F.poss ? ball : 50), 26.65)[0]));
  return '<svg class="gc-fs" viewBox="' + (cx - 480).toFixed(0) + ' 0 960 470" role="img" aria-label="' + e((F.teams.find(t => t[0] === F.poss)?.[1] ?? '') + ' ball on ' + F.spot) + '"><defs><filter id="gcSoft"><feGaussianBlur stdDeviation=".45"/></filter><radialGradient id="gcShadow"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' + o + '</svg>';
}
// A new play plays out: the passer fades in over GC_LEAD ms, then over GC_FLY ms the ball moves along gcFly (its path in the air, and its shadow's on the turf)
const GC_LEAD = 250, GC_FLY = 1400, GC_TD = 2300, GC_RET = 1000;
let gcKey = '', gcAt = 0, gcFly = null, gcRun = null;
function gcAnimate() {
  const b = document.getElementById('gcBall'), sh = document.getElementById('gcShad'), F = gcFly, run = gcRun = {};
  const fade = c => document.querySelector('#gc .' + c);
  if (!F || !b) return;
  let conf = null, bits = [], pop = null;
  const step = () => {
    if (!b.isConnected || gcRun !== run) { conf?.remove(); pop?.remove(); b.ownerSVGElement.style.transform = ''; return; }
    const el = Date.now() - gcAt, t = Math.min(1, Math.max(0, (el - GC_LEAD) / GC_FLY)), k = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    // in the air the ball keeps its speed through time, slowed by the air (F.drag); a run slides along easing in and out
    const u = F.drag ? (1 - Math.exp(-F.drag * t)) / (1 - Math.exp(-F.drag)) : k;
    const along = (L, w = u) => { const i = Math.min(L.length - 2, Math.floor(w * (L.length - 1))), r = w * (L.length - 1) - i; return [L[i][0] + (L[i + 1][0] - L[i][0]) * r, L[i][1] + (L[i + 1][1] - L[i][1]) * r]; };
    const [x, y] = along(F.b), [gx, gy] = along(F.g), clip = document.querySelector('#gcReveal rect'), trail = fade('gc-trail');
    b.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    // in flight the ball points along its path: a pass spins on its long axis (spin.webp's frames, the laces rolling
    // around), its nose wobbling a little on some throws; a kick turns end over end. Each slows a bit as it flies, at
    // its own rate (F.rate turns a second). Landed, it lies as drawn
    const sp = document.getElementById('gcSpin'), fr = document.getElementById('gcFrame'), fly = t > 0 && t < 1;
    if (sp && F.spin) {
      const [x2, y2] = along(F.b, Math.min(1, u + 0.02)), dir = x2 < x - 0.01 ? -1 : 1, tilt = Math.atan2(y2 - y, Math.abs(x2 - x) || 1e-3) * 180 / Math.PI;
      const turns = F.rate * t * GC_FLY / 1000 * (1 - 0.2 * t), wob = F.wob * Math.sin(t * GC_FLY / 1000 * F.wf * 2 * Math.PI);
      sp.setAttribute('transform', !fly ? '' : 'translate(0 ' + F.cy.toFixed(2) + ') scale(' + dir + ' 1) rotate(' +
        (F.spin === 'spiral' ? tilt + wob : tilt + F.a0 + turns * 360).toFixed(1) + ') rotate(20) translate(0 ' + (-F.cy).toFixed(2) + ')');
      fr?.setAttribute('viewBox', (!fly ? 0 : F.spin === 'spiral' ? (Math.floor(turns * 16) % 16) * 240 : F.f0 * 240) + ' 0 240 160');
    }
    // the shadow stays on the turf right under the ball, smaller and fainter the higher the ball is
    const hi = Math.max(0, gy - y);
    sh.setAttribute('transform', 'translate(' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ') scale(' + Math.max(0.4, 1 - hi / 220).toFixed(2) + ')');
    sh.setAttribute('opacity', Math.max(0.35, 1 - hi / 260).toFixed(2));
    // interception: the defender closes on the ball while it's in the air, then runs it back with the ball in his hands
    if (F.run) {
      const rt = Math.min(1, Math.max(0, (el - GC_LEAD - GC_FLY) / GC_RET)), dx = t < 1 ? F.run * (1 - t) : F.ret * rt * rt * (3 - 2 * rt);
      fade('gc-catch')?.setAttribute('transform', 'translate(' + dx.toFixed(1) + ' 0)');
      if (fade('gc-int')) fade('gc-int').style.opacity = t < 1 ? 0 : Math.min(1, (el - GC_LEAD - GC_FLY) / 250);
      if (t >= 1 && F.ret) { const [ex, ey] = F.b[F.b.length - 1], bx = (ex + dx).toFixed(1); b.setAttribute('transform', 'translate(' + bx + ' ' + ey.toFixed(1) + ')'); sh.setAttribute('transform', 'translate(' + bx + ' ' + ey.toFixed(1) + ')'); sh.setAttribute('opacity', 1); }
    }
    // incomplete: off the turf in two shrinking hops (about a yard and a half, then a third of that), then the label fades in
    if (F.inc) {
      const bt = (el - GC_LEAD - GC_FLY) / 600, [ex, ey] = F.b[F.b.length - 1];
      if (bt > 0 && bt < 1) b.setAttribute('transform', 'translate(' + ex.toFixed(1) + ' ' + (ey - F.inc * 1.3 * Math.abs(Math.sin(bt * 2 * Math.PI)) * (bt < 0.5 ? 1 : 0.35)).toFixed(1) + ')');
      if (fade('gc-inc')) fade('gc-inc').style.opacity = Math.min(1, Math.max(0, bt / 0.4));
    }
    // the trail shows only behind the ball
    if (clip) { clip.setAttribute('x', t < 1 ? Math.min(F.x0, x).toFixed(1) : 0); clip.setAttribute('width', t < 1 ? Math.abs(x - F.x0).toFixed(1) : 1600); }
    if (fade('gc-qb')) fade('gc-qb').style.opacity = Math.min(1, el / GC_LEAD);
    // touchdown: the end zone flashes and settles, the word fades in, confetti bursts out of the end zone and falls
    const tl = (el - GC_LEAD - GC_FLY) / 1000;
    if (F.td) {
      if (fade('gc-tdz')) fade('gc-tdz').style.opacity = tl < 0 ? 0 : tl < 0.15 ? tl / 0.15 : 0.7 + 0.3 * Math.exp(-(tl - 0.15) * 2.5) * Math.abs(Math.cos((tl - 0.15) * 9));
      if (fade('gc-tdt')) fade('gc-tdt').style.opacity = Math.min(1, Math.max(0, (tl - 1.75) / 0.3));
      const svg = b.ownerSVGElement, NS = 'http://www.w3.org/2000/svg', vb = svg.viewBox.baseVal, mk = (tag, at) => { const n = document.createElementNS(NS, tag); for (const k in at) n.setAttribute(k, at[k]); return n; };
      if (tl >= 0 && !pop) {
        pop = mk('g', {}); svg.appendChild(pop);
        pop.flash = mk('rect', { x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: '#fff' });
        pop.ring = mk('ellipse', { fill: 'none', stroke: '#fff', 'stroke-width': 6 });
        pop.word = mk('g', {});
        // the word stacked from its colour to white, each layer a little up and left, so it stands out of the screen
        for (let i = 7; i >= 0; i--) { const t = mk('text', { x: -i * 1.6, y: -i * 2.2, 'font-size': 92, 'font-weight': 900, 'font-style': 'italic', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'letter-spacing': 2,
          fill: i ? F.td.cols[0] : '#fff', stroke: i ? F.td.cols[0] : F.td.cols[1] === '#fff' ? F.td.cols[0] : F.td.cols[1], 'stroke-width': i ? 6 : 4, 'stroke-linejoin': 'round', 'paint-order': 'stroke' });
          t.textContent = 'TOUCHDOWN!'; if (!i) t.style.filter = 'drop-shadow(0 0 14px ' + F.td.cols[0] + ')'; pop.word.appendChild(t); }
        pop.append(pop.ring, pop.word, pop.flash);
      }
      if (pop) {
        const cx = vb.x + vb.width / 2, cy = vb.y + vb.height * 0.42, [ex, ey] = F.td.c;
        pop.flash.setAttribute('opacity', Math.max(0, 0.7 - tl * 3).toFixed(2));
        const rr = Math.min(1, tl / 0.9); pop.ring.setAttribute('cx', ex); pop.ring.setAttribute('cy', ey); pop.ring.setAttribute('rx', (40 + rr * 420).toFixed(0)); pop.ring.setAttribute('ry', (12 + rr * 120).toFixed(0)); pop.ring.setAttribute('opacity', (1 - rr).toFixed(2));
        const back = u => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2, fl = Math.min(1, Math.max(0, (tl - 1.35) / 0.45)), ease = fl * fl;
        const sc = tl < 0.4 ? back(tl / 0.4) * 1.05 : 1.05 - 0.05 * Math.min(1, (tl - 0.4) / 0.2), wob = Math.sin(tl * 7) * 2 * (1 - fl);
        pop.word.setAttribute('transform', 'translate(' + (cx + (ex - cx) * ease).toFixed(1) + ' ' + (cy + (ey - cy) * ease).toFixed(1) + ') rotate(' + (-6 + wob).toFixed(1) + ') scale(' + (sc * (1 - 0.7 * ease)).toFixed(3) + ')');
        pop.word.setAttribute('opacity', (1 - fl).toFixed(2));
        const sh = tl < 0.45 ? (1 - tl / 0.45) * 9 : 0; svg.style.transform = sh ? 'translate(' + ((Math.random() - 0.5) * sh).toFixed(1) + 'px,' + ((Math.random() - 0.5) * sh).toFixed(1) + 'px)' : '';
      }
      if (tl >= 0 && !conf) {
        conf = document.createElementNS('http://www.w3.org/2000/svg', 'g'); b.ownerSVGElement.appendChild(conf);
        bits = Array.from({ length: 70 }, (_, i) => { const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('width', 10); r.setAttribute('height', 18); r.setAttribute('fill', F.td.cols[i % 3]); conf.appendChild(r);
          return { r, vx: (Math.random() - 0.5) * 520, vy: -260 - Math.random() * 420, spin: (Math.random() - 0.5) * 900 }; });
      }
      if (conf) for (const p of bits) { const x = F.td.c[0] + p.vx * tl, y = F.td.c[1] + p.vy * tl + 450 * tl * tl;
        p.r.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (p.spin * tl).toFixed(0) + ')'); p.r.setAttribute('opacity', Math.max(0, 1 - tl / 1.8).toFixed(2)); }
      if (tl >= GC_TD / 1000 && conf) { conf.remove(); conf = null; pop?.remove(); pop = null; b.ownerSVGElement.style.transform = ''; if (fade('gc-tdz')) fade('gc-tdz').style.opacity = 0.7; }
    }
    if (fade('gc-catch')) fade('gc-catch').style.opacity = Math.min(F.inc ? 0.45 : 1, Math.max(0, (t - (F.run ? 0.3 : 0.6)) / 0.3));
    if (t < 1 || (F.td && conf !== null) || (F.td && tl < 0) || (F.run && el < GC_LEAD + GC_FLY + GC_RET) || (F.inc && el < GC_LEAD + GC_FLY + 700)) requestAnimationFrame(step);
  };
  step();
}
// A team's roster from ESPN, by the short name plays use ("T.McKee"), loaded once and then drawn again
const ROS = {};
function roster(tid) {
  if (!ROS[tid]) ROS[tid] = fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/' + tid + '/roster').then(r => r.json())
    // also under the name without Jr./III and as first initial + last name ("T.Watt" for T.J. Watt), as play text often writes them
    .then(d => Object.fromEntries((d.athletes ?? []).flatMap(g => g.items ?? []).flatMap(a => { const k = a.shortName.replace(/ /g, ''); return [[(a.firstName ?? '')[0] + '.' + String(a.lastName ?? '').replace(/ /g, ''), a], [k.replace(/(Jr[.]?|Sr[.]?|II|III|IV|V)$/, ''), a], [k, a]]; }))).catch(() => ({}))
    .then(m => { ROS[tid] = m; drawGc(); });
  return ROS[tid] instanceof Promise ? {} : ROS[tid];
}
// The passer and the catcher, or the runner, named in the play text, with their ESPN roster entries once loaded
// on a run, the team's quarterback stands where it started: F.qb from the game summary, or the last passer seen live
const gcQb = {};
function gcWho(F) {
  // a defense's play: the defenders named (two on a split sack), the team's logo for one missing from its roster,
  // and the logo with DEFENSE when the play names no one
  if (F.dt) { const R = roster(F.dt), ab = F.teams.find(x => x[0] === F.dt)?.[1];
    return F.def ? [F.def, F.def2].filter(Boolean).map(n => ({ n, p: R[n], logo: ab, label: n.split('.').pop() })) : [{ n: 'Defense', logo: ab, label: 'DEFENSE' }]; }
  const t = (F.last || '').trim().replace(/^(\\([^)]*\\)\\s*)+/, ''), tid = F.play?.[2] || F.poss;
  const a = /^([A-Z]\\.[A-Z][\\w'-]+)/.exec(t)?.[1], b = / pass /.test(t) ? / to ([A-Z]\\.[A-Z][\\w'-]+)/.exec(t)?.[1] : null;
  if (!a || !tid) return [];
  if (b) gcQb[tid] = a;
  const q = !b && /rush/i.test(F.play?.[3] ?? '') ? F.qb || gcQb[tid] : null, kr = /punt|kickoff/i.test(F.play?.[3] ?? '') && /[.] +([A-Z][.][A-Z][A-Za-z'-]+) (?:to|for|pushed|ran) /.exec(t)?.[1];
  // a pick: the defender who caught it stands where he caught it (his team's logo when he isn't on its roster)
  const R = roster(tid), opp = F.teams?.find(x => x[0] !== tid), pk = /interception/i.test(F.play?.[3] ?? '') && /INTERCEPTED by ([A-Z][.][A-Z][A-Za-z'-]+)/.exec(t)?.[1];
  return [q !== a && q, a, !pk && b, kr, pk].filter(Boolean).map(n => kr === n || pk === n ? { n, p: roster(opp?.[0])[n], logo: opp?.[1], label: n.split('.').pop() } : { n, p: R[n] });
}
// The newest touchdown in ESPN's game summary, as [start, end, team, type, true] with yards from the team's own goal line
function gcTdPlay(d) {
  const sp = (d.scoringPlays ?? []).filter(p => /touchdown/i.test(p.type?.text)).pop();
  const pl = sp && [...(d.drives?.previous ?? []), d.drives?.current].filter(Boolean).flatMap(x => x.plays ?? []).find(p => p.id === sp.id);
  if (!pl?.start || !pl.end) return null;
  return { last: pl.text, play: [100 - (pl.start.yardsToEndzone ?? pl.start.yardLine), 100 - (pl.end.yardsToEndzone ?? pl.end.yardLine), String(pl.start.team?.id ?? sp.team?.id ?? ''), pl.type?.text ?? '', true] };
}
const gcPts = {};
let gcTd = null;
function gcMissedTd(gid, after) {
  gcTd = { gid, after };
  fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + gid).then(r => r.json()).then(d => { if (gcTd?.gid === gid) { gcTd.F = gcTdPlay(d); drawGc(); } }).catch(() => {});
}
// A finished game's summary from ESPN, fetched once
const GCP = {}, gcIdx = {};
function gcGame(gid) {
  if (!GCP[gid]) GCP[gid] = fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + gid).then(r => r.json()).catch(() => ({})).then(d => { GCP[gid] = d; drawGc(); });
  return GCP[gid] instanceof Promise ? null : GCP[gid];
}
// A player's plays in a game summary, oldest first, leaving out plays called back by a penalty, each as a Watch view:
// the score after it, where it started and ended in yards from the playing team's own goal line.
// A player's are the plays that name him (his short name as the roster spells it, "S.Barkley" or "A.St.Brown") other
// than as the one a penalty was on, a tackler, the snapper or holder, or for a fair catch. A kicker's are his field goals
// and extra points (an extra point is told inside the touchdown play). A defense's are the other team's plays it sacked,
// picked off, got a fumble back, blocked a kick, scored on or ran a kick back for a touchdown, with the defender (F.def)
function gcPlays(d, short, pos = '', team = '') {
  const c = d.header?.competitions?.[0], def = pos === 'Defense';
  if (!c || (!short && !def)) return [];
  const tm = ha => { const x = c.competitors.find(y => y.homeAway === ha); return [x.team.id, x.team.abbreviation, 0, x.team.color, x.team.alternateColor, x.team.name]; };
  const his = s => String(s ?? '').replace(/PENALTY on [A-Z]+-[^,]*,/gi, '').replace(/(Center|Holder)-[^,.]*/g, '').replace(/[(][^)]*[)]/g, '').replace(/fair catch by [^.,]*/g, '');
  const hit = s => { const t = his(s).replace(/[.] (?=[A-Z])/g, '.').replace(/ (Jr[.]|Sr[.]|III|II|IV)(?![a-z])/g, '$1');
    for (let i = t.indexOf(short); i >= 0; i = t.indexOf(short, i + 1)) if (!/[A-Za-z]/.test(t[i - 1] || '') && !/[a-z]/.test(t[i + short.length] || '')) return true;
    return false; };
  const N = "([A-Z][.][A-Z][A-Za-z'-]+)", by = t => [new RegExp('INTERCEPTED by ' + N), new RegExp('RECOVERED by [A-Z]+-' + N), new RegExp('BLOCKED [(]?(?:by )?' + N), new RegExp('sacked[^(]*[(](?:sack split by )?' + N), new RegExp('[.] +' + N + ' (?:to|for|pushed|ran) ')].map(r => r.exec(t)?.[1]).find(Boolean);
  // the team's passer so far, for the quarterback on a run
  const qb = {}, passer = pl => { const t = String(pl.text ?? '').trim().replace(/^(\\([^)]*\\)\\s*)+/, ''), m = / pass /.test(t) && /^([A-Z]\\.[A-Z][\\w'-]+)/.exec(t);
    if (m) qb[pl.start?.team?.id] = m[1]; return qb[pl.start?.team?.id]; };
  const view = (pl, q, x = {}) => {
    const t = String(pl.start.team?.id ?? ''), teams = [tm('away'), tm('home')], type = pl.type?.text ?? '';
    // after a turnover the end is counted toward the other team's end zone. The spot as written ("NYJ 27") wins over
    // the yards to the end zone, which ESPN sometimes counts from the wrong end (on punts)
    const ab = teams.find(x => x[0] === t)?.[1], yd = (sp, or) => { const m = /^([A-Z]+) ([0-9]+)$/.exec(sp ?? ''); return m ? (m[1] === ab ? +m[2] : 100 - m[2]) : sp === '50' ? 50 : or; };
    const end = yd(pl.end.possessionText, pl.end.team?.id == null || String(pl.end.team.id) === t ? 100 - pl.end.yardsToEndzone : pl.end.yardsToEndzone);
    teams[0][2] = +pl.awayScore || 0; teams[1][2] = +pl.homeScore || 0;
    return { teams, down: '', spot: pl.end.possessionText ?? pl.start.possessionText ?? '', poss: t, rz: false, dist: null, from: '', drive: '', leaders: [], last: pl.text.trim(), qb: q,
      when: 'Q' + (pl.period?.number ?? '') + ' ' + (pl.clock?.displayValue ?? ''), play: [yd(pl.start.possessionText, 100 - pl.start.yardsToEndzone), end, t, type, /touchdown/i.test(type)], ...x };
  };
  return (d.drives?.previous ?? []).flatMap(x => x.plays ?? []).map(pl => [pl, passer(pl)]).filter(([pl]) => pl.start?.yardsToEndzone != null && pl.end?.yardsToEndzone != null && !/No Play/i.test(pl.text)).flatMap(([pl, q]) => {
    const t = String(pl.text ?? '').trim(), type = pl.type?.text ?? '';
    if (def) {
      if (String(pl.start.team?.id) === String(team) || !/sack|intercept|fumble recovery [(]opponent|safety|blocked|defensive|muff|return touchdown/i.test(type)) return [];
      // a touchdown it scored runs toward the other end zone, so it is drawn from the defense's side
      const v = view(pl, null, { def: by(t), def2: new RegExp('sack split by ' + N + ' and ' + N).exec(t)?.[2], dt: String(team) });
      if (v.play[4]) v.play = [pl.start.yardsToEndzone, 100, String(team), type, true];
      return [v];
    }
    if (pos === 'Kicker') {
      const i = t.indexOf(short + ' extra point'), xp = i >= 0 && t.slice(i).split(',')[0];
      if (/field goal/i.test(type) && t.startsWith(short)) return [view(pl, q)];
      return xp ? [view(pl, q, { last: xp, play: [85, 85, String(pl.start.team?.id ?? ''), /GOOD/i.test(xp) ? 'Extra Point Good' : 'Extra Point No Good', false] })] : [];
    }
    return hit(t) ? [view(pl, q)] : [];
  });
}
// His game this week, or last week's (from ESPN's scoreboard) while this week's hasn't started or he's on bye,
// so his plays stay watchable after the week turns over
let LASTWK = null;
function gcG(p) {
  const g = LD?.games?.[p.pro];
  if (g && g[0] !== 'pre') return g;
  if (!LASTWK && LIVE?.week > 1) LASTWK = fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=' + (LIVE.week - 1)).then(r => r.json())
    .then(d => { LASTWK = {}; for (const ev of d.events ?? []) if (ev.status?.type?.completed) for (const c of ev.competitions?.[0]?.competitors ?? []) LASTWK[c.team.id] = Object.assign(['post', 'Final · last week', 0, ev.id], { last: true }); })
    .catch(() => (LASTWK = {}));
  return (LASTWK instanceof Promise ? null : LASTWK?.[p.pro]) ?? g;
}
function drawGc() {
  const box = document.getElementById('gc'), p = P[sheet.dataset.pid];
  if (!box || box.hidden || !p) return;
  const g = gcG(p);
  let F = LD?.field?.[g?.[3]], past = null;
  // the game is over: step through his plays, starting at his last
  if (!F && g?.[0] === 'post') {
    const d = gcGame(g[3]);
    if (!d) { if (box.gcHtml !== 'load') box.innerHTML = '<p class="why">Loading his plays&hellip;</p>'; box.gcHtml = 'load'; return; }
    const R = roster(p.pro), short = Object.keys(R).find(k => R[k].displayName === p.name) ?? (p.name[0] + '.' + p.name.split(' ').slice(1).join('')), list = gcPlays(d, short, p.posName, p.pro), k = g[3] + '|' + p.id;
    if (!list.length) { box.innerHTML = box.gcHtml = '<p class="why">No plays with him in this game.</p>'; return; }
    gcIdx[k] = Math.max(0, Math.min(list.length - 1, gcIdx[k] ?? list.length - 1));
    F = list[gcIdx[k]]; past = [gcIdx[k], list.length];
  }
  if (!F) { box.innerHTML = box.gcHtml = '<p class="why">The game is over.</p>'; return; }
  // the score jumped by a touchdown but the last play is already the extra point or the kickoff: show the touchdown
  // until the next play comes in
  const gid = g[3], pts = F.teams[0][2] + F.teams[1][2];
  if (!past) {
    if (gcPts[gid] != null && pts - gcPts[gid] >= 6 && !F.play?.[4]) gcMissedTd(gid, F.last);
    gcPts[gid] = pts;
    if (gcTd && (gcTd.gid !== gid || gcTd.after !== F.last)) gcTd = null;
    if (gcTd?.F) F = { ...F, ...gcTd.F };
  }
  const [A, H] = F.teams, ids = [A[0], H[0]];
  // yards from the left goal line (the away team's), from "DAL 13" or "50"
  const at = s => { const m = /([A-Z]+)\\s+(\\d+)/.exec(s); return !m ? 50 : m[1] === A[1] ? +m[2] : 100 - +m[2]; };
  // a touchdown ends in the middle of the end zone, halfway between the goal line and the end line
  const x = y => (10 + Math.max(0, Math.min(100, y))) / 120 * 100 + '%', ball = F.play?.[4] ? (F.play[2] === A[0] ? 105 : -5) : at(F.spot), dir = F.poss === A[0] ? 1 : -1, from = F.from ? at(F.from) : ball;
  const goal = /goal/i.test(F.down), first = F.dist == null || goal || F.play?.[4] ? null : ball + dir * F.dist;
  const who = side => Object.values(P).filter(q => q.side === side && ids.includes(q.pro)).map(q => '<div class="gc-p"><span>' + e(q.name) + '</span><b>' + f1(LD.players?.[q.id]?.[0] ?? 0) + '</b></div>').join('') || '<p class="tag" style="margin:0">None</p>';
  const html = '<div class="gc-score">' + F.teams.map(t => '<div' + (t[0] === F.poss ? ' class="has"' : '') + '><span>' + e(t[1]) + '</span><b>' + t[2] + '</b></div>').join('') + '<small>' + e(g[1]) + '</small></div>' +
    (F.down ? '<div class="stat gc-sit"><div><b>' + e(F.down) + '</b><small>down</small></div><div><b>' + e(F.spot) + '</b><small>ball on</small></div><div><b>' + e(F.drive.split(',').slice(0, 2).join(',') || '-') + '</b><small>drive</small></div></div>' : '') +
    '<div class="gc-wrap">' + gcField(F, A, H, ball, from, first, x => 10 + Math.max(-10, Math.min(110, x))) +
      (F.play ? '<button type="button" class="gc-replay" data-replay>&#8635; Replay</button>' : '') +
      (past ? '<div class="gc-replay gc-pager"><button type="button" data-gcstep="-1" aria-label="Earlier play"' + (past[0] ? '' : ' disabled') + '>&lsaquo;</button><span>' + (past[0] + 1) + ' / ' + past[1] + '</span><button type="button" data-gcstep="1" aria-label="Later play"' + (past[0] < past[1] - 1 ? '' : ' disabled') + '>&rsaquo;</button></div>' : '') + '</div>' +
    (F.last ? '<p class="why" style="margin:10px 0 0"><b>' + (past ? e(F.when) : 'Last play') + ':</b> ' + e(F.last) + '</p>' : '') +
    '<div class="group">Your players in this game</div>' + who('me') +
    '<div class="group">Your opponent&rsquo;s players in this game</div>' + who('opp') +
    (F.leaders.length ? '<div class="group">Game leaders</div>' + F.leaders.map(l => '<div class="gc-p"><span>' + e(l[0]) + ': ' + e(l[1]) + '</span><small>' + e(l[2]) + '</small></div>').join('') : '');
  if (html === box.gcHtml) return;
  box.innerHTML = box.gcHtml = html;
  // a new play animates, unless the phone is set to reduce motion and it came in on its own rather than from a tap
  if (Date.now() - gcAt < GC_LEAD + GC_FLY + GC_TD && (gcTap || !matchMedia('(prefers-reduced-motion: reduce)').matches)) gcAnimate();
  gcTap = false;
}
let gcTap = false;
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-replay]')) { gcAt = Date.now(); return gcAnimate(); }
  const st = ev.target.closest('[data-gcstep]');
  if (st) { const p = P[sheet.dataset.pid], k = gcG(p)[3] + '|' + p.id; gcIdx[k] += +st.dataset.gcstep; gcTap = true; return drawGc(); }
  const b = ev.target.closest('[data-watch]'), box = document.getElementById('gc');
  if (!b || !box) return;
  box.hidden = !box.hidden; b.textContent = box.hidden ? b.dataset.label : 'Hide the game';
  gcTap = gcOpen = !box.hidden;
  drawGc();
});
let closeTimer;
function openSheet(id) { const p = P[id]; if (!p) return; gcOpen = false; sheet.dataset.pid = id; delete sheet.dataset.team; clearTimeout(closeTimer); closeTimer = null; sheet.querySelector('.sheet-card').classList.remove('closing'); body.innerHTML = render(p); sheet.hidden = false; body.scrollTop = 0; document.body.style.overflow = 'hidden'; }
__TOOLSJS__
function closeSheet() {
  if (sheet.hidden || closeTimer) return;
  const done = () => { sheet.hidden = true; closeTimer = null; document.body.style.overflow = ''; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  sheet.querySelector('.sheet-card').classList.add('closing');
  closeTimer = setTimeout(done, 200);
}

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
// Players and teams named in the question that the facts don't cover (anyone not on my team): full name, or a last
// name only one player has. A team named gets its roster too. ponytail: plain text match, no nicknames
function askExtra(q) {
  if (typeof R !== 'object' || !q) return '';
  const low = ' ' + q.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ') + ' ', has = w => low.includes(' ' + w.toLowerCase() + ' ');
  const mine = new Set(R.teams.find(t => t.id === R.me)?.ids ?? []), all = Object.keys(R.pl).map(Number).map(plOf).filter(Boolean);
  const lastOf = p => p.name.split(' ').filter(w => !['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V'].includes(w)).pop() || '';
  const lastCount = {}; for (const p of all) { const l = lastOf(p).toLowerCase(); lastCount[l] = (lastCount[l] || 0) + 1; }
  const teams = R.teams.filter(t => t.id !== R.me && has(t.name.replace(/[^A-Za-z0-9' ]+/g, ' ').replace(/ +/g, ' ').trim()));
  const named = all.filter(p => !mine.has(p.id) && (has(p.name.replace(/[^A-Za-z0-9' ]+/g, ' ')) || (lastOf(p).length >= 4 && lastCount[lastOf(p).toLowerCase()] === 1 && has(lastOf(p))))).slice(0, 12);
  const owner = p => { const t = R.teams.find(t => t.ids.includes(p.id)); return t ? 'on ' + t.name + "'s team" : 'free agent'; };
  const row = p => '- ' + p.name + ' (' + p.pos + ', ' + p.team + ', bye wk ' + (p.bye || '?') + '), ' + owner(p) + ': expected ' + (p.proj || 0).toFixed(1) + ' this week, ' + (p.avg || 0).toFixed(1) + ' per game so far, ' + (p.rate || 0).toFixed(1) + ' per game rest of season, ' + (p.status || 'healthy');
  // String.fromCharCode(10) is a line break (this script sits inside the page's template string, where backslashes get eaten)
  const NL = String.fromCharCode(10);
  return (named.length ? NL + NL + 'Other players I mentioned:' + NL + named.map(row).join(NL) : '') +
    teams.map(t => NL + NL + t.name + ' (' + t.rec + ') roster:' + NL + t.ids.map(plOf).filter(Boolean).map(row).join(NL)).join('');
}
// claude.ai opens a new chat with ?q= already typed in the box. Very long text may not fit in a link, so then it opens
// empty and the clipboard copy (always made too) is the fallback
// The full facts are often too long for a link, so the link drops the least needed parts until it fits (news, then
// free agents, schedule, IR, bench), never the question at the end. The clipboard keeps the full text.
function claudeUrl(t) {
  const P = String.fromCharCode(10, 10), drop = ['Recent news', 'No news', 'Best free agents', 'My remaining schedule', 'IR:', 'Bench:', 'Pending moves'];
  let parts = t.split(P);
  for (const d of drop) { if (encodeURIComponent(parts.join(P)).length <= 12000) break; parts = parts.filter((x, i) => i === parts.length - 1 || !x.startsWith(d)); }
  const q = encodeURIComponent(parts.join(P));
  return 'https://claude.ai/new' + (q.length <= 12000 ? '?q=' + q : '');
}
const askFacts = () => {
  const q = document.getElementById('askq').value.trim();
  const base = JSON.parse(document.getElementById('facts').textContent), cut = base.lastIndexOf('Explain things simply');
  return q && cut > 0 ? base.slice(0, cut).trimEnd() + askExtra(q) + String.fromCharCode(10, 10) + "Explain things simply, I'm new to football. My question: " + q : base;
};
// the answer as simple HTML: paragraphs, "- " lines as a list, **bold**
const askHtml = t => t.split(String.fromCharCode(10)).map(l => l.trim()).reduce((o, l) => {
  const h = e(l.replace(/^[-*] /, '')).replace(/[*][*](.+?)[*][*]/g, '<b>$1</b>');
  return !l ? o : /^[-*] /.test(l) ? o + '<li>' + h + '</li>' : o + '<p>' + h + '</p>';
}, '').replace(/((?:<li>.*?<[/]li>)+)/g, '<ul>$1</ul>');
// which model answers: Auto lets the Worker pick from the question, Quick is Haiku, Smart is Opus (remembered)
const ASK_TIP = { auto: 'Picks for you: Smart for decisions, Quick for meanings and lookups.', quick: 'Haiku: fast and almost free. Good for meanings and lookups, not decisions.', smart: 'Opus: best for trades and start/sit, about 2¢ a question.' };
let askMode = 'auto';
try { askMode = ASK_TIP[localStorage.getItem('askMode')] ? localStorage.getItem('askMode') : 'auto'; } catch {}
const askModeShow = () => { document.querySelectorAll('#askmode button').forEach(x => x.classList.toggle('on', x.dataset.mode === askMode)); document.getElementById('askmodetip').textContent = ASK_TIP[askMode]; };
document.getElementById('askmode').onclick = ev => { const x = ev.target.closest('[data-mode]'); if (!x) return; askMode = x.dataset.mode; try { localStorage.setItem('askMode', askMode); } catch {} askModeShow(); };
askModeShow();
// Ask: the Worker asks Claude (paid from the Anthropic credits) and the answer shows here. No Worker: open claude.ai
document.getElementById('askbtn').onclick = async () => {
  const b = document.getElementById('askbtn'), out = document.getElementById('askout'), facts = askFacts();
  if (!LIVE) return document.getElementById('askopen').click();
  b.disabled = true; b.textContent = 'Claude is thinking...'; out.hidden = false; out.innerHTML = '<p class="tag">This can take up to a minute.</p>';
  try {
    const r = await fetch(LIVE.url.replace(/[/]$/, '') + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-live': LIVE.token }, body: JSON.stringify({ text: facts, q: document.getElementById('askq').value.trim(), mode: askMode }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
    out.innerHTML = askHtml(d.answer || 'No answer came back.') + (d.cut ? '<p class="tag">The answer was cut off. Ask a narrower question for the rest.</p>' : '') + (d.model ? '<p class="tag">Answered by ' + e(d.model === 'Opus' ? 'Smart (Opus)' : 'Quick (Haiku)') + '</p>' : '');
  } catch (err) { out.innerHTML = '<p class="tag">That didn&#39;t work (' + e(err.message) + '). Use Open in Claude below instead.</p>'; }
  b.disabled = false; b.textContent = 'Ask Claude';
};
document.getElementById('askopen').onclick = async () => {
  const facts = askFacts(), b = document.getElementById('askopen');
  try { await navigator.clipboard.writeText(facts); b.textContent = '✓ Opening Claude. If the box is empty, paste'; }
  catch { prompt('Copy this, then paste it into Claude:', facts); }
  window.open(claudeUrl(facts), '_blank', 'noopener');
  setTimeout(() => (b.textContent = 'Or open it in the Claude app'), 4000);
};
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-close]')) return closeSheet();
  const el = (!ev.target.closest('.sheet-body') || sheet.dataset.team) && ev.target.closest('[data-pid]');
  if (el) openSheet(el.dataset.pid);
});
// Sign out: forget the site password on this phone and go back to the lock screen. The trade password stays,
// locked with the site password, so it can't be read while signed out and comes back when you sign in again.
document.getElementById('signout')?.addEventListener('click', async () => {
  if (!confirm('Sign out? You will need the password to get back in.')) return;
  try {
    const mk = localStorage.getItem('moveKey'), sk = localStorage.getItem('siteKey');
    if (mk && sk) {
      const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(sk), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
      const box = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mk)));
      localStorage.setItem('moveLocked', btoa(String.fromCharCode(...iv, ...box)));
    }
  } catch {}
  try { localStorage.removeItem('siteKey'); localStorage.removeItem('sitePw'); localStorage.removeItem('moveKey'); } catch {}
  location.reload();
});
__MOVEJS__
// Football words get a dotted underline; tap one to see what it means. Words inside buttons, links and player rows
// are left alone (tapping those already does something). Longer phrases come first so they win over their parts.
const GLOSS = [
  ['touchdown luck', 'Touchdown luck', 'Scoring more or fewer touchdowns than his chances near the goal line would predict. It usually evens out over time.'],
  ['half PPR|PPR', 'Half PPR', 'Points per reception. This league is half PPR: a player gets half a point for every catch, on top of his yards and touchdowns.'],
  ['target share', 'Target share', 'The share of his team\\'s passes that were thrown to him. The steadiest sign of how big a receiver\\'s role is.'],
  ['snap share', 'Snap share', 'The share of his team\\'s plays he was on the field for.'],
  ['depth chart', 'Depth chart', 'The team\\'s list of who starts at each position and who backs them up.'],
  ['injured reserve|IR spot|IR', 'Injured reserve (IR)', 'A roster spot for a hurt player. He doesn\\'t use up one of your bench spots while he\\'s there.'],
  ['bye weeks?|byes?', 'Bye week', 'Each NFL team gets one week off during the season. Its players score 0 that week.'],
  ['waiver wire|waivers?', 'Waivers', 'Players nobody owns. Right after a player is dropped (and once games start each week) he\\'s on waivers: managers put in claims, and the team with the best spot in the claim order gets him.'],
  ['free agents?', 'Free agent', 'A player nobody in your league owns who isn\\'t on waivers, so anyone can add him right away.'],
  ['FLEX', 'FLEX', 'A lineup spot that can hold a running back, a receiver or a tight end.'],
  ['D/ST', 'D/ST', 'Defense and special teams: a whole NFL team\\'s defense in one fantasy spot. Scores from sacks, turnovers, touchdowns and holding the other team to few points.'],
  ['quarterbacks?|QBs?', 'Quarterback (QB)', 'The player who throws the ball. Scores from passing yards, touchdown passes and his own runs; loses points for interceptions.'],
  ['running backs?|RBs?', 'Running back (RB)', 'The player who mostly runs with the ball (carries). Also catches short passes.'],
  ['wide receivers?|receivers?|WRs?', 'Wide receiver (WR)', 'A player whose job is catching passes. Scores from catches, receiving yards and touchdowns.'],
  ['tight ends?|TEs?', 'Tight end (TE)', 'Part blocker, part receiver. Usually catches fewer passes than a wide receiver.'],
  ['kickers?', 'Kicker (K)', 'Kicks field goals and extra points.'],
  ['nickel cornerback|cornerbacks?', 'Cornerback', 'A defender who covers the other team\\'s receivers. The nickel cornerback is an extra one used against passing plays.'],
  ['linebackers?', 'Linebacker', 'A defender who plays a few steps behind the line. Stops runs and covers short passes.'],
  ['defensive ends?|defensive tackles?|nose tackle', 'Defensive line', 'The defenders right at the line. They chase the quarterback and stop runs.'],
  ['offensive line', 'Offensive line', 'The 5 blockers who protect the quarterback and open holes for runs.'],
  ['projections?|projected', 'Projection', 'How many points the experts expect him to score.'],
  ['targets?', 'Target', 'A pass thrown to him, caught or not. More targets means more chances to score.'],
  ['carries', 'Carries', 'Times he was handed the ball to run with it.'],
  ['snaps?', 'Snap', 'One play. A player\\'s snaps are the plays he was on the field for.'],
  ['red[- ]zone|goal line', 'Red zone', 'The last 20 yards before the end zone, where most touchdowns happen.'],
  ['touchdowns?|TDs?', 'Touchdown (TD)', 'Getting the ball into the end zone. Worth 6 points to the player who scores it; a QB gets points for throwing one too.'],
  ['field goals?', 'Field goal', 'A kick through the goal posts, worth 3 points in the game. Kickers get more fantasy points for longer ones.'],
  ['extra points?', 'Extra point', 'The short kick after a touchdown, worth 1 point.'],
  ['2-point(?: passes| conversions?)?', '2-point conversion', 'Instead of the extra point kick, the team tries one play from the 2-yard line for 2 points.'],
  ['interceptions?', 'Interception', 'A defender catches a pass meant for the offense. Costs the QB points and gives the defense points.'],
  ['fumbles?', 'Fumble', 'The ball carrier drops the ball. If the defense grabs it, it\\'s a turnover.'],
  ['sacks?|sacked', 'Sack', 'The quarterback gets tackled behind the line before he can throw. Points for the defense.'],
  ['turnovers?', 'Turnover', 'The defense takes the ball away with an interception or a fumble recovery.'],
  ['safety|safeties', 'Safety', 'Two meanings: a deep defender who guards against long passes, or a 2-point score when the offense is tackled in its own end zone.'],
  // words from ESPN's play-by-play, so every play description can be tapped
  ['shotgun', 'Shotgun', 'The quarterback stands about 5 to 7 yards behind the center and the ball is snapped back to him. Teams use it mostly to pass: he sees the defense better and has more time.'],
  ['no huddle', 'No huddle', 'The offense skips the meeting before the play and lines right up, to go faster and stop the defense from swapping players.'],
  ['pistol', 'Pistol', 'Like the shotgun but closer: the quarterback stands about 4 yards back with the running back right behind him.'],
  ['under center', 'Under center', 'The quarterback stands right behind the center and takes the ball hand to hand.'],
  ['(?:short|deep) (?:left|right|middle)', 'Pass direction', 'Where the pass went. Short is under about 15 yards past the line, deep is farther.'],
  ['up the middle|(?:left|right) (?:end|tackle|guard)', 'Run direction', 'Where the run went: up the middle, or outside a blocker (guard, then tackle, then end, farther from the middle).'],
  ['scrambles?|scrambled', 'Scramble', 'The quarterback runs with the ball himself, usually because nobody was open. Counts as a run for fantasy.'],
  ['kneels?', 'Kneel', 'The quarterback takes the snap and kneels right away to run out the clock. Loses a yard or two on purpose.'],
  ['spiked?', 'Spike', 'The quarterback throws the ball straight into the ground to stop the clock. Counts as an incomplete pass.'],
  ['aborted', 'Aborted play', 'The snap was fumbled or botched before the play got going.'],
  ['touchbacks?', 'Touchback', 'A kick that goes into the end zone and is not run out. The ball is placed at the 25 (the 35 on a kickoff this season).'],
  ['fair catch', 'Fair catch', 'The returner waves his hand: he catches the punt, cannot be hit, and cannot run with it.'],
  ['onside', 'Onside kick', 'A short kickoff the kicking team tries to get back. Used when they are losing late.'],
  ['muffed|muffs?', 'Muff', 'A returner touches a kick but does not catch it cleanly. Anyone can recover it.'],
  ['out of bounds|ob', 'Out of bounds', 'The ball carrier stepped off the field, which stops the clock.'],
  ['no play', 'No play', 'A penalty wiped the play out. Nothing from it counts, fantasy points included.'],
  ['penalty|penalties', 'Penalty', 'A broken rule, costing yards. Declined means the other team chose the play result instead of the yards.'],
  ['offensive holding|defensive holding', 'Holding', 'Grabbing a player instead of blocking him. 10 yards against the offense, 5 and a first down against the defense.'],
  ['pass interference', 'Pass interference', 'Grabbing or blocking a player before the ball arrives. Against the defense, the ball moves to the spot of the foul.'],
  ['false start', 'False start', 'An offensive player moves before the snap. 5-yard penalty.'],
  ['offside|encroachment|neutral zone infraction', 'Offside', 'A defender is past the line when the play starts. 5-yard penalty.'],
  ['delay of game', 'Delay of game', 'The offense did not snap the ball before the play clock ran out. 5-yard penalty.'],
  ['unnecessary roughness|roughing the passer', 'Personal foul', 'An illegal hit. 15 yards, and a first down if against the defense.'],
  ['two-minute warning', 'Two-minute warning', 'An automatic timeout with 2 minutes left in each half. Teams hurry after it.'],
  ['timeouts?', 'Timeout', 'A team stops the clock. Each team gets 3 per half.'],
  ['challenged|reversed|upheld', 'Replay review', 'The referees rewatch a play. Reversed means the call changed; upheld means it stayed.'],
  ['punts?', 'Punt', 'When the offense gives up and kicks the ball away on 4th down.'],
  ['questionable', 'Questionable', 'An injury tag: he might not play. About 7 in 10 questionable players end up playing.'],
  ['doubtful', 'Doubtful', 'An injury tag: he probably won\\'t play. Fewer than 1 in 10 do.'],
  ['inactive', 'Inactive', 'Not playing in that game. Teams name their inactive players about 90 minutes before kickoff.'],
  ['limited in practice|DNP|practiced fully', 'Practice report', 'How much a hurt player practiced that week: fully, limited, or DNP (did not practice). Practicing more means he\\'s more likely to play.'],
  ['kickoffs?', 'Kickoff', 'The start of the game.'],
  ['team totals?|over/under|Vegas', 'Vegas lines', 'Betting lines on the game. The team total is how many points the bookmakers expect a team to score: a high one is good for its players.'],
  ['spreads?', 'Spread', 'How many points the favorite is expected to win by.'],
  ['matchups?', 'Matchup', 'Who he plays against. An easy matchup is a defense that gives up lots of points to his position.'],
  ['blowouts?|blown out', 'Blowout', 'A game one team wins by a lot. The losing team often gives up on running, and starters on both teams can sit late.'],
  ['use up the clock|run out the clock', 'Running out the clock', 'A team that\\'s ahead runs the ball a lot, since the clock keeps running after a run and the game ends sooner.'],
  ['breakouts?', 'Breakout', 'A player whose role suddenly gets much bigger: more plays, more targets or carries.'],
  ['buy low', 'Buy low', 'Trade for a player while his points are down for reasons that won\\'t last.'],
  ['sell high', 'Sell high', 'Trade a player away while his points are up for reasons that won\\'t last.'],
  ['rest of season', 'Rest of season', 'From this week to the end of the regular season.'],
  ['playoff bubble|playoffs?', 'Playoffs', 'The top teams at the end of the regular season play for the title. On the bubble means right on the edge of getting in.'],
  ['ceiling', 'Ceiling', 'How many points he could score in a great week.'],
  ['floor', 'Floor', 'How few points he could score in a bad week.'],
  ['game script', 'Game script', 'How the score shapes the game plan: teams far ahead run more, teams far behind pass more.'],
];
const GLOSS_RE = new RegExp('\\\\b(' + GLOSS.map(g => g[0]).join('|') + ')\\\\b', 'gi'), GLOSS_ONE = GLOSS.map(g => [new RegExp('^(?:' + g[0] + ')$', 'i'), g[1], g[2]]);
const GLOSS_SKIP = 'a,button,summary,input,textarea,select,script,style,label,nav,svg,.gl,[data-pid],#gloss,#sheet .sheet-x,#dict,#dict2';
// Words the site doesn't use, for the dictionary in How it works
const MORE_WORDS = [
  ["Down", "One try to move the ball. The offense gets 4 downs to go 10 yards. Make it and they get a fresh set of 4."],
  ["First down", "Gaining the 10 yards. The offense gets a new set of 4 downs."],
  ["Line of scrimmage", "The imaginary line where each play starts, at the spot of the ball."],
  ["End zone", "The 10-yard area at each end of the field. Get the ball in there for a touchdown."],
  ["Drive", "One stretch of plays where a team keeps the ball, until it scores, punts or turns it over."],
  ["Possession", "Which team has the ball."],
  ["Huddle", "The quick meeting before a play where the offense hears the play call."],
  ["Audible", "The quarterback changes the play at the line after seeing the defense."],
  ["Play action", "The quarterback fakes a handoff, then throws."],
  ["Pocket", "The space the blockers make around the quarterback so he has time to throw."],
  ["Completion", "A pass that gets caught. An incompletion is one that hits the ground."],
  ["Check-down", "A short, safe pass, usually to a running back, when the long ones are covered."],
  ["Route", "The path a receiver runs to get open."],
  ["Slot receiver", "A receiver who lines up close to the middle of the field. Catches lots of short passes."],
  ["Deep threat", "A fast receiver who catches long passes. Big games, but up and down week to week."],
  ["Hail Mary", "A long, desperate throw into the end zone at the end of a half."],
  ["Blitz", "Extra defenders rush the quarterback instead of covering receivers."],
  ["Pass rush", "Defenders trying to reach the quarterback before he throws."],
  ["Coverage", "How defenders guard the receivers: man-to-man (each takes one player) or zone (each guards an area)."],
  ["Tackle for loss", "Tackling the ball carrier behind the line of scrimmage."],
  ["Pick-six", "An interception returned for a touchdown. Big points for a fantasy defense."],
  ["Strip sack", "A sack where the quarterback also loses the ball."],
  ["Shutout", "Holding the other team to 0 points. The best possible day for a fantasy defense."],
  ["Points allowed", "How many points a defense lets the other team score. Fewer means more fantasy points for that defense."],
  ["Special teams", "The players on the field for kicks and punts."],
  ["Kick return / punt return", "Catching the other team's kick and running it back. A return touchdown scores for your D/ST."],
  ["Overtime", "Extra time when the game is tied after 4 quarters."],
  ["Garbage time", "The end of a game that's already decided. Losing teams pile up stats that count the same in fantasy."],
  ["Workhorse back", "A running back who gets nearly all his team's carries. Rare and valuable."],
  ["Committee", "When a team splits carries among 2 or 3 running backs. Hurts each one's points."],
  ["Goal-line back", "The running back a team uses right near the end zone. Gets touchdowns without many yards."],
  ["Vulture", "A player who steals a touchdown near the goal line from the main guy."],
  ["Handcuff", "The backup to your running back. If your starter gets hurt, the handcuff takes his job."],
  ["Sleeper", "A player who could score a lot more than people expect."],
  ["Bust", "A player who scores a lot less than expected."],
  ["Boom or bust", "A player who either has a huge game or almost nothing, with little in between."],
  ["Streaming", "Picking up a player for just one week because of an easy matchup, then dropping him. Common for defenses and kickers."],
  ["Stack", "Starting a quarterback and his own receiver. When one scores, the other does too."],
  ["Lineup lock", "A player locks when his game starts. You can't move him in or out after that."],
  ["Thursday / Sunday / Monday night", "When NFL games are played. Most are Sunday; one game on Thursday night and Monday night."],
  ["Trade deadline", "The last day trades are allowed in your league."],
  ["Waiver priority", "Your place in line for claims. Same as your waiver number on this site."],
  ["FAAB", "Free agent budget: some leagues bid fake money on free players. Your league uses a waiver order instead."],
  ["Snake draft", "Each team picks a player in turn, and the order reverses every round."],
  ["ADP", "Average draft position: where a player usually gets picked in drafts."],
  ["Keeper / dynasty league", "Leagues where you keep some or all players from one season to the next."],
];
// the dictionary: every glossary word, then the extra ones, A to Z
function fillDict() {
  const dl = (id, rows) => { const el = document.getElementById(id); if (el && !el.children.length) el.innerHTML = rows.slice().sort((a, b) => a[0].localeCompare(b[0])).map(r => '<dt>' + e(r[0]) + '</dt><dd>' + e(r[1]) + '</dd>').join(''); };
  dl('dict', GLOSS.map(g => [g[1], g[2]])); dl('dict2', MORE_WORDS);
}
fillDict();
function gloss(root) {
  const found = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: t => (GLOSS_RE.lastIndex = 0, GLOSS_RE.test(t.data) && !t.parentElement?.closest(GLOSS_SKIP) ? 1 : 2) });
  for (let t; (t = w.nextNode());) found.push(t);
  for (const t of found) {
    const f = document.createDocumentFragment(); let i = 0;
    t.data.replace(GLOSS_RE, (m, _, at) => { f.append(t.data.slice(i, at)); const s = document.createElement('span'); s.className = 'gl'; s.tabIndex = 0; s.setAttribute('role', 'button'); s.textContent = m; f.append(s); i = at + m.length; return m; });
    f.append(t.data.slice(i)); t.replaceWith(f);
  }
}
const tip = Object.assign(document.createElement('div'), { id: 'gloss', hidden: true });
tip.setAttribute('role', 'tooltip'); document.body.append(tip);
function showGloss(el) {
  const g = GLOSS_ONE.find(([re]) => re.test(el.textContent)); if (!g) return;
  tip.innerHTML = '<b>' + e(g[1]) + '</b>' + e(g[2]); tip.hidden = false;
  const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(16, Math.min(r.left, innerWidth - tw - 16)) + 'px';
  tip.style.top = (r.bottom + 8 + th > innerHeight - 16 ? Math.max(16, r.top - th - 8) : r.bottom + 8) + 'px';
}
document.addEventListener('click', ev => { const g = ev.target.closest('.gl'); if (g) showGloss(g); else if (!ev.target.closest('#gloss')) tip.hidden = true; });
addEventListener('scroll', () => (tip.hidden = true), true);
gloss(document.body);
const glossWatch = new MutationObserver(ms => {
  glossWatch.disconnect();
  for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && !n.closest('.gl,#gloss')) gloss(n);
  glossWatch.observe(document.body, { childList: true, subtree: true });
});
glossWatch.observe(document.body, { childList: true, subtree: true });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') tip.hidden = true;
  if (ev.key === 'Enter' && ev.target.classList?.contains('gl')) showGloss(ev.target);
  if (ev.key === 'Escape') closeSheet();
  if (ev.key === 'Enter' && ev.target.dataset?.pid) openSheet(ev.target.dataset.pid);
});
</script></body></html>`;

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
const blurbs = new Map(); // player id -> his Rotowire updates: { id, h (headline), s (first lines of the story), t (published ms), tag }
// First two sentences of a news story, so news like a teammate getting hurt shows the day it happens, not only the headline
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
    return [id, items.map(x => ({ h: x.headline, s: snip(x.story, x.headline), url: x.links?.web?.href || `https://www.espn.com/nfl/player/_/id/${id}`, when: new Date(x.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))];
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
const TOOLS_JS = String.raw`// Data for Compare, the trade checker and Add buttons: every rostered player and the free agents
const R = JSON.parse(document.getElementById('rdata').textContent);
const plOf = id => { const a = R.pl[id]; return a && { id: +id, name: a[0], pos: a[1], team: a[2], proj: a[3], rate: a[4], playable: a[5], locked: a[6], slot: a[7], rank: a[8], ceiling: a[9], avg: a[10], bye: a[11], status: a[12], abbr: a[13], next: a[14], fut: a[15] }; };
const photo = p => p.id < 0 || p.pos === 'D/ST' ? '<span class="pic logo"><img src="https://a.espncdn.com/i/teamlogos/nfl/500/' + e((p.abbr || '').toLowerCase()) + '.png" alt=""></span>' : '<span class="pic" data-i="' + e(p.name.split(' ').map(w => w[0]).join('').slice(0, 2)) + '"><img src="https://a.espncdn.com/i/headshots/nfl/players/full/' + p.id + '.png" alt="" onerror="this.remove()"></span>';
// Compare / Trade buttons on a player page
const toolBtns = p => { const x = plOf(p.id); if (!x) return ''; const onTeam = R.teams.some(t => t.ids.includes(x.id)); return '<div class="tools2"><button type="button" class="btn" data-cmp="' + x.id + '">Compare</button>' + (onTeam ? '<button type="button" class="btn" data-trade="' + x.id + '">Trade check</button>' : '') + '</div>'; };
const rosterOf = teamId => R.teams.find(t => t.id === teamId).ids.map(plOf).filter(Boolean);
// A team's page (tap a team on the league board or in League): who they start, points so far with the game clock
// (live every 30s, same as your players), and what each player is expected to score
function teamPage(tid) {
  const t = R.teams.find(x => x.id === +tid);
  if (!t || !t.rows) return '';
  const row = r => {
    const [id, slot, now, pro, st, clock, proj] = r, x = plOf(id);
    if (!x) return '';
    const game = st === 'bye' ? 'Bye week: no game' : st === 'pre' ? e(clock) : '';
    const pts = st === 'in' || st === 'post' ? '<b>' + now.toFixed(1) + ' pts</b> ' + (st === 'post' ? 'final' : 'so far &middot; ' + e(clock)) : '';
    return '<div class="card row"><span class="slot">' + (slot === 'Bench' || slot === 'IR' ? '' : e(slot)) + '</span><div class="player"' + (P[id] ? ' data-pid="' + id + '"' : '') + '>' + photo(x) +
      '<div class="who"><div class="name">' + e(x.name) + '</div><div class="meta"><span class="pos pos-' + x.pos.replace('/', '') + '">' + x.pos + '</span> ' + e(x.team || '') + '</div>' +
      (game ? '<div class="nowpts">' + game + '</div>' : '') + (st === 'bye' ? '' : '<div class="nowpts" data-live="' + id + '" data-pro="' + pro + '"' + (pts ? '>' + pts : ' hidden>') + '</div>') +
      '</div></div><div class="big"><b>' + proj.toFixed(1) + '</b><small>expected</small></div></div>';
  };
  const start = t.rows.filter(r => r[1] !== 'Bench' && r[1] !== 'IR'), bench = t.rows.filter(r => r[1] === 'Bench' || r[1] === 'IR');
  return '<div class="sh-top"><div><div class="sh-name">' + e(t.id === R.me ? 'You' : t.name) + '</div><div class="tag">' + t.rec + ' record</div></div></div>' +
    '<div class="stat"><div><b data-teamnow="' + t.id + '">' + (t.now == null ? '0.0' : t.now.toFixed(1)) + '</b><small>points so far this week</small></div><div><b>' + (t.proj == null ? '-' : t.proj.toFixed(1)) + '</b><small>expected final score</small></div></div>' +
    '<div class="group">Starting</div><div class="list">' + start.map(row).join('') + '</div>' +
    (bench.length ? '<details class="fold" style="margin-top:12px"><summary class="group">Bench (' + bench.length + ')</summary><div class="list">' + bench.map(row).join('') + '</div></details>' : '');
}
function openTeam(tid) {
  const html = teamPage(tid);
  if (!html) return;
  sheet.dataset.pid = ''; sheet.dataset.team = tid; clearTimeout(closeTimer); closeTimer = null; sheet.querySelector('.sheet-card').classList.remove('closing');
  body.innerHTML = html; sheet.hidden = false; body.scrollTop = 0; document.body.style.overflow = 'hidden';
  gloss(body);
  if (typeof liveTick === 'function') liveTick();
}
document.addEventListener('click', ev => { const tr = ev.target.closest('tr[data-team]'); if (tr && !ev.target.closest('a,button')) openTeam(tr.dataset.team); });
// "Add him" on a free agent's page: one button per player you could drop, best choice first. Best = your lineup
// loses the least (or gains the most) over the rest of the season with him in and that player out.
let dropCost = null; // set by the trade tools below: (player to add, player to drop) => change in your best lineup per week
function addHim(p) {
  if (!p.free || !R.moves) return '';
  if (p.free.locked) return '<div class="group" id="addhim">Add him</div><p class="why" style="margin:0">His game already started, so ESPN locks him until next week.</p>';
  const add = plOf(p.id), drops = rosterOf(R.me).filter(x => !x.locked).map(x => ({ x, d: add && dropCost ? dropCost(add, x) : -x.rate })).sort((a, b) => b.d - a.d);
  const word = (d, i) => !add || !dropCost ? '' : i === 0 ? '<b style="color:var(--good)">Best choice</b> &middot; ' : i >= drops.length - 2 && d < -1 ? '<b style="color:var(--bad)">Worst choice</b> &middot; ' : '';
  const change = d => !add || !dropCost ? '' : Math.abs(d) < 0.1 ? 'your lineup stays the same' : 'your lineup ' + (d > 0 ? 'gains ' : 'loses ') + Math.abs(d).toFixed(1) + ' a week';
  return '<div class="group" id="addhim">Add him</div><p class="why" style="margin:0 0 4px">' + (p.free.wa ? "He is on waivers, so this puts in a claim. It goes through when waivers run." : "He is a free agent, so he joins your team right away.") + ' Pick who to drop. Best choices are at the top: your lineup misses them least.</p>' +
    drops.map(({ x, d }, i) => '<button type="button" class="btn do" style="background:var(--chip);color:var(--fg);text-align:left" data-move="' + e(JSON.stringify({ label: 'Add ' + p.name + ', drop ' + x.name, type: p.free.wa ? 'WAIVER' : 'FREEAGENT', items: [{ type: 'ADD', playerId: p.id }, { type: 'DROP', playerId: x.id }], week: R.week })) + '"><span style="display:flex;gap:12px;align-items:center">' + photo(x) + '<span>Drop ' + e(x.name) + '<br><span class="tag">' + word(d, i) + x.pos + ', ' + x.rate.toFixed(1) + ' per game' + (change(d) ? ' &middot; ' + change(d) : '') + '</span></span></span></button>').join('');
}
(() => {
  const slotCounts = R.slotCounts, SLOT_POS = R.slotPos, SLOT = R.slotName;
  __BESTLINEUP__
  const isStarter = p => !['Bench', 'IR', 'FA'].includes(p.slot);
  const seasonV = p => (p.playable ? p.rate : 0);
  const weekV = p => (p.playable && !(p.locked && !isStarter(p)) ? p.proj : 0);
  const total = (ps, v) => bestLineup(ps, v).total;
  dropCost = (add, x) => { const ps = rosterOf(R.me); return total(ps.filter(y => y.id !== x.id).concat(add), seasonV) - total(ps, seasonV); };
  const weekTotal = ps => bestLineup(ps, p => weekV(p) + (p.locked && isStarter(p) ? 1e3 : 0)).lineup.reduce((t, x) => t + weekV(x.player), 0);
  const vor = p => Math.max(0, p.rate - (R.repl[p.pos] || 0));
  const f1 = x => (x > 0 ? '+' : '') + x.toFixed(1);
  const opt = p => '<option value="' + p.id + '">' + e(p.name) + ' (' + p.pos + ')</option>';
  const $ = id => document.getElementById(id);

  // A text to send with a checked trade: only true facts from the numbers (same idea as the fleece texts)
  const last = p => p.pos === 'D/ST' ? p.name : p.name.split(' ').filter(w => !['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'].includes(w)).slice(-1)[0];
  const posWord = pos => ({ QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end', K: 'kicker', 'D/ST': 'defense' })[pos];
  const avgSum = ps => ps.reduce((s, p) => s + (p.avg || 0), 0);
  function tcTexts(give, take, team, theirWeek) {
    const both = give.map(last).join(' and '), ask = both + ' for ' + take.map(last).join(' and '), facts = [];
    const fills = give.filter(p => (team.short || []).includes(p.pos));
    if (fills.length) facts.push("you're kinda thin at " + [...new Set(fills.map(p => posWord(p.pos)))].join(' and ') + ' rn');
    if (give.length > take.length) facts.push("that's " + give.length + ' guys for ' + take.length + ', like ' + avgSum(give).toFixed(1) + ' a game combined');
    else if (avgSum(give) > avgSum(take)) facts.push(both + (give.length > 1 ? ' have' : ' has') + ' been outscoring ' + take.map(last).join(' and ') + ' this year tho (' + avgSum(give).toFixed(1) + ' vs ' + avgSum(take).toFixed(1) + ')');
    if (theirWeek >= 2) facts.push("it'd get you like " + Math.round(theirWeek) + ' more points this week too');
    const top = facts.slice(0, 2), cap = t => t[0].toUpperCase() + t.slice(1), say = (...parts) => parts.filter(Boolean).map(cap).join(' ');
    const T = take.map(last).join(' and '), s1 = top[0], all = top.join(' and ');
    return [...new Set([
      say('would you do ' + ask + '?', all),
      say('yo would you do ' + ask + '?', s1),
      say('thoughts on ' + ask + '?', all),
      s1 ? say(s1 + ' so would you do ' + ask + '?') : '',
      say('bro ' + ask + '?', s1),
      say('what would it take to get ' + T + "? I'd do " + both),
      say(ask + '?', top[top.length - 1]),
    ].filter(Boolean))];
  }
  const tcPrompt = (give, take, team, theirWeek) => "Write a short text (1-2 sentences) in my voice to my fantasy football league mate proposing this trade. My voice: " + R.voice + " I give: " +
    give.map(p => p.name + ' (' + p.pos + ')').join(' and ') + '. I get: ' + take.map(p => p.name + ' (' + p.pos + ')').join(' and ') + ". Use ONLY these true facts, don't make up any stats or news, don't say it's lopsided: " +
    [...give, ...take].map(p => p.name + ' averages ' + (p.avg || 0).toFixed(1) + ' points a game this season' + (p.rank ? ', ranked ' + p.rank + ' at ' + p.pos : ''))
      .concat((team.short || []).length ? ['their team is short at ' + team.short.map(posWord).join(', ')] : [], theirWeek >= 1 ? ['it would add about ' + Math.round(theirWeek) + ' projected points to their lineup this week'] : [])
      .join('; ') + '. Give me 3 different versions.';

  // --- Trade checker: the same math as the trade ideas, for any players you pick
  const tcTeam = $('tc-team');
  tcTeam.innerHTML = '<option value="">Pick a team...</option>' + R.teams.filter(t => t.id !== R.me).map(t => '<option value="' + t.id + '">' + e(t.name) + '</option>').join('');
  const box = (p, side) => '<label class="pick"><input type="checkbox" data-side="' + side + '" value="' + p.id + '">' + photo(p) + '<span><b>' + e(p.name) + '</b><br><span class="tag">' + p.pos + ' &middot; ' + p.rate.toFixed(1) + ' per game</span></span></label>';
  function tcLists() {
    const them = +tcTeam.value;
    $('tc-give').innerHTML = rosterOf(R.me).map(p => box(p, 'give')).join('');
    $('tc-get').innerHTML = them ? rosterOf(them).map(p => box(p, 'get')).join('') : '<p class="tag">Pick a team first.</p>';
    tcCheck();
  }
  function tcCheck() {
    // remembered for this tab, so an automatic update doesn't wipe what you picked
    try { sessionStorage.setItem('tc', JSON.stringify({ team: tcTeam.value, ids: [...document.querySelectorAll('#check input[type=checkbox]:checked')].map(i => i.dataset.side + ':' + i.value) })); } catch {}
    const them = +tcTeam.value, ticked = side => [...document.querySelectorAll('#check input[data-side=' + side + ']:checked')].map(i => +i.value);
    const mine = rosterOf(R.me), theirs = them ? rosterOf(them) : [];
    const give = mine.filter(p => ticked('give').includes(p.id)), take = theirs.filter(p => ticked('get').includes(p.id));
    if (!them || !give.length || !take.length) { $('tc-out').innerHTML = '<p class="tag" style="margin:10px 0 0">Tick at least one player on each side.</p>'; return; }
    const mineAfter = [...mine.filter(p => !give.includes(p)), ...take], theirsAfter = [...theirs.filter(p => !take.includes(p)), ...give];
    const season = total(mineAfter, seasonV) - total(mine, seasonV), theirsGain = total(theirsAfter, seasonV) - total(theirs, seasonV);
    const wk = weekTotal([...mine.filter(p => !give.includes(p) || (p.locked && isStarter(p))), ...take.map(p => ({ ...p, slot: 'Bench' }))]) - weekTotal(mine);
    const vg = give.reduce((s, p) => s + vor(p), 0), vt = take.reduce((s, p) => s + vor(p), 0);
    const roomNote = give.length < take.length ? '<p class="tag" style="margin:6px 0 0">You get more players than you give, so you would also have to drop ' + (take.length - give.length) + ' (not counted here).</p>' : '';
    const [cls, word] = season >= 1 ? ['good', 'Good for you'] : season <= -1 ? ['bad', 'Bad for you'] : ['meh', 'About even for you'];
    const accept = theirsGain >= -0.5 && vg >= vt * 0.85;
    const team = R.teams.find(t => t.id === them);
    const theirWeek = weekTotal([...theirs.filter(p => !take.includes(p) || (p.locked && isStarter(p))), ...give.map(p => ({ ...p, slot: 'Bench' }))]) - weekTotal(theirs);
    const texts = tcTexts(give, take, team, theirWeek), chip = ' style="background:var(--chip);color:var(--fg)"';
    $('tc-out').innerHTML = '<div class="vhead" style="margin-top:12px"><b>Verdict</b><span class="verdict-' + cls + '">' + word + '</span></div>' +
      '<div class="stat"><div><b style="color:var(--' + (season >= 0 ? 'good' : 'bad') + ')">' + f1(season) + '</b><small>points per week for you, rest of season</small></div>' +
      '<div><b>' + f1(wk) + '</b><small>points for you this week</small></div>' +
      '<div><b>' + f1(theirsGain) + '</b><small>points per week for them</small></div>' +
      '<div><b>' + (accept ? 'Likely' : 'Unlikely') + '</b><small>they say yes (fair on value)</small></div></div>' + roomNote +
      '<p class="tag" style="margin:8px 0 0">Points per week = how much better your best lineup gets, using the averaged rest-of-season projections.</p>' +
      '<div class="group">Text to send</div><p class="pitch">' + e(texts[0]) + '</p>' +
      '<div class="tools2"><button type="button" class="btn"' + chip + ' data-copy="' + e(texts[0]) + '">Copy text</button>' + (texts.length > 1 ? '<button type="button" class="btn"' + chip + ' data-versions="' + e(JSON.stringify(texts)) + '">Another version</button>' : '') + '</div>' +
      '<button type="button" class="btn"' + chip + ' data-claude="' + e(tcPrompt(give, take, team, theirWeek)) + '">Have Claude write it (copies the facts, opens Claude)</button>' +
      (R.moves && R.tradesOpen ? '<button type="button" class="btn do" data-move="' + e(JSON.stringify({ label: 'Propose ' + give.map(p => p.name).join(' + ') + ' for ' + take.map(p => p.name).join(' + ') + ' on ESPN', type: 'TRADE_PROPOSAL', other: them, sms: team.name, items: [...give.map(p => ({ type: 'GIVE', playerId: p.id })), ...take.map(p => ({ type: 'GET', playerId: p.id }))], week: R.week })) + '">Propose on ESPN, then text them</button>' : '');
  }
  tcTeam.addEventListener('change', tcLists);
  $('check').addEventListener('change', ev => { if (ev.target.matches('input[type=checkbox]')) tcCheck(); });
  let tcSaved = null;
  try { tcSaved = JSON.parse(sessionStorage.getItem('tc') || 'null'); } catch {}
  if (tcSaved && R.teams.some(t => t.id === +tcSaved.team)) tcTeam.value = tcSaved.team;
  tcLists();
  if (tcSaved && tcTeam.value) {
    for (const k of tcSaved.ids) { const [side, id] = k.split(':'), box = document.querySelector('#check input[data-side=' + side + '][value="' + id + '"]'); if (box) box.checked = true; }
    tcCheck();
  }

  // --- Compare two players side by side: tap a box, search by name, tap the player
  const ownerOf = id => { const t = R.teams.find(t => t.ids.includes(id)); return t ? (t.id === R.me ? 'You' : t.name) : 'Free agent'; };
  const all = Object.keys(R.pl).map(plOf);
  const pick = { a: null, b: null };
  let picking = 'a';
  function drawPick(k) {
    const p = plOf(pick[k]);
    $('cmp-' + k).innerHTML = p ? photo(p) + '<span class="cmp-who"><b>' + e(p.name) + '</b><span class="tag">' + p.pos + ' &middot; ' + e(ownerOf(p.id)) + '</span></span>' : '<span class="tag">Tap to pick a player</span>';
  }
  function setPick(k, id) { pick[k] = id; drawPick(k); compare(); try { sessionStorage.setItem('cmp', JSON.stringify(pick)); } catch {} }
  function results(q) {
    const flat = s => s.toLowerCase().replace(/[^a-z0-9]/g, ''); // "aj brown" finds A.J. Brown
    q = flat(q);
    const list = all.filter(p => !q || flat(p.name).includes(q)).sort((x, y) => y.rate - x.rate).slice(0, 25);
    $('cmp-res').innerHTML = list.map(p => '<button type="button" class="pickrow" data-id="' + p.id + '">' + photo(p) + '<span class="cmp-who"><b>' + e(p.name) + '</b><span class="tag">' + p.pos + ' &middot; ' + e(ownerOf(p.id)) + ' &middot; ' + p.rate.toFixed(1) + ' per game</span></span></button>').join('') || '<p class="tag">No player by that name.</p>';
  }
  ['a', 'b'].forEach(k => $('cmp-' + k).addEventListener('click', () => {
    picking = k; $('cmp-search').hidden = false; $('cmp-q').value = ''; results(''); $('cmp-q').focus();
  }));
  $('cmp-q').addEventListener('input', ev => results(ev.target.value));
  $('cmp-res').addEventListener('click', ev => { const b = ev.target.closest('[data-id]'); if (!b) return; $('cmp-search').hidden = true; setPick(picking, +b.dataset.id); });
  function compare() {
    const rd = p => p && { ...p, proj: Math.round(p.proj * 10) / 10, rate: Math.round(p.rate * 10) / 10 }; // compare what's shown
    const a = rd(plOf(pick.a)), b = rd(plOf(pick.b));
    if (!a || !b) { $('cmp-out').innerHTML = ''; return; }
    const rows = [
      ['Expected this week', a.proj, b.proj, 1],
      // later weeks (ESPN only); '-' = bye or no projection
      ...Array.from({ length: Math.max(0, R.lastWeek - R.fw + 1) }, (_, i) => ['Week ' + (R.fw + i) + ' (ESPN)', a.fut?.[i] ?? '-', b.fut?.[i] ?? '-', 1]),
      ['Weeks ' + R.fw + '-' + R.lastWeek + ' total (ESPN)', +(a.fut || []).reduce((t, v) => t + (v || 0), 0).toFixed(1), +(b.fut || []).reduce((t, v) => t + (v || 0), 0).toFixed(1), 1],
      ['Great-game score', a.ceiling || a.proj, b.ceiling || b.proj, 1],
      ['Per game, rest of season', a.rate, b.rate, 1],
      ['Per game so far', a.avg, b.avg, 1],
      ['Rank at his position', a.rank || '-', b.rank || '-', -1],
      ['Status', a.status, b.status, 0],
      ['Bye week', a.bye || '-', b.bye || '-', 0],
    ];
    const cell = (v, o, dir) => '<td class="num' + (dir && typeof v === 'number' && typeof o === 'number' && (dir > 0 ? v > o : v < o) ? ' win' : '') + '">' + e(typeof v === 'number' && dir > 0 ? v.toFixed(1) : v) + '</td>';
    const wk = a.proj === b.proj ? 'Even this week.' : 'This week: ' + e((a.proj > b.proj ? a : b).name) + ' (by ' + Math.abs(a.proj - b.proj).toFixed(1) + ').';
    const ros = a.rate === b.rate ? 'Even for the rest of the season.' : 'Rest of season: ' + e((a.rate > b.rate ? a : b).name) + ' (by ' + Math.abs(a.rate - b.rate).toFixed(1) + ' per game).';
    $('cmp-out').innerHTML = '<table class="cmp"><tr><td></td><td class="num"><b>' + e(a.name.split(' ').slice(-1)[0]) + '</b></td><td class="num"><b>' + e(b.name.split(' ').slice(-1)[0]) + '</b></td></tr>' +
      rows.map(([k, x, y, dir]) => '<tr><td>' + k + '</td>' + cell(x, y, dir) + cell(y, x, dir) + '</tr>').join('') + '</table>' +
      '<p class="why"><b>Better pick</b><br>' + wk + '<br>' + ros + '</p>';
  }
  const mine = rosterOf(R.me);
  pick.a = mine[0] ? mine[0].id : null;
  pick.b = (R.fa.map(plOf).find(p => p && mine[0] && p.pos === mine[0].pos) || mine[1] || {}).id || null;
  try { const s = JSON.parse(sessionStorage.getItem('cmp') || 'null'); if (s) for (const k of ['a', 'b']) if (R.pl[s[k]]) pick[k] = s[k]; } catch {}
  drawPick('a'); drawPick('b'); compare();

  // --- From any player's page: "Compare" puts him in a compare box, "Trade" ticks him in the trade checker
  function compareWith(id) {
    setPick(rosterOf(R.me).some(p => p.id === id) ? 'a' : 'b', id);
    closeSheet(); history.replaceState(null, '', '#compare'); showTab('compare', true);
  }
  function tradeFor(id) {
    const t = R.teams.find(t => t.ids.includes(id));
    if (!t) return;
    if (t.id !== R.me) { tcTeam.value = t.id; tcLists(); }
    const box = document.querySelector('#check input[data-side=' + (t.id === R.me ? 'give' : 'get') + '][value="' + id + '"]');
    if (box) box.checked = true;
    tcCheck();
    closeSheet(); history.replaceState(null, '', '#compare'); showTab('compare', true); $('check').scrollIntoView({ behavior: 'smooth' });
  }
  // a swap card's Compare / Trade check: fill both sides, then open the page
  function cmpBoth(a, b) {
    if (!plOf(a) || !plOf(b)) return;
    setPick('a', a); setPick('b', b);
    closeSheet(); history.replaceState(null, '', '#compare'); showTab('compare', true);
  }
  function tcFill(give, get) {
    const t = R.teams.find(t => t.id !== R.me && get.some(id => t.ids.includes(id)));
    if (!t) return;
    tcTeam.value = t.id; tcLists();
    document.querySelectorAll('#check input[data-side]').forEach(i => { i.checked = (i.dataset.side === 'give' ? give : get).includes(+i.value); });
    tcCheck();
    closeSheet(); history.replaceState(null, '', '#compare'); showTab('compare', true); $('check').scrollIntoView({ behavior: 'smooth' });
  }
  document.addEventListener('click', ev => {
    const c2 = ev.target.closest('[data-cmp2]'), tc = ev.target.closest('[data-tc]');
    if (c2) { const [a, b] = c2.dataset.cmp2.split(',').map(Number); cmpBoth(a, b); }
    if (tc) { const [g, t] = tc.dataset.tc.split(';').map(x => x.split(',').map(Number)); tcFill(g, t); }
  });
  document.addEventListener('click', ev => {
    const c = ev.target.closest('[data-cmp]'), t = ev.target.closest('[data-trade]');
    if (c) compareWith(+c.dataset.cmp);
    if (t) tradeFor(+t.dataset.trade);
  });
})();
// Trade ideas and fleece finder: pick a team (then players on it to fleece), loosen the check, show more or a new batch.
// Every candidate is already on the page; this only picks which cards show.
{
  const teamSel = document.getElementById('tp-team'), loose = document.getElementById('tp-loose'), playerSel = document.getElementById('tp-player');
  // iPhone ignores hidden <option>s, so the list is rebuilt for each team
  const allPlayers = playerSel ? [...playerSel.options].slice(1) : [];
  const chosen = () => (playerSel.value ? [playerSel.value] : []);
  const lists = [...document.querySelectorAll('.pool-list')].map(el => {
    const l = { el, step: +el.dataset.step, start: 0, count: +el.dataset.step, bar: el.nextElementSibling, emptyText: el.querySelector('.pool-empty').textContent };
    l.bar.querySelector('[data-more]').onclick = () => { l.count += l.step; draw(); };
    l.bar.querySelector('[data-next]').onclick = () => { l.start += l.count; l.count = l.step; draw(); };
    return l;
  });
  function draw() {
    for (const l of lists) {
      const cards = [...l.el.children].filter(c => c.dataset.team), picked = chosen();
      // fleece cards: picked players only; with none picked, the extra cards stay hidden
      const forPlayer = c => !c.dataset.take || (picked.length ? picked.includes(c.dataset.take) : c.dataset.extra !== '1');
      // a picked player shows every offer for him, so the looser check doesn't apply there
      const isFleece = l.el.querySelector('[data-take]');
      const ok = cards.filter(c => (!teamSel.value || c.dataset.team === teamSel.value) && (loose.checked || c.dataset.strict === '1' || (isFleece && picked.length)) && forPlayer(c));
      if (isFleece) l.el.querySelector('.pool-empty').textContent = picked.length ? 'No trade for ' + (picked.length > 1 ? 'these players' : 'this player') + ' helps you and still looks fair to them.' : l.emptyText;
      if (l.start >= ok.length) l.start = 0; // "New batch" past the end starts over
      cards.forEach(c => { c.hidden = true; });
      ok.slice(l.start, l.start + l.count).forEach(c => { c.hidden = false; });
      l.el.querySelector('.pool-empty').hidden = ok.length > 0;
      l.bar.querySelector('[data-more]').hidden = l.start + l.count >= ok.length;
      l.bar.querySelector('[data-next]').hidden = ok.length <= l.count;
      l.bar.style.display = l.bar.querySelector('[data-more]').hidden && l.bar.querySelector('[data-next]').hidden ? 'none' : ''; // .tools2 is a grid, so [hidden] alone won't hide it
    }
  }
  const reset = () => { lists.forEach(l => { l.start = 0; l.count = l.step; }); draw(); };
  const pickTeam = () => {
    const mine = allPlayers.filter(o => o.dataset.team === teamSel.value);
    playerSel.replaceChildren(playerSel.options[0], ...mine);
    playerSel.value = '';
    playerSel.hidden = !mine.length;
    reset();
  };
  if (teamSel) { teamSel.onchange = pickTeam; loose.onchange = reset; playerSel.onchange = reset; draw(); }
}
// One section at a time: the bottom bar picks which tab shows, like pages in an app
// 5 tabs; Moves, Trades and More each hold a few pages, picked with the switch at the top. Each tab remembers its page.
const navLinks = [...document.querySelectorAll('nav a')];
const GROUPS = { home: ['home'], team: ['team'], moves: ['pickups', 'pending'], trades: ['trades', 'compare'], more: ['season', 'league', 'news', 'help', 'settings'] };
const PAGE_NAME = { pickups: 'Pickups', pending: 'Pending', trades: 'Trade ideas', compare: 'Compare', season: 'Season', league: 'League', news: 'News', help: 'How it works', settings: 'Settings' };
const lastPage = {};
function showTab(tab, jump) {
  let g = Object.keys(GROUPS).find(k => GROUPS[k].includes(tab));
  if (!g) { g = GROUPS[tab] ? tab : 'home'; tab = lastPage[g] || GROUPS[g][0]; }
  lastPage[g] = tab;
  if (jump) history.replaceState(null, '', '#' + tab);
  // a section tagged with the tab itself shows on every page of that tab, unless a page has the tab's name
  // (Trades > Trade ideas is 'trades' too: its sections showed under Compare)
  document.querySelectorAll('section[data-tab]').forEach(s => s.classList.toggle('off', s.dataset.tab !== tab && (s.dataset.tab !== g || GROUPS[g].includes(g))));
  document.body.classList.toggle('home', tab === 'home');
  navLinks.forEach(a => a.classList.toggle('on', a.hash === '#' + g));
  const seg = document.getElementById('seg');
  seg.hidden = GROUPS[g].length < 2;
  if (seg.dataset.g === g) seg.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === tab));
  else seg.dataset.g = g, seg.innerHTML = GROUPS[g].length < 2 ? '' : GROUPS[g].map(p => '<button type="button" data-page="' + p + '"' + (p === tab ? ' class="on"' : '') + '>' + PAGE_NAME[p] + '</button>').join('');
  // red number on Home, and the same number on the to-do list it points to
  const k = document.querySelectorAll('#todo .card.todo').length;
  for (const dot of document.querySelectorAll('nav .dot, #todo h2 .dot')) { dot.hidden = !k; dot.textContent = k; }
  if (jump) document.body.scrollTo({ top: 0 });
}
// Hold the tab bar and slide your finger like on iPhone: the tab under it lights up, letting go opens it.
// A plain tap works the same way (press and let go on one tab). Keyboard Enter still uses the click.
const tabBar = document.querySelector('nav');
let held = null;
const press = a => { if (a === held) return; navLinks.forEach(l => l.classList.toggle('press', l === a)); if (held && a) navigator.vibrate?.(8); held = a; };
const tabAt = x => navLinks.find(l => { const r = l.getBoundingClientRect(); return x >= r.left && x < r.right; });
tabBar.addEventListener('pointerdown', ev => { const a = ev.target.closest('nav a'); if (!a) return; tabBar.setPointerCapture(ev.pointerId); press(a); });
tabBar.addEventListener('pointermove', ev => { if (held) press(tabAt(ev.clientX) || held); });
tabBar.addEventListener('pointerup', () => { const a = held; press(null); if (a) showTab(a.hash.slice(1), true); });
tabBar.addEventListener('pointercancel', () => press(null));
navLinks.forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); if (!ev.detail) showTab(a.hash.slice(1), true); }));
document.getElementById('seg').addEventListener('click', ev => { const b = ev.target.closest('[data-page]'); if (b) showTab(b.dataset.page, true); });
showTab(location.hash.slice(1), false);
// Glass look: each bar (tab bar, switches) gets one bubble that slides to its picked button, or the tab under your finger.
// Re-placed whenever a class changes anywhere (picked button, look, held tab, page merges) or the screen resizes.
const placeBlobs = () => { for (const bar of document.querySelectorAll('nav,.seg')) {
  if (bar.dataset.drag) continue; // your finger has it
  const on = bar.querySelector(':scope > .press') || bar.querySelector(':scope > .on');
  let b = bar.querySelector(':scope > .blob');
  if (!b) { b = document.createElement('i'); b.className = 'blob'; b.setAttribute('aria-hidden', 'true'); bar.prepend(b); }
  b.hidden = !on;
  if (!on) continue;
  const t = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
  if (b.style.transform !== t) b.style.transform = t;
  b.style.width = on.offsetWidth + 'px'; b.style.height = on.offsetHeight + 'px';
  b.style.setProperty('--spin', Math.round((on.offsetLeft + on.offsetWidth / 2) / bar.clientWidth * 270 - 135) + 'deg');
  b.classList.toggle('held', on.classList.contains('press'));
} };
let blobQ = 0;
new MutationObserver(() => { if (!blobQ) blobQ = requestAnimationFrame(() => { blobQ = 0; placeBlobs(); }); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
addEventListener('resize', placeBlobs); placeBlobs();
// Drag any bubble anywhere along its bar: it follows your finger freely (no stepping from button to button) and swells a
// little; let go and it springs to the nearest button and picks it. The tab bar's own handlers open that tab; on a switch
// this presses the button. A plain tap is still a tap.
document.addEventListener('pointerdown', ev => {
  const bar = ev.target.closest('nav,.seg'), blob = bar?.querySelector(':scope > .blob');
  if (!blob || blob.hidden || !document.documentElement.classList.contains('glass')) return;
  const btns = [...bar.children].filter(x => x !== blob && x.matches('a,button'));
  if (!btns.length) return;
  const x0 = ev.clientX, left = bar.getBoundingClientRect().left, w = blob.offsetWidth, y = btns[0].offsetTop;
  const lo = btns[0].offsetLeft, hi = btns.at(-1).offsetLeft + btns.at(-1).offsetWidth - w;
  const at = x => Math.min(hi, Math.max(lo, x - left - w / 2));
  let moved = false;
  const move = e => {
    if (!moved && Math.abs(e.clientX - x0) < 4) return;
    moved = true; bar.dataset.drag = '1'; blob.classList.add('held', 'drag');
    blob.style.transform = 'translate(' + at(e.clientX) + 'px,' + y + 'px)';
    blob.style.setProperty('--spin', Math.round((at(e.clientX) + w / 2) / bar.clientWidth * 270 - 135) + 'deg');
  };
  const end = e => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    if (moved && e.type === 'pointerup' && bar.tagName !== 'NAV') {
      const c = at(e.clientX) + w / 2, pick = btns.find(b => c >= b.offsetLeft && c < b.offsetLeft + b.offsetWidth);
      if (pick && !pick.classList.contains('on')) pick.click();
    }
    delete bar.dataset.drag; blob.classList.remove('held', 'drag'); placeBlobs();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
});

// Background, like the password screen: a dot grid with rings of light rolling out from the middle.
// Dimmer than the lock screen so it doesn't fight the text; ~20 frames a second, and nothing while the app is hidden.
(() => {
  const cv = document.getElementById('bg-field');
  if (!cv) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches; // phone set to reduce motion: the dots, standing still
  const cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; if (still) { last = -99; draw(0); } };
  let last = -99;
  const draw = now => {
    if (!still) requestAnimationFrame(draw);
    if (document.hidden || now - last < 50 || !document.documentElement.classList.contains('term')) return;
    last = now;
    const w = cv.width, h = cv.height, gap = 26 * dpr, t = now / 1000;
    cx.clearRect(0, 0, w, h);
    for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) {
      const wave = Math.max(0, Math.sin(Math.hypot(x - w / 2, y - h * 0.38) / dpr / 70 - t * 0.8));
      cx.fillStyle = 'rgba(255,255,255,' + (0.05 + 0.28 * wave ** 14) + ')';
      cx.fillRect(x, y, 1.5 * dpr, 1.5 * dpr);
    }
  };
  addEventListener('resize', size); size();
  if (!still) requestAnimationFrame(draw);
})();

// Glass background: a coach's chalkboard on the field. Every few seconds a new play draws itself: the offense lines up,
// each receiver's route grows out with a glowing runner on its tip, the defenders follow, the QB's pass arcs to one of
// them (in blue), and it all fades for the next play. ~30 frames a second, nothing while the app is hidden; with reduce
// motion on, one play stands still.
(() => {
  const cv = document.getElementById('bg-field');
  if (!cv) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  // routes for a receiver on the left, in yards from where he lines up (up the screen is upfield); the right side is mirrored
  const ROUTES = [[[0, -16]], [[0, -3], [6, -9]], [[0, -8], [5, -15]], [[0, -7], [-5, -7]], [[0, -9], [1, -7]], [[0, -8], [-5, -14]], [[0, -8], [7, -8]]];
  const WHEEL = [[-3, -1], [-5, -4], [-5, -14]], FLAT = [[-4, -1], [-7, -2]];
  const PLAY = 5.5, ease = x => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3, pick = a => a[Math.floor(Math.random() * a.length)];
  let play = null, start = 0, last = -99;
  const newPlay = () => {
    const w = innerWidth, h = innerHeight, u = Math.min(w, 520) / 30, c = w / 2, y0 = h * (0.45 + Math.random() * 0.3);
    const path = (x, y, steps, flip) => [[x, y], ...steps.map(([dx, dy]) => [x + dx * u * flip, y + dy * u])];
    const runners = [[c - 12 * u, y0, 1], [c + 12 * u, y0, -1], [c + 8 * u, y0 + u, -1], [c - 5 * u, y0, 1]].map(([x, y, f]) => path(x, y, pick(ROUTES), f));
    runners.push(path(c + 1.5 * u, y0 + 5 * u, pick([WHEEL, FLAT]), Math.random() < 0.5 ? 1 : -1));
    const line = [-2, -1, 0, 1, 2].map(i => [c + i * 2 * u, y0]), qb = [c, y0 + 3.5 * u];
    const d = runners.slice(0, 4).map(r => [r[0][0] + (Math.random() - 0.5) * 3 * u, y0 - (6 + Math.random() * 5) * u]);
    return { u, runners, line, qb, d, to: Math.floor(Math.random() * runners.length) };
  };
  // the point a fraction f along a path, and the path drawn up to there
  const along = (p, f) => {
    const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1])), total = seg.reduce((a, b) => a + b, 0);
    let left = f * total;
    for (let i = 0; i < seg.length; i++) { if (left <= seg[i]) { const k = seg[i] ? left / seg[i] : 0; return [p.slice(0, i + 1), [p[i][0] + (p[i + 1][0] - p[i][0]) * k, p[i][1] + (p[i + 1][1] - p[i][1]) * k]]; } left -= seg[i]; }
    return [p.slice(0, -1), p.at(-1)];
  };
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; play = null; if (still) { last = -99; draw(PLAY * 0.55 * 1000); } };
  const draw = now => {
    if (!still) requestAnimationFrame(draw);
    if (document.hidden || now - last < 33 || !document.documentElement.classList.contains('glass')) return;
    last = now;
    const t = now / 1000;
    if (!play || t - start > PLAY) { play = newPlay(); start = still ? t - PLAY * 0.55 : t; }
    const s = t - start, { u, runners, line, qb, d, to } = play, fade = Math.min(1, s / 0.4, (PLAY - s) / 0.9), f = ease((s - 0.5) / 2.2);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, innerWidth, innerHeight);
    cx.globalAlpha = Math.max(0, fade); cx.lineCap = cx.lineJoin = 'round'; cx.lineWidth = 2;
    const ring = ([x, y], a) => { cx.strokeStyle = 'rgba(255,255,255,' + a + ')'; cx.beginPath(); cx.arc(x, y, u * 0.6, 0, 7); cx.stroke(); };
    for (const p of line) ring(p, 0.3);
    ring(qb, 0.3);
    runners.forEach((p, i) => {
      const [done, head] = along(p, f), mine = i === to;
      cx.strokeStyle = mine ? 'rgba(10,132,255,.75)' : 'rgba(255,255,255,.26)'; cx.shadowColor = mine ? '#0a84ff' : 'rgba(255,255,255,.6)'; cx.shadowBlur = 10;
      cx.beginPath(); cx.moveTo(...done[0]); for (const q of done.slice(1)) cx.lineTo(...q); cx.lineTo(...head); cx.stroke();
      cx.shadowBlur = 0; ring(p[0], 0.3);
      cx.fillStyle = mine ? '#0a84ff' : '#fff'; cx.shadowColor = cx.fillStyle; cx.shadowBlur = 14;
      cx.beginPath(); cx.arc(head[0], head[1], u * 0.28, 0, 7); cx.fill(); cx.shadowBlur = 0;
    });
    // defenders: X's that drift toward the receiver they cover
    cx.strokeStyle = 'rgba(255,255,255,.22)';
    d.forEach(([x, y], i) => { const h = along(runners[i], f)[1], X = x + (h[0] - x) * 0.45 * f, Y = y + (h[1] - y) * 0.3 * f, r = u * 0.45;
      cx.beginPath(); cx.moveTo(X - r, Y - r); cx.lineTo(X + r, Y + r); cx.moveTo(X + r, Y - r); cx.lineTo(X - r, Y + r); cx.stroke(); });
    // the pass: a dashed arc from the QB to the target's spot, with the ball riding it
    const b = ease((s - 1.7) / 1.1);
    if (b > 0) {
      const end = along(runners[to], Math.min(1, ease((1.7 + 1.1 - 0.5) / 2.2)))[1], ctl = [(qb[0] + end[0]) / 2, Math.min(qb[1], end[1]) - 5 * u];
      const at = k => [(1 - k) ** 2 * qb[0] + 2 * (1 - k) * k * ctl[0] + k * k * end[0], (1 - k) ** 2 * qb[1] + 2 * (1 - k) * k * ctl[1] + k * k * end[1]];
      cx.setLineDash([3, 6]); cx.strokeStyle = 'rgba(10,132,255,.5)'; cx.beginPath(); cx.moveTo(...qb);
      for (let k = 0.05; k <= b; k += 0.05) cx.lineTo(...at(k));
      cx.stroke(); cx.setLineDash([]);
      const [bx, by] = at(b); cx.fillStyle = '#fff'; cx.shadowColor = '#0a84ff'; cx.shadowBlur = 16;
      cx.beginPath(); cx.ellipse(bx, by, u * 0.32, u * 0.2, -0.6, 0, 7); cx.fill(); cx.shadowBlur = 0;
    }
    cx.globalAlpha = 1;
  };
  addEventListener('resize', size); size();
  if (!still) requestAnimationFrame(draw);
})();

// Look switch (More > Settings): Terminal, Classic or Glass, saved on this phone
const LOOKS = ['term', 'glass'], curLook = () => LOOKS.find(c => document.documentElement.classList.contains(c)) ?? 'classic';
const showLook = () => document.querySelectorAll('[data-look]').forEach(b => b.classList.toggle('on', b.dataset.look === curLook()));
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-look]');
  if (!b) return;
  for (const c of LOOKS) document.documentElement.classList.toggle(c, c === b.dataset.look);
  try { localStorage.setItem('look', b.dataset.look); } catch {}
  showLook(); dispatchEvent(new Event('resize'));
});
showLook();

// "Pick him up": his page, scrolled to the list of who to drop
document.addEventListener('click', ev => {
  const u = ev.target.closest('[data-pickup]');
  if (!u) return;
  openSheet(u.dataset.pickup);
  document.getElementById('addhim')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// "Copy text" buttons: put the text on the clipboard
document.addEventListener('click', ev => {
  const c = ev.target.closest('[data-copy]');
  if (!c) return;
  navigator.clipboard.writeText(c.dataset.copy).then(() => { c.textContent = 'Copied'; setTimeout(() => { c.textContent = 'Copy text'; }, 2000); }, () => { c.textContent = 'Copy failed'; });
});

// Fleece texts: "Another version" swaps the text; "Have Claude write it" copies the facts and opens Claude
document.addEventListener('click', ev => {
  const v = ev.target.closest('[data-versions]');
  if (v) {
    const list = JSON.parse(v.dataset.versions), card = v.closest('.card'), p = card.querySelector('.pitch');
    const next = list[(list.indexOf(p.textContent) + 1) % list.length];
    p.textContent = next; card.querySelector('[data-copy]').dataset.copy = next;
  }
  const w = ev.target.closest('[data-claude]');
  if (w) navigator.clipboard.writeText(w.dataset.claude).then(() => { w.textContent = 'Opening Claude. If the box is empty, paste'; }, () => {}).finally(() => window.open(claudeUrl(w.dataset.claude), '_blank', 'noopener'));
});
// Floating ESPN button: drag to move (remembered on this phone), tap to open the app (only paths in ESPN's
// apple-app-site-association, like /football/league, open the app; the bare site opens Safari), fades after 30s untouched
(() => {
  const fab = document.getElementById('fab');
  if (!fab) return;
  try { const p = JSON.parse(localStorage.getItem('fabPos') || 'null'); if (p) { fab.style.left = p.x + 'px'; fab.style.top = p.y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; } } catch {}
  let start = null, moved = false, idle;
  const wake = () => { fab.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => fab.classList.add('idle'), 30000); };
  wake();
  fab.addEventListener('pointerdown', wake);
  fab.addEventListener('pointerup', wake);
  fab.addEventListener('pointerdown', ev => { start = { x: ev.clientX, y: ev.clientY, l: fab.offsetLeft, t: fab.offsetTop }; moved = false; fab.setPointerCapture(ev.pointerId); });
  fab.addEventListener('pointermove', ev => {
    if (!start) return;
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; fab.classList.add('drag');
    const x = Math.min(innerWidth - fab.offsetWidth - 4, Math.max(4, start.l + dx)), y = Math.min(innerHeight - fab.offsetHeight - 4, Math.max(4, start.t + dy));
    fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto';
  });
  fab.addEventListener('pointerup', () => {
    fab.classList.remove('drag');
    if (moved) try { localStorage.setItem('fabPos', JSON.stringify({ x: fab.offsetLeft, y: fab.offsetTop })); } catch {}
    start = null;
  });
  fab.addEventListener('click', ev => { if (moved) { ev.preventDefault(); moved = false; } });
})();
`;
const MOVE_JS = String.raw`// Roster-move buttons: ask first, then send the move to ESPN through the Cloudflare worker
const WHY = {
  TRAN_LINEUP_LOCKED: "one of those players' games already started, so ESPN locked him",
  TRAN_ROSTER_LIMIT_EXCEEDED_ONE: "your roster is full",
  TRAN_PLAYER_NOT_FREEAGENT: "that player isn't available anymore",
  TRAN_PLAYER_NOT_AVAILABLE: "that player isn't available anymore",
  TRAN_PLAYER_NOT_ON_TEAM: "that player isn't on your team anymore",
  TRAN_NOT_FOUND: "that trade offer is no longer open",
  TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT: "the site is a bit behind ESPN. Wait 2 minutes and try again",
  'Failed to fetch': "the site couldn't reach the move server",
  'Load failed': "the site couldn't reach the move server",
};
document.addEventListener('click', async ev => {
  const b = ev.target.closest('button.do');
  if (!b || b.disabled) return;
  const m = JSON.parse(b.dataset.move);
  if (!confirm(m.label + '?\n\nThis changes your real ESPN team.')) return;
  let key = null;
  try { key = localStorage.getItem('moveKey'); } catch {}
  if (!key) key = prompt('Move password (the KEY you set in Cloudflare). This phone remembers it.');
  if (!key) return;
  b.disabled = true; b.textContent = 'Sending to ESPN...';
  try {
    const r = await fetch('__URL__', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': key }, body: JSON.stringify(m) });
    const out = await r.json().catch(() => ({}));
    if (r.status === 401) { try { localStorage.removeItem('moveKey'); } catch {} throw new Error('Wrong password. Tap the button to try again'); }
    if (!r.ok) throw new Error(out.error || 'ESPN said ' + r.status);
    try { localStorage.setItem('moveKey', key); } catch {}
    b.textContent = m.type === 'TRADE_PROPOSAL' ? 'Trade offer sent on ESPN' : out.status === 'PENDING' ? 'Claim sent. It goes through when waivers run' : 'Done on ESPN. The site catches up in about 3 minutes';
    const pitch = m.sms && b.closest('.card') && b.closest('.card').querySelector('.pitch');
    if (pitch && confirm('Offer sent. Open Messages with the text to ' + m.sms + '? You still press send.')) {
      let num = '';
      try { num = localStorage.getItem('phone:' + m.other) || ''; } catch {}
      if (!num) { num = (prompt('Phone number for ' + m.sms + '? Saved on this phone only. Leave blank to pick them in Messages.') || '').replace(/[^0-9+]/g, ''); try { if (num) localStorage.setItem('phone:' + m.other, num); } catch {} }
      location.href = 'sms:' + num + '&body=' + encodeURIComponent(pitch.textContent);
    }
  } catch (err) {
    b.disabled = false; b.textContent = m.label;
    alert('ESPN did not make the move: ' + (WHY[err.message] || err.message) + '.');
  }
});`;
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
    games.push({ wk, pts: s?.appliedTotal ?? null, note: p.bye === wk ? 'bye' : '–', line: scoring(s), why: p.bye === wk ? [] : whyWeek(p, wk, s?.appliedTotal ?? null,
      c?.stats?.find(x => x.seasonId === SEASON && x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === wk)?.appliedTotal) });
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
  const sources = [
    p.bye === week ? 'No game this week (bye), so no projection.' : p.roto != null || p.cbs != null ? `${srcText(p)}. We use the average. ${p.split ? 'They disagree a lot, so he\'s a riskier start than the number looks.' : 'They mostly agree.'}` : p.espn != null ? `Only ESPN has a number for him (${n(p.espn)}).` : '',
    p.vegas && p.pos !== 'D/ST' && p.bye !== week ? `Vegas expects his team to score about ${Math.round(p.vegas)} points, ${p.vegas >= vegasAvg + 3 ? 'one of the higher totals this week. Good for him.' : p.vegas <= vegasAvg - 3 ? 'one of the lower totals this week. Bad for him.' : 'about average this week.'}` : '',
  ].filter(Boolean).join(' ');
  pdata[id] = {
    id, name: p.name, posName: POS_NAME[p.pos] ?? p.pos, teamName: p.teamName, free: t ? null : { wa: !!p.wa, locked: locked(p) },
    pro: String(p.proTeamId), side: isStarter(p) ? (mine ? 'me' : t && t === opp ? 'opp' : null) : null, // Watch view: starters in my matchup
    owner: mine ? 'On your team' : t ? `On ${t.name}` : 'Free: nobody in your league has him',
    play, advice, game: p.bye === week ? '' : gameText(p), proj: n(p.proj), ceiling: p.ceiling > (p.proj ?? 0) + 1 ? Math.round(p.ceiling) : null,
    avg: n(p.avg), rank: p.rank ? '#' + p.rank : '-', rankWhy: p.rank ? rankWhy(p) + ' (this season)' : '', started: c?.ownership?.percentStarted != null ? `${Math.round(c.ownership.percentStarted)}%` : '-',
    trend, hit: hitLine(p)?.[1] ?? '', sources, games, now, plays: plays.get(id) ?? [], notes: notes(p),
    rosText: p.ros == null ? '' : `Expected ${n(p.ros)} points per game from here on (${[['ESPN', p.rosBy[0]], ['Rotowire', p.rosBy[1]], ['CBS', p.rosBy[2]]].filter(([, v]) => v != null).map(([src, v]) => `${src} ${n(v)}`).join(', ')}). Season pickups and trades use this.`, news: (news.get(id) ?? []).map(x => ({ ...x, s: freshSnip(x.s, p) })),
    byeText: !p.bye ? 'No bye listed.' : p.bye < week ? `Week ${p.bye}, already done. He plays every week from now on.` : p.bye === week ? 'This week. He won\'t play.' : `Week ${p.bye}. He won't play that week, so you'll need someone else.`,
  };
  // a defense is a whole team: "they", not "he"
  if (p.pos === 'D/ST') for (const k of ['play', 'advice']) if (pdata[id][k]) pdata[id][k] = [pdata[id][k][0], pdata[id][k][1].replace(/\bhe's\b/gi, 'they\'re').replace(/\bHe\b/g, 'They').replace(/\bhim\b/g, 'them')];
  if (p.pos === 'D/ST') pdata[id].sources = sources.replace(/he's a riskier/, 'they\'re a riskier').replace(/for him \(/, 'for them (');
  if (p.pos === 'D/ST') pdata[id].byeText = pdata[id].byeText.replace(/He plays/, 'They play').replace(/He won't/g, 'They won\'t').replace(/he won't/g, 'they won\'t');
}
const TAB_OF = { look: 'settings', account: 'settings', changes: 'home', ask: 'home', alerts: 'home', todo: 'home', lineup: 'team', bench: 'team', pickups: 'pickups', pending: 'pending', check: 'compare', fleece: 'trades', buysell: 'trades', partners: 'trades', trades: 'trades', compare: 'compare', season: 'season', league: 'league', news: 'news', help: 'help' };
html = html.replace(/<section id="([a-z]+)"/g, (m, id) => TAB_OF[id] ? `${m} data-tab="${TAB_OF[id]}"` : m);
html = html.replace(/(<h2>[^<]*<\/h2>)<p class="sub">([\s\S]*?)<\/p>/g, (m, h, text) => {
  const cut = text.indexOf('. ');
  if (text.replace(/<[^>]+>/g, '').length < 110 || cut < 0) return m;
  return `${h}<p class="sub">${text.slice(0, cut + 1)}</p><details class="intro"><summary>How to read this</summary><p class="sub">${text.slice(cut + 2)}</p></details>`;
});
// extra sections fold to one line you tap to open, so each tab starts short
html = html.replace(/(<section id="(?:bench|fleece|buysell|partners)"[^>]*>)(<h2>[^<]*<\/h2>)([\s\S]*?)<\/section>/g, '$1<details class="fold"><summary>$2</summary>$3</details></section>');
html = html.replace('__TOOLSJS__', () => TOOLS_JS.replace('__BESTLINEUP__', bestLineup.toString()));
html = html.replace('__MOVEJS__', () => MOVE_URL ? MOVE_JS.replace('__URL__', MOVE_URL) : '');
const lite = p => [p.name, p.pos, p.teamName ?? '', +(p.proj ?? 0).toFixed(2), +rate(p).toFixed(2), playable(p) ? 1 : 0, locked(p) ? 1 : 0, p.slot, p.rank ?? 0, Math.round(p.ceiling ?? 0), +(p.avg ?? 0).toFixed(1), p.bye ?? 0, statusWords(p), p.team ?? '', nextProj.has(p.id) ? +nextProj.get(p.id).toFixed(2) : null, rosSaved.future.by[p.id] ?? null];
const faList = allFa.filter(p => rate(p) > 0 || (p.proj ?? 0) > 0).sort((a, b) => rate(b) - rate(a)).slice(0, 120);
const rdata = { week: league.scoringPeriodId, fw: week + 1, lastWeek, me: me.id, moves: !!MOVE_URL, tradesOpen, voice: VOICE, slotCounts, slotPos: SLOT_POS, slotName: SLOT, repl,
  teams: teams.map(t => { const b = board.find(r => r.t === t); return { id: t.id, name: t.name, ids: t.roster.map(p => p.id), short: depth(t).short, rec: `${t.w}-${t.l}`, now: b?.now ?? null, proj: b ? +b.proj.toFixed(1) : null,
    rows: [...t.roster].sort((a, c) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(c.slot)).map(p => { const g = gameNow[TEAM(p.team)]; return [p.id, p.slot, p.now ?? 0, p.proTeamId ?? 0, p.bye === week ? 'bye' : g?.state ?? '', g?.text ?? '', +(p.proj ?? 0).toFixed(1)]; }) }; }), fa: faList.map(p => p.id),
  pl: Object.fromEntries([...exShown.values(), ...teams.flatMap(t => t.roster), ...faList].map(p => [p.id, lite(p)])) };
html = html.replace('__RDATA__', () => JSON.stringify(rdata).replace(/</g, '\\u003c'));
html = html.replace('__PDATA__', JSON.stringify(pdata).replace(/</g, '\\u003c'));

// Site password (GitHub secret SITE_PASSWORD): the published page is the real page encrypted
// (AES-GCM, key from the password via PBKDF2), plus a small unlock screen. The page is public on
// GitHub, so a plain "enter password" screen would only hide it; encrypted, it can't be read without
// the password. The phone keeps the password, so it's asked once. The head stays readable (no team
// data in it) so the update check can still read the build time.
async function lockPage(page, password) {
  // fixed salt so the key (which the phone saves) stays the same between builds; the iv is new every build
  const { subtle } = crypto.webcrypto, salt = crypto.createHash('sha256').update('Fantasy-app site lock').digest().subarray(0, 16), iv = crypto.randomBytes(12);
  const base = await subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(page))).toString('base64');
  return page.slice(0, page.indexOf('</head>')) + `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
body.ls{margin:0;min-height:100dvh;background:#000;color:#fff;font:14px 'JetBrains Mono',ui-monospace,Menlo,monospace;overflow:hidden;-webkit-font-smoothing:antialiased}
body.ls::before{display:none}
#field{position:fixed;inset:0;width:100%;height:100%}
.ring{position:fixed;left:50%;top:50%;width:min(130vw,640px);aspect-ratio:1;translate:-50% -50%;border:1px dashed #ffffff26;border-radius:50%;animation:spin 120s linear infinite;pointer-events:none}
.ring.r2{width:min(92vw,440px);border:1px solid #ffffff14;animation-duration:40s;animation-direction:reverse}
.ring.r2::after{content:'';position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 14px #fff}
@keyframes spin{to{rotate:360deg}}
.corner{position:fixed;font-size:10px;letter-spacing:.18em;color:#ffffff66;pointer-events:none;min-height:1em}
.wrap{position:relative;min-height:100dvh;display:grid;place-items:center;padding:0 24px}
#lock{width:100%;max-width:330px}
.ttl{font-size:21px;font-weight:700;letter-spacing:.16em;margin:0 0 8px;white-space:nowrap;min-height:1.3em}
.sub{color:#ffffff88;font-size:12px;letter-spacing:.1em;margin:0 0 30px;min-height:1.3em}
.typing::after,.cur{animation:blink 1s steps(1) infinite}
.typing::after{content:'_'}
@keyframes blink{50%{opacity:0}}
.row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #ffffff55;padding:10px 0;transition:border-color .3s,opacity .6s}
.row:focus-within{border-color:#fff}
.field{position:relative;flex:1;min-width:0;height:1.6em;display:flex;align-items:center}
#mask{font-size:16px;letter-spacing:.3em;white-space:nowrap}
#pw{position:absolute;inset:0;width:100%;background:none;border:0;outline:0;color:transparent;caret-color:transparent;font:16px 'JetBrains Mono',ui-monospace,Menlo,monospace;opacity:.01}
#ok{position:absolute;left:0;top:50%;translate:0 -50%;border:1.5px solid #39ff88;color:#39ff88;padding:6px 10px;font-weight:700;letter-spacing:.22em;white-space:nowrap;text-shadow:0 0 10px #39ff8866;box-shadow:0 0 18px #39ff8833 inset,0 0 18px #39ff8833;clip-path:inset(0 0 0 100%)}
#beam{position:absolute;top:50%;width:2px;height:2.6em;translate:-1px -50%;background:#fff;box-shadow:0 0 12px #fff,0 0 4px #fff;opacity:0}
.go{margin-top:24px;width:100%;padding:14px;background:none;border:1px solid #fff;color:#fff;font:700 13px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.35em;cursor:pointer;transition:background .2s,color .2s}
.go:hover,.go:active{background:#fff;color:#000}
#bad{margin:16px 0 0;font-size:11px;letter-spacing:.25em;color:#ffffffcc}
.shake{animation:shake .4s}
@keyframes shake{20%,60%{translate:-7px}40%,80%{translate:7px}}
#ok.gone{animation:gone .65s forwards}
@keyframes gone{0%,30%,60%{opacity:1}15%,45%{opacity:.15}75%{opacity:1;filter:brightness(2.5)}100%{opacity:0;filter:brightness(3) blur(10px)}}
body.ls::after{content:'';position:fixed;inset:0;background:radial-gradient(circle,#ff2a2a55,#ff2a2a22 70%);opacity:0;pointer-events:none}
body.flash::after{animation:flash .7s ease-out}
@keyframes flash{0%,30%{opacity:1}100%{opacity:0}}
.denied .ttl,.denied #bad,.denied .row span{color:#ff3b3b;text-shadow:0 0 12px #ff3b3b88}
.denied .row{border-color:#ff3b3b}
.fade{transition:opacity .6s}
.hide{opacity:0}
.granted .fade,.granted .row span.fade{opacity:0}
.granted .row{border-color:transparent}
body.auto .ring,body.auto .corner,body.auto #field{display:none}
@media (prefers-reduced-motion:reduce){.ring,.typing::after,.cur{animation:none}}
</style></head><body class="ls auto">
<canvas id="field" class="fade" aria-hidden="true"></canvas><div class="ring fade"></div><div class="ring r2 fade"></div>
<div class="corner fade" data-t="FANTASY // SECURE" style="top:max(16px,env(safe-area-inset-top));left:16px"></div>
<div class="corner fade" id="clock" style="top:max(16px,env(safe-area-inset-top));right:16px"></div>
<div class="corner fade" data-t="AES-256 / LOCKED" style="bottom:max(16px,env(safe-area-inset-bottom));left:16px"></div>
<div class="corner fade" id="sig" style="bottom:max(16px,env(safe-area-inset-bottom));right:16px"></div>
<div class="wrap"><form id="lock" hidden>
<p class="ttl fade" id="ttl"></p><p class="sub fade" id="sub"></p>
<label class="row hide" id="row"><span class="fade">&gt;</span><span class="field" id="fld"><span id="mask"><span class="cur">_</span></span><input id="pw" type="password" autocomplete="current-password" aria-label="Site password"><span id="ok" aria-hidden="true">ACCESS GRANTED</span><span id="beam"></span></span></label>
<button class="go fade hide" id="go">ENTER</button><p id="bad" class="fade" hidden>ACCESS DENIED. TRY AGAIN</p>
</form></div>
<script>
(() => {
  const LOCK = { salt: '${salt.toString('base64')}', iv: '${iv.toString('base64')}', data: '${data}' };
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const $ = id => document.getElementById(id), form = $('lock'), ttl = $('ttl'), pw = $('pw');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, timers = [];
  const wait = ms => new Promise(r => setTimeout(r, still ? 0 : ms));
  let alive = true;
  // types text into el one letter at a time, with an underscore cursor while it types
  async function type(el, text, ms) {
    el.classList.add('typing');
    for (let i = 1; i <= text.length; i++) { el.textContent = text.slice(0, i); await wait(ms); }
    el.classList.remove('typing');
  }
  // text that "decodes" from random characters, left to right (used for ACCESS DENIED)
  const scramble = (text, ms) => new Promise(done => {
    const chars = 'ABCDEF0123456789#%&*+=<>', t0 = performance.now();
    const step = now => {
      const k = still ? 1 : Math.min(1, (now - t0) / ms), n = Math.floor(k * text.length);
      ttl.textContent = text.slice(0, n) + [...text.slice(n)].map(c => (c === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)])).join('');
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  // dot grid with slow rings of light rolling out from the middle
  function field() {
    const cv = $('field'), cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    size(); addEventListener('resize', size);
    let last = 0;
    const draw = now => {
      if (!alive) return;
      if (now - last > 33) {
        last = now;
        const w = cv.width, h = cv.height, gap = 26 * dpr, t = now / 1000;
        cx.clearRect(0, 0, w, h);
        for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) {
          const wave = Math.max(0, Math.sin(Math.hypot(x - w / 2, y - h / 2) / dpr / 70 - t * 0.8));
          cx.fillStyle = 'rgba(255,255,255,' + (0.07 + 0.45 * wave ** 14) + ')';
          cx.fillRect(x, y, 1.5 * dpr, 1.5 * dpr);
        }
      }
      if (!still) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
  // stars for what's typed, then the blinking underscore
  const showMask = () => { $('mask').innerHTML = '*'.repeat(pw.value.length) + '<span class="cur">_</span>'; };
  pw.addEventListener('input', () => { showMask(); form.classList.remove('denied'); });
  async function start() {
    document.body.classList.remove('auto');
    form.hidden = false;
    field();
    const tick = () => { $('clock').textContent = new Date().toLocaleTimeString('en-GB'); };
    const sig = () => { $('sig').textContent = 'SIG ' + crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8, '0'); };
    tick(); sig(); timers.push(setInterval(tick, 1000), setInterval(sig, 2600));
    document.querySelectorAll('[data-t]').forEach(el => type(el, el.dataset.t, 25));
    pw.focus();
    await type(ttl, 'ACCESS RESTRICTED', 55);
    await wait(150);
    await type($('sub'), 'enter password', 40);
    $('row').classList.remove('hide');
    await wait(200);
    $('go').classList.remove('hide');
  }
  // everything fades but the stars; a line sweeps right to left and leaves ACCESS GRANTED behind it
  async function granted() {
    pw.blur(); $('mask').querySelector('.cur')?.remove();
    form.classList.add('granted');
    document.querySelectorAll('body > .fade').forEach(el => el.classList.add('hide'));
    await wait(700);
    const mask = $('mask'), ok = $('ok'), beam = $('beam');
    const w = Math.max(mask.offsetWidth, ok.offsetWidth);
    beam.style.opacity = 1;
    await new Promise(done => {
      const t0 = performance.now(), ms = still ? 0 : 750;
      const step = now => {
        const k = ms ? Math.min(1, (now - t0) / ms) : 1, x = w * (1 - k * k * (3 - 2 * k));
        mask.style.clipPath = 'inset(0 ' + (w - x) + 'px 0 0)';
        ok.style.clipPath = 'inset(0 0 0 ' + x + 'px)';
        beam.style.left = x + 'px';
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    beam.style.transition = 'opacity .4s'; beam.style.opacity = 0;
    await wait(350);
    // ACCESS GRANTED glides to the middle of the screen, blinks, and burns out
    mask.style.opacity = 0;
    const r = ok.getBoundingClientRect();
    ok.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)';
    ok.style.transform = 'translate(' + (innerWidth / 2 - r.left - r.width / 2) + 'px,' + (innerHeight / 2 - r.top - r.height / 2) + 'px) scale(1.3)';
    await wait(800);
    ok.classList.add('gone');
    await wait(700);
  }
  // The phone keeps the derived key, not the password (the salt is the same every build, so the key is too)
  async function keyOf(pass) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(LOCK.salt), iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function unlock(key, show) {
    let page = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(LOCK.iv) }, key, bytes(LOCK.data)));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    try { localStorage.setItem('siteKey', btoa(String.fromCharCode(...raw))); localStorage.removeItem('sitePw'); } catch {}
    // the trade password locked at sign out: unlock it with the same key
    try {
      const box = localStorage.getItem('moveLocked');
      if (box) {
        const b = bytes(box);
        localStorage.setItem('moveKey', new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
        localStorage.removeItem('moveLocked');
      }
    } catch {}
    // after the animation, the site fades in from black
    if (show) { await granted(); page = page.replace('</head>', '<style>@keyframes sitein{from{opacity:0}}body{animation:sitein .7s ease-out}</style></head>'); }
    alive = false; timers.forEach(clearInterval);
    // A saved key can decrypt before this lock page finishes loading; document.open() is ignored while the parser is
    // still running, so the site would get mixed into the lock page (black screen). Wait for load first.
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
    document.open(); document.write(page); document.close();
  }
  let savedKey = null, savedPw = null; // sitePw: phones signed in before the key was saved instead
  try { savedKey = localStorage.getItem('siteKey'); savedPw = localStorage.getItem('sitePw'); } catch {}
  const forget = () => { try { localStorage.removeItem('siteKey'); localStorage.removeItem('sitePw'); } catch {} start(); };
  if (savedKey) crypto.subtle.importKey('raw', bytes(savedKey), 'AES-GCM', true, ['decrypt']).then(k => unlock(k)).catch(forget);
  else if (savedPw) keyOf(savedPw).then(k => unlock(k)).catch(forget);
  else start();
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    keyOf(pw.value).then(k => unlock(k, true)).catch(() => {
      $('bad').hidden = false; pw.value = ''; showMask();
      // red flash over the screen; title, prompt and line stay red until you type again
      form.classList.remove('shake'); document.body.classList.remove('flash'); void form.offsetWidth;
      form.classList.add('shake', 'denied'); document.body.classList.add('flash');
      scramble('ACCESS DENIED', 400);
    });
  });
})();
</script></body></html>`;
}
fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'site', 'index.html'), process.env.SITE_PASSWORD ? await lockPage(html, process.env.SITE_PASSWORD) : html);
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
// Small summary for the iPhone Home Screen widget (Scriptable).
fs.writeFileSync(path.join(dir, 'site', WIDGET), JSON.stringify({
  week, me: me.name, opp: opp?.name ?? null, myProj: n(myProj), oppProj: n(oppProj), win: winPct, live: isLive, updated: Date.now(),
  myNow: isLive ? n(mySide.totalPointsLive) : null, oppNow: isLive ? n(oppSide.totalPointsLive) : null,
  todo: todo.map(([lvl, title]) => ({ lvl, title })),
  // my starters' games this week, so while one is on the widget can show the latest play by one of them
  games: starters(me).filter(p => p.pos !== 'D/ST').flatMap(p => { const g = pro.find(t => t.id === p.proTeamId)?.proGamesByScoringPeriod?.[week]?.[0]; return g ? [{ id: p.id, name: p.name, gid: g.id, kick: g.date }] : []; }),
}));
fs.writeFileSync(path.join(dir, 'site', 'manifest.json'), JSON.stringify({
  name: me.name, short_name: 'Fantasy', start_url: '.', display: 'standalone', background_color: '#0b0d10', theme_color: '#0b0d10',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}));
console.log(`Wrote site/index.html for ${me.name}, week ${week}. vs ${opp?.name}: ${n(myProj)}-${n(oppProj)}`);
todo.forEach(([l, t]) => console.log(`[${l}] ${t}`));
if (unlabeled.size) console.log(`::notice::ESPN stats with points but no label: ${[...unlabeled].join(", ")}`);
