// Cloudflare Worker: makes roster moves on my ESPN team when the site asks (POST), and serves live scores (GET).
// GitHub puts this file live on every change (.github/workflows/worker.yml); no pasting into the dashboard.
// Secrets (Cloudflare dashboard > Worker > Settings > Variables and Secrets):
//   ESPN_S2 and SWID (login cookies), LEAGUE_ID, TEAM_ID, SEASON, KEY (the password the site sends for moves),
//   SITE_PASSWORD (the site's password; live scores only answer a page that could unlock the site),
//   ANTHROPIC_API_KEY (Ask Claude; paid per question from the Anthropic Console's credits).
// It only ever touches TEAM_ID, and only these move types, whatever the request says.
import Anthropic from '@anthropic-ai/sdk';

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
      const tm = ha => { const c = c0.competitors.find(x => x.homeAway === ha); return [c.team.id, c.team.abbreviation, +c.score, c.team.color, c.team.alternateColor, c.team.name]; };
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

// Ask Claude: the site's question with my team's facts, answered by Claude. Same password as live scores, so only a
// page that could unlock the site can spend the credits; the question and facts are capped so one ask stays cheap.
// The slow answers finished in the last day, for the site's update to send a notification for each one (once)
async function slow(req, env) {
  if (!env.SITE_PASSWORD || req.headers.get('x-live') !== await hex(env.SITE_PASSWORD + ':live')) return reply(401, { error: 'Wrong password' });
  if (!env.ANTHROPIC_API_KEY) return reply(200, { done: [] });
  const page = await new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages.batches.list({ limit: 20 });
  return reply(200, { done: page.data.filter(b => b.processing_status === 'ended' && Date.now() - Date.parse(b.ended_at) < 864e5).map(b => b.id) });
}

