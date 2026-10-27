// Cloudflare Worker: makes roster moves on my ESPN team when the site asks (POST), and serves live scores (GET).
// GitHub puts this file live on every change (.github/workflows/worker.yml); no pasting into the dashboard.
// Secrets (Cloudflare dashboard > Worker > Settings > Variables and Secrets):
//   ESPN_S2 and SWID (login cookies), LEAGUE_ID, TEAM_ID, SEASON, KEY (the password the site sends for moves),
//   SITE_PASSWORD (the site's password; live scores only answer a page that could unlock the site).
// It only ever touches TEAM_ID, and only these move types, whatever the request says.
const SITE = 'https://mrbrofo.github.io';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'content-type,x-key,x-live', 'Access-Control-Allow-Methods': 'GET,POST' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const ITEM_TYPES = { ROSTER: ['LINEUP', 'DROP'], FREEAGENT: ['ADD', 'DROP'], WAIVER: ['ADD', 'DROP'], TRADE_DECLINE: [], TRADE_ACCEPT: [], TRADE_PROPOSAL: ['GIVE', 'GET'] };
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Each part refreshes on its own clock and is shared by every open phone: scores 20s, pickups 30s, trades and
// claims 60s, news 2 min. That keeps it to a few ESPN calls a minute, inside Cloudflare's free limits.
const memo = {}; // key -> { at, val }
async function every(key, ms, fn) {
  const m = memo[key];
  if (m && Date.now() - m.at < ms) return m.val;
  const val = await fn().catch(() => m?.val ?? null); // a failed call keeps the last good answer
  memo[key] = { at: Date.now(), val };
  return val;
}
const names = {}; // player id -> name, kept while the Worker stays warm

