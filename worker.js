// Cloudflare Worker: makes roster moves on my ESPN team when the site asks (POST), and serves live scores (GET).
// Secrets (Cloudflare dashboard > Worker > Settings > Variables and Secrets):
//   ESPN_S2 and SWID (login cookies), LEAGUE_ID, TEAM_ID, SEASON, KEY (the password the site sends for moves),
//   SITE_PASSWORD (the site's password; live scores only answer a page that could unlock the site).
// It only ever touches TEAM_ID, and only these move types, whatever the request says.
const SITE = 'https://mrbrofo.github.io';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'content-type,x-key,x-live', 'Access-Control-Allow-Methods': 'GET,POST' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const ITEM_TYPES = { ROSTER: ['LINEUP', 'DROP'], FREEAGENT: ['ADD', 'DROP'], WAIVER: ['ADD', 'DROP'], TRADE_DECLINE: [], TRADE_ACCEPT: [], TRADE_PROPOSAL: ['GIVE', 'GET'] };
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
let cached = { at: 0, week: 0, body: null }; // one answer shared for 20s, so several open phones don't each hit ESPN

// Live scores for my matchup: each team's points so far, ESPN's live final projection and win chance, every
// rostered player's points so far, injury status and projection, and each NFL game's state and clock (keyed by ESPN pro team id).
async function live(req, env) {
  if (!env.SITE_PASSWORD || req.headers.get('x-live') !== await hex(env.SITE_PASSWORD + ':live')) return reply(401, { error: 'Wrong password' });
  const week = Number(new URL(req.url).searchParams.get('week'));
  if (!Number.isInteger(week) || week < 1 || week > 25) return reply(400, { error: 'Bad week' });
  if (cached.week === week && Date.now() - cached.at < 20000) return reply(200, cached.body);
  const cookie = `espn_s2=${env.ESPN_S2}${env.SWID ? `; SWID=${env.SWID}` : ''}`;
  const [lg, sb] = await Promise.all([
    fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${env.SEASON}/segments/0/leagues/${env.LEAGUE_ID}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${week}`,
      { headers: { cookie, 'x-fantasy-filter': JSON.stringify({ schedule: { filterMatchupPeriodIds: { value: [week] } } }) } }),
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${env.SEASON}`),
  ]);
  if (!lg.ok) return reply(502, { error: `ESPN said ${lg.status}` });
  const team = Number(env.TEAM_ID), g = (await lg.json()).schedule?.find(x => x.matchupPeriodId === week && (x.home?.teamId === team || x.away?.teamId === team));
  const side = s => s && { pts: s.totalPointsLive ?? s.totalPoints ?? 0, proj: s.totalProjectedPointsLive ?? null, win: s.winProbability ?? null };
  const [mine, theirs] = !g ? [] : g.home.teamId === team ? [g.home, g.away] : [g.away, g.home];
  const players = {};
  // players[id] = [points so far, ESPN injury status, ESPN's projection for this week]
  for (const s of [mine, theirs]) for (const e of s?.rosterForCurrentScoringPeriod?.entries ?? []) {
    const p = e.playerPoolEntry?.player, proj = p?.stats?.find(x => x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === week)?.appliedTotal;
    players[e.playerId] = [e.playerPoolEntry?.appliedStatTotal ?? 0, p?.injuryStatus ?? 'ACTIVE', proj ?? null];
  }
  const games = {};
  for (const ev of sb.ok ? (await sb.json()).events ?? [] : []) for (const c of ev.competitions[0].competitors) games[c.team.id] = [ev.status?.type?.state, ev.status?.type?.shortDetail];
  cached = { at: Date.now(), week, body: { at: Date.now(), me: side(mine), opp: side(theirs), players, games } };
  return reply(200, cached.body);
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