async function ask(req, env) {
  if (!env.SITE_PASSWORD || req.headers.get('x-live') !== await hex(env.SITE_PASSWORD + ':live')) return reply(401, { error: 'Wrong password' });
  if (!env.ANTHROPIC_API_KEY) return reply(500, { error: 'No ANTHROPIC_API_KEY on the Worker' });
  let m;
  try { m = await req.json(); } catch { return reply(400, { error: 'Bad request' }); }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Slow: the page asks again with the batch id until the half-price answer is in (cost is half Sonnet's price)
  if (typeof m.batch === 'string' && /^msgbatch_w+$/.test(m.batch)) {
    const b = await client.messages.batches.retrieve(m.batch);
    if (b.processing_status !== 'ended') return reply(200, { pending: true });
    for await (const x of await client.messages.batches.results(m.batch)) {
      if (x.result.type !== 'succeeded') return reply(200, { answer: "The slow answer didn't come back (" + x.result.type + '). Ask again.' });
      const r = x.result.message, u = r.usage, [i, o, w, rd] = [2, 10, 2.5, 0.2].map(p => p / 2);
      if (r.stop_reason === 'refusal') return reply(200, { answer: 'Claude would not answer that one. Try asking it a different way.' });
      return reply(200, { answer: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n\n').trim(), cut: r.stop_reason === 'max_tokens', model: 'Sonnet', cost: ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_creation_input_tokens ?? 0) * w + (u.cache_read_input_tokens ?? 0) * rd) / 1e6 });
    }
    return reply(200, { answer: 'The slow answer came back empty. Ask again.' });
  }
  if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 250000) return reply(400, { error: 'Bad question' });
  const SYS = 'You help a beginner with their ESPN fantasy football team (half PPR). Use the facts given; if a fact you need is in a drawer, open it with look_up before answering. Say when something is a guess. Keep it short: the answer first, then the main reasons, 6 short lines or bullets at most, plain words, no tables or headings. Give a clear pick when asked to choose. Only when I ask you to tell me more, explain in full detail.';
  // Slow: Sonnet through the Batch API, half price. A batch is one shot, so it can't open drawers: it gets all the facts at
  // once. The answer takes minutes (up to a day); the page checks back with the id, and the site's next update sends a
  // notification when it's in (it reads the finished batches from /slow)
  if (m.mode === 'slow') {
    const b = await client.messages.batches.create({ requests: [{ custom_id: 'ask', params: {
      model: 'claude-sonnet-5-5', max_tokens: 4000, output_config: { effort: 'low' },
      system: SYS.replace('; if a fact you need is in a drawer, open it with look_up before answering', ''),
      messages: [{ role: 'user', content: m.text }],
    } }] });
    return reply(200, { batch: b.id });
  }
  // what this question cost, from the tokens each call used ($ per million: input, output, cache write, cache read), so
  // the page can take it off the credits it shows
  const PRICE = { sonnet: [2, 10, 2.5, 0.2], haiku: [0.1, 0.5, 0.125, 0.01] };
  let cost = 0;
  const bill = (which, u) => { const [i, o, w, rd] = PRICE[which]; cost += ((u?.input_tokens ?? 0) * i + (u?.output_tokens ?? 0) * o + (u?.cache_creation_input_tokens ?? 0) * w + (u?.cache_read_input_tokens ?? 0) * rd) / 1e6; };
  // Quick = Haiku (a tiny fraction of the price, fast), Smart = Sonnet (half Opus's price, and just as good at weighing
  // the facts it's handed). Auto: Haiku reads just the question (a fraction of a cent, about a second) and sends anything
  // that asks me to decide something to Sonnet; only plain lookups and meanings go to Haiku, and anything unclear to Sonnet
  let smart = m.mode !== 'quick';
  if (m.mode === 'auto' && typeof m.q === 'string' && m.q.trim()) {
    const c = await client.messages.create({
      model: 'claude-haiku-5-5', max_tokens: 1000, output_config: { effort: 'low' },
      // the examples are the questions a beginner actually asks; add any that Auto sorts wrong
      system: [
        'Sort a fantasy football question. Reply with one word: EASY or HARD.',
        'HARD: it asks for advice, a choice, a comparison, a prediction, an opinion or a reason why, or it needs several facts weighed together. If unsure, HARD.',
        'EASY: it asks what a word means, how a rule or the app works, or for one fact that can be read off (a score, a date, a status, a name, a number).',
        'HARD examples:',
        '- Lineup: Who should I start at flex? / Should I start him if he is questionable? / Is my lineup set right?',
        '- Comparisons: Who is better this week, Bijan or Saquon? / Which kicker should I keep?',
        '- Pickups and drops: Should I pick up Johnson? / Who should I drop for him? / Is he worth a waiver claim? / Should I cancel my claim?',
        '- Trades: Is this trade fair? / Should I accept this offer? / Who should I trade for? / What should I offer for Bijan?',
        '- Keep or cut: Is Kelce worth keeping? / Should I hold him through his bye? / Is he a sell-high?',
        '- Outlook: Will I make the playoffs? / Will I win this week? / How does my team look for the rest of the season?',
        '- Reasons: Why is he projected so low? / Why did I lose? / Why does the app say to drop him?',
        '- Broad: Thoughts on my team? / What should I do this week? / What is my biggest weakness?',
        'EASY examples:',
        '- Meanings: What does start/sit mean? / What is a bye week? / What is PPR? / What is a handcuff?',
        '- Rules: How do waivers work? / When does my lineup lock? / How many points is a touchdown? / How does IR work?',
        '- Facts: Who is on bye this week? / Is Kelce hurt? / Who am I playing? / What is my record? / How many points did Kelce score? / When does his game start? / Who is the best free agent RB?',
        '- The app: How do I make a trade on here? / What does the red tag mean?',
      ].join('\n'),
      messages: [{ role: 'user', content: m.q.slice(0, 2000) }],
    }).catch(() => null);
    bill('haiku', c?.usage);
    smart = !/EASY/.test(c?.content.filter(b => b.type === 'text').map(b => b.text).join('') ?? '');
  }
  // The big parts of the league facts (each other team's roster, every result, league moves, this week's matchups, free
  // agents) are drawers: Claude gets my team and the standings, plus a list of drawers it can open with look_up, so a
  // question only pays for the parts it needs. The players and teams the question names come along up front anyway
  const fixed = Number.isInteger(m.fixed) && m.fixed > 0 && m.fixed < m.text.length ? m.fixed : 0;
  const DRAWERS = ['Roster of ', 'Every result so far', 'Recent league moves', "This week's matchups", 'Best free agents'];
  const paras = m.text.slice(0, fixed).split('\n\n'), drawers = {}, core = [];
  for (const p of paras) (DRAWERS.some(d => p.startsWith(d)) ? (drawers[p.split('\n')[0].replace(/:$/, '').slice(0, 200)] = p) : core.push(p));
  const names = Object.keys(drawers);
  const tools = names.length ? [{
    name: 'look_up',
    description: 'Open one or more drawers of league facts that are not shown yet. Open every drawer the question needs in one call. Drawers: ' + names.join(' | '),
    input_schema: { type: 'object', properties: { drawers: { type: 'array', items: { type: 'string', enum: names } } }, required: ['drawers'] },
  }] : undefined;
  // my team and the standings are the same for every question until the site rebuilds, so they're cached (cache reads
  // cost a tenth); only the players named and the question after them are new each time
  const msgs = [{ role: 'user', content: fixed
    ? [{ type: 'text', text: core.join('\n\n'), cache_control: { type: 'ephemeral' } }, { type: 'text', text: m.text.slice(fixed) }]
    : m.text }];
  let r;
  // ponytail: 3 rounds of look_up, then it answers with what it has. Low effort: less thinking billed, and the answers are
  // short anyway
  for (let round = 0; ; round++) {
    r = await client.beta.messages.create({
      model: smart ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', max_tokens: 4000, output_config: { effort: 'low' },
      system: SYS,
      ...(tools ? { tools, tool_choice: round < 3 ? { type: 'auto' } : { type: 'none' } } : {}),
      messages: msgs,
    });
    bill(smart ? 'sonnet' : 'haiku', r.usage);
    if (r.stop_reason !== 'tool_use') break;
    msgs.push({ role: 'assistant', content: r.content });
    const res = r.content.filter(b => b.type === 'tool_use').map(b => ({
      type: 'tool_result', tool_use_id: b.id,
      content: (Array.isArray(b.input?.drawers) ? b.input.drawers : []).map(d => drawers[d] ?? `No drawer called "${d}".`).join('\n\n') || 'No drawer named.',
    }));
    // cache up to the drawers just opened, so the next round reads all of it at a tenth of the price instead of paying again
    if (res.length) res[res.length - 1].cache_control = { type: 'ephemeral' };
    msgs.push({ role: 'user', content: res });
  }
  if (r.stop_reason === 'refusal') return reply(200, { answer: 'Claude would not answer that one. Try asking it a different way.', cost });
  return reply(200, { answer: r.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim(), cut: r.stop_reason === 'max_tokens', model: smart ? 'Sonnet' : 'Haiku', cost });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method === 'POST' && new URL(req.url).pathname === '/ask') return ask(req, env).catch(err => reply(500, { error: err.message }));
    if (req.method === 'POST' && new URL(req.url).pathname === '/slow') return slow(req, env).catch(err => reply(500, { error: err.message }));
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