// Live data for the site: my matchup (points so far, ESPN's live final guess, win chance), every rostered player's
// points, injury status and projection (every team's, for the team pages), the whole league's scores, my lineup as set on ESPN, the site's suggested
// pickups that someone else just took, my trades and claims, news on players in my matchup, and each NFL game's clock.
async function live(req, env) {
  if (!env.SITE_PASSWORD || req.headers.get('x-live') !== await hex(env.SITE_PASSWORD + ':live')) return reply(401, { error: 'Wrong password' });
  const q = new URL(req.url).searchParams, week = Number(q.get('week'));
  if (!Number.isInteger(week) || week < 1 || week > 25) return reply(400, { error: 'Bad week' });
  const fa = [...new Set((q.get('fa') ?? '').split(',').map(Number).filter(Number.isInteger))].slice(0, 40).sort((a, b) => a - b);
  const team = Number(env.TEAM_ID), cookie = `espn_s2=${env.ESPN_S2}${env.SWID ? `; SWID=${env.SWID}` : ''}`;
  const LG = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${env.SEASON}/segments/0/leagues/${env.LEAGUE_ID}`;
  const espn = async (url, filter) => { const r = await fetch(url, { headers: filter ? { cookie, 'x-fantasy-filter': JSON.stringify(filter) } : { cookie } }); if (!r.ok) throw new Error(`ESPN said ${r.status}`); return r.json(); };
  const lookup = async ids => { // names for players this Worker hasn't seen yet
    const need = ids.filter(id => !names[id]);
    if (need.length) for (const x of (await espn(`${LG}?view=kona_player_info`, { players: { filterIds: { value: need } } })).players ?? []) names[x.player.id] = x.player.fullName;
  };

  const score = await every(`score:${week}`, 20000, async () => {
    const [d, sb] = await Promise.all([
      espn(`${LG}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${week}`, { schedule: { filterMatchupPeriodIds: { value: [week] } } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${env.SEASON}`).then(r => (r.ok ? r.json() : {})),
    ]);
    const games = d.schedule?.filter(x => x.matchupPeriodId === week) ?? [], g = games.find(x => x.home?.teamId === team || x.away?.teamId === team);
    const side = s => s && { pts: s.totalPointsLive ?? s.totalPoints ?? 0, proj: s.totalProjectedPointsLive ?? null, win: s.winProbability ?? null };
    const [mine, theirs] = !g ? [] : g.home.teamId === team ? [g.home, g.away] : [g.away, g.home];
    // players[id] = [points so far, ESPN injury status, ESPN's projection for this week], for every team (team pages);
    // lineup[id] = ESPN lineup slot (mine); match = the players in my matchup (for news)
    const players = {}, lineup = {}, board = {}, match = [];
    for (const s of games.flatMap(x => [x.home, x.away])) for (const e of s?.rosterForCurrentScoringPeriod?.entries ?? []) {
      const p = e.playerPoolEntry?.player, proj = p?.stats?.find(x => x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === week)?.appliedTotal;
      players[e.playerId] = [e.playerPoolEntry?.appliedStatTotal ?? 0, p?.injuryStatus ?? 'ACTIVE', proj ?? null];
      if (p?.fullName) names[e.playerId] = p.fullName;
      if (s === mine) lineup[e.playerId] = e.lineupSlotId;
      if (s === mine || s === theirs) match.push(e.playerId);
    }
    // board[teamId] = [points so far, ESPN's live final guess]
    for (const x of games) for (const s of [x.home, x.away]) if (s) board[s.teamId] = [s.totalPointsLive ?? s.totalPoints ?? 0, s.totalProjectedPointsLive ?? null];
    // clocks[NFL team id] = [pre/in/post, clock text, 1 = has the ball, 2 = has it inside the other team's 20 (red zone),
    // 3 = the other team has it (its defense is on the field), ESPN game id]
    // field[game id] = the Watch view of a game that's on: teams [id, abbreviation, score, color] away then home, down,
    // where the ball is ("DAL 13"), who has it, red zone, where the drive started, the drive so far, the last play, leaders
    const clocks = {}, field = {};
    for (const ev of sb.events ?? []) {
      const c0 = ev.competitions[0], sit = c0.situation;
      for (const c of c0.competitors) clocks[c.team.id] = [ev.status?.type?.state, ev.status?.type?.shortDetail, !sit?.possession ? 0 : sit.possession === c.team.id ? (sit.isRedZone ? 2 : 1) : 3, ev.id];
      if (ev.status?.type?.state !== 'in') continue;
      const tm = ha => { const c = c0.competitors.find(x => x.homeAway === ha); return [c.team.id, c.team.abbreviation, +c.score, c.team.color, c.team.alternateColor]; };
      field[ev.id] = { teams: [tm('away'), tm('home')], down: sit?.shortDownDistanceText ?? '', spot: sit?.possessionText ?? '', poss: sit?.possession ?? '', rz: !!sit?.isRedZone,
        dist: sit?.distance ?? null, from: sit?.lastPlay?.drive?.start?.text ?? '', drive: sit?.lastPlay?.drive?.description ?? '', last: sit?.lastPlay?.text?.trim() ?? '',
        // last play's start and end, yards from the playing team's own goal line
        play: sit?.lastPlay?.start?.yardLine != null && sit?.lastPlay?.end?.yardLine != null ? [sit.lastPlay.start.yardLine, sit.lastPlay.end.yardLine, sit.lastPlay.team?.id ?? '', sit.lastPlay.type?.text ?? '', sit.lastPlay.scoreValue >= 6 || /touchdown/i.test(sit.lastPlay.type?.text ?? '')] : null,
        leaders: (c0.leaders ?? []).map(l => [(l.displayName ?? l.name).replace(/ Leader$/, ''), l.leaders?.[0]?.athlete?.shortName, l.leaders?.[0]?.displayValue]).filter(x => x[1]) };
    }
    return { me: side(mine), opp: side(theirs), players, lineup, board, games: clocks, field, match };
  });
  if (!score) return reply(502, { error: 'ESPN said no' });

  // the site's suggested pickups that are on a team now: taken[id] = team id
  const taken = !fa.length ? {} : await every(`fa:${fa.join(',')}`, 30000, async () => {
    const out = {};
    for (const x of (await espn(`${LG}?view=kona_player_info&scoringPeriodId=${week}`, { players: { filterIds: { value: fa } } })).players ?? []) {
      names[x.player.id] = x.player.fullName;
      if (x.onTeamId > 0) out[x.player.id] = x.onTeamId;
    }
    return out;
  }) ?? {};

  // my trades and claims this week and last (offers to me, accepted or turned down, claims that went through or failed)
  const tx = await every(`tx:${week}`, 60000, async () => {
    const all = [];
    for (const wk of [week - 1, week].filter(w => w >= 1)) all.push(...((await espn(`${LG}?view=mTransactions2&scoringPeriodId=${wk}`)).transactions ?? []));
    const mineTx = [...new Map(all.map(t => [t.id, t])).values()].filter(t => t.teamId === team || (t.items ?? []).some(i => i.toTeamId === team || i.fromTeamId === team))
      .map(t => ({ id: t.id, type: t.type, status: t.status, team: t.teamId, date: t.processDate ?? t.proposedDate ?? 0, items: (t.items ?? []).map(i => [i.playerId, i.type, i.fromTeamId, i.toTeamId]) }))
      .filter(t => Date.now() - t.date < 3 * 864e5);
    await lookup([...new Set(mineTx.flatMap(t => t.items.map(i => i[0])))]);
    return mineTx;
  }) ?? [];

  // news (Rotowire) on everyone in my matchup
  const ids = score.match ?? [];
  const news = !ids.length ? [] : await every(`news:${week}`, 120000, async () => {
    const r = await fetch(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=40&${ids.map(id => `playerId=${id}`).join('&')}`);
    if (!r.ok) throw new Error(`news ${r.status}`);
    return ((await r.json()).feed ?? []).filter(x => x.type === 'Rotowire' && x.playerId && x.headline).map(x => ({ id: x.id, pid: x.playerId, h: x.headline, t: Date.parse(x.published) }));
  }) ?? [];

  const who = [...new Set([...Object.keys(taken), ...tx.flatMap(t => t.items.map(i => i[0])), ...news.map(x => x.pid)])];
  const { match, ...live } = score;
  return reply(200, { at: Date.now(), ...live, taken, tx, news, names: Object.fromEntries(who.filter(id => names[id]).map(id => [id, names[id]])) });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method === 'GET') return live(req, env).catch(err => reply(500, { error: err.message }));
    if (req.method !== 'POST') return reply(405, { error: 'GET or POST only' });
    if (!env.KEY || req.headers.get('x-key') !== env.KEY) return reply(401, { error: 'Wrong password' });
    let m;
    try { m = await req.json(); } catch { return reply(400, { error: 'Bad request' }); }
    const team = Number(env.TEAM_ID), allowed = ITEM_TYPES[m.type];
    if (!allowed || !Array.isArray(m.items) || !Number.isInteger(m.week)) return reply(400, { error: 'Bad move' });
    // accept/decline a trade offer, or cancel a waiver claim: names that transaction and has no players.
    // Every other move needs players.
    const cancel = m.type === 'WAIVER' && m.cancel === true, byId = cancel || m.type === 'TRADE_DECLINE' || m.type === 'TRADE_ACCEPT';
    if (byId ? !/^[0-9a-f-]{36}$/.test(m.related ?? '') || m.items.length : !m.items.length) return reply(400, { error: 'Bad move' });
    // a trade proposal: GIVE = my player to them, GET = their player to me; needs at least one of each
    const other = m.other, propose = m.type === 'TRADE_PROPOSAL';
    if (propose && (!Number.isInteger(other) || other === team || !m.items.some(x => x.type === 'GIVE') || !m.items.some(x => x.type === 'GET'))) return reply(400, { error: 'Bad move' });
    const items = [];
    for (const x of m.items) {
      if (!allowed.includes(x.type) || !Number.isInteger(x.playerId)) return reply(400, { error: 'Bad move' });
      if (x.type === 'LINEUP') items.push({ playerId: x.playerId, type: 'LINEUP', fromLineupSlotId: x.from, toLineupSlotId: x.to });
      if (x.type === 'ADD') items.push({ playerId: x.playerId, type: 'ADD', toTeamId: team });
      if (x.type === 'DROP') items.push({ playerId: x.playerId, type: 'DROP', fromTeamId: team });
      if (x.type === 'GIVE') items.push({ playerId: x.playerId, type: 'TRADE', fromTeamId: team, toTeamId: other });
      if (x.type === 'GET') items.push({ playerId: x.playerId, type: 'TRADE', fromTeamId: other, toTeamId: team });
    }
    const r = await fetch(`https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${env.SEASON}/segments/0/leagues/${env.LEAGUE_ID}/transactions/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `espn_s2=${env.ESPN_S2}` },
      body: JSON.stringify({ isLeagueManager: false, teamId: team, type: m.type, scoringPeriodId: m.week, executionType: cancel ? 'CANCEL' : 'EXECUTE', ...(byId ? { relatedTransactionId: m.related } : { items }), ...(propose ? { expirationDate: new Date(Date.now() + 2 * 864e5).toISOString() } : {}) }),
    });
    const out = await r.json().catch(() => ({}));
    // ESPN says why it refused in details[0].type, e.g. TRAN_LINEUP_LOCKED
    return r.ok ? reply(200, { status: out.status }) : reply(r.status, { error: out.details?.[0]?.type ?? out.messages?.[0] ?? `ESPN said ${r.status}` });
  },
};
