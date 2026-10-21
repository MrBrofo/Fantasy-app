// Cloudflare Worker: makes roster moves on my ESPN team when the site asks.
// Secrets (Cloudflare dashboard > Worker > Settings > Variables and Secrets):
//   ESPN_S2 (login cookie), LEAGUE_ID, TEAM_ID, SEASON, KEY (the password the site sends).
// It only ever touches TEAM_ID, and only these move types, whatever the request says.
const SITE = 'https://mrbrofo.github.io';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'content-type,x-key', 'Access-Control-Allow-Methods': 'POST' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const ITEM_TYPES = { ROSTER: ['LINEUP', 'DROP'], FREEAGENT: ['ADD', 'DROP'], WAIVER: ['ADD', 'DROP'], TRADE_DECLINE: [], TRADE_ACCEPT: [], TRADE_PROPOSAL: ['GIVE', 'GET'] };

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' });
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
