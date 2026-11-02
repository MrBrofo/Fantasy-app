// Page code for Compare, the trade checker and Add buttons (joined into the page by fantasy.mjs)
export const TOOLS_JS = String.raw`// Data for Compare, the trade checker and Add buttons: every rostered player and the free agents
const R = JSON.parse(document.getElementById('rdata').textContent);
const plOf = id => { const a = R.pl[id]; return a && { id: +id, name: a[0], pos: a[1], team: a[2], proj: a[3], rate: a[4], playable: a[5], locked: a[6], slot: a[7], rank: a[8], ceiling: a[9], avg: a[10], bye: a[11], status: a[12], abbr: a[13], next: a[14], fut: a[15], odds: a[16] }; };
const photo = p => p.id < 0 || p.pos === 'D/ST' ? '<span class="pic logo"><img src="https://a.espncdn.com/i/teamlogos/nfl/500/' + e((p.abbr || '').toLowerCase()) + '.png" alt=""></span>' : '<span class="pic" data-i="' + e(p.name.split(' ').map(w => w[0]).join('').slice(0, 2)) + '"><img src="https://a.espncdn.com/i/headshots/nfl/players/full/' + p.id + '.png" alt="" onerror="this.remove()"></span>';
// Compare / Trade buttons on a player page
const toolBtns = p => { const x = plOf(p.id); if (!x) return ''; const onTeam = R.teams.some(t => t.ids.includes(x.id)); return '<div class="tools2"><button type="button" class="btn" data-cmp="' + x.id + '">Compare</button>' + (onTeam ? '<button type="button" class="btn" data-trade="' + x.id + '">Trade check</button>' : '') + '</div>'; };
const rosterOf = teamId => R.teams.find(t => t.id === teamId).ids.map(plOf).filter(Boolean);
// A team's page (tap a team on the league board or in League): who they start, points so far with the game clock
// (live every 30s, same as your players), and what each player is expected to score
function teamPage(tid) {
  const t = R.teams.find(x => x.id === +tid);
  if (!t || !t.start) return '';
  const { start, bench } = t; // rows built on the server, same as My team
  return '<div class="sh-top"><div><div class="sh-name">' + e(t.id === R.me ? 'You' : t.name) + '</div><div class="tag">' + t.rec + ' record</div></div></div>' +
    '<div class="stat"><div><b data-teamnow="' + t.id + '">' + (t.now == null ? '0.0' : t.now.toFixed(1)) + '</b><small>points so far this week</small></div><div><b>' + (t.proj == null ? '-' : t.proj.toFixed(1)) + '</b><small>expected final score</small></div></div>' +
    '<div class="group">Starting</div><div class="list">' + start.join('') + '</div>' +
    (bench.length ? '<details class="fold" style="margin-top:12px"><summary class="group">Bench (' + bench.length + ')</summary><div class="list">' + bench.join('') + '</div></details>' : '');
}
function openTeam(tid) {
  const html = teamPage(tid);
  if (!html) return;
  sheet.dataset.pid = ''; sheet.dataset.team = tid; clearTimeout(closeTimer); closeTimer = null; sheet.querySelector('.sheet-card').classList.remove('closing');
  body.innerHTML = html; sheetShow(); body.scrollTop = 0; document.body.style.overflow = 'hidden';
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
  return '<div class="group" id="addhim">Add him</div><p class="why" style="margin:0 0 4px">' + (p.free.wa ? "On waivers, so it's a claim." : "Free agent: joins right away.") + ' Pick who to drop; best choices first.</p>' +
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
  const box = (p, side) => '<label class="pick"><input type="checkbox" data-side="' + side + '" value="' + p.id + '">' + photo(p) + '<span><b class="lnk" data-pid="' + p.id + '">' + e(p.name) + '</b><br><span class="tag">' + p.pos + ' &middot; ' + p.rate.toFixed(1) + ' per game</span></span></label>';
  // tapping a name opens his card instead of ticking the box (the page's click handler opens it)
  $('check').addEventListener('click', ev => { if (ev.target.closest('.pick [data-pid]')) ev.preventDefault(); });
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
      ['Bad-game score', a.odds?.[0] ?? '-', b.odds?.[0] ?? '-', 1],
      ['Chance of 15+ (%)', a.odds?.[2] ?? '-', b.odds?.[2] ?? '-', 1],
      ['Chance of 20+ (%)', a.odds?.[3] ?? '-', b.odds?.[3] ?? '-', 1],
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
  window.poolDraw = draw; // the page update puts back every card and button as built; this re-picks them
}
// Do now: slide a card left to remove it. Remembered on this phone (by week and title), so a page update doesn't bring it back.
const goneKey = 'todoGone', gone = () => { try { return JSON.parse(localStorage.getItem(goneKey)) || []; } catch { return []; } };
function hideGone() {
  const g = gone(), cards = [...document.querySelectorAll('#todo .card.todo[data-k]')];
  cards.forEach(c => { c.hidden = g.includes(c.dataset.k); });
  // removed by mistake? one tap brings them back
  const n = cards.filter(c => c.hidden).length, b = document.getElementById('todo-back');
  if (b) { b.hidden = !n; b.textContent = 'Show ' + n + ' removed'; }
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('#todo-back')) return;
  const here = [...document.querySelectorAll('#todo .card.todo[data-k]')].map(c => c.dataset.k);
  try { localStorage.setItem(goneKey, JSON.stringify(gone().filter(k => !here.includes(k)))); } catch {}
  hideGone(); showTab(location.hash.slice(1), false);
});
hideGone();
document.addEventListener('pointerdown', ev => {
  const c = ev.target.closest('#todo .card.todo[data-k]');
  if (!c || ev.button) return;
  const x0 = ev.clientX, y0 = ev.clientY;
  let dx = 0, sliding = false, del = null;
  const move = e => {
    dx = Math.min(0, e.clientX - x0);
    if (!sliding && Math.abs(e.clientY - y0) > 10 && Math.abs(e.clientY - y0) > -dx) return end(); // scrolling, not sliding
    if (!sliding && dx > -8) return;
    // a red Delete in the gap the card leaves as it slides (only the gap: Glass cards are see-through)
    if (!sliding) { del = document.createElement('div'); del.className = 'todo-del'; del.textContent = 'Delete';
      Object.assign(del.style, { top: c.offsetTop + 'px', height: c.offsetHeight + 'px', borderRadius: getComputedStyle(c).borderRadius }); c.before(del); }
    Object.assign(del.style, { left: c.offsetLeft + c.offsetWidth + dx + 8 + 'px', width: Math.max(0, -dx - 8) + 'px' });
    del.classList.toggle('go', dx < -c.offsetWidth * 0.35);
    sliding = true; c.style.transition = 'none';
    c.style.transform = 'translateX(' + dx + 'px)';
  };
  const end = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    if (!sliding) return;
    const eat = e => { e.stopPropagation(); e.preventDefault(); }; // the slide isn't a tap
    addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, true), 400);
    c.style.transition = 'transform .25s ease-out, opacity .25s ease-out';
    if (dx < -c.offsetWidth * 0.35) {
      c.style.transform = 'translateX(-110%)'; c.style.opacity = 0;
      try { localStorage.setItem(goneKey, JSON.stringify([...gone(), c.dataset.k].slice(-100))); } catch {}
      setTimeout(() => { c.hidden = true; del.remove(); hideGone(); c.style.transform = c.style.opacity = c.style.transition = ''; showTab(location.hash.slice(1), false); }, 250);
    } else { c.style.transform = ''; c.style.opacity = ''; del.style.transition = 'left .25s ease-out, width .25s ease-out'; Object.assign(del.style, { left: c.offsetLeft + c.offsetWidth + 'px', width: 0 }); setTimeout(() => del.remove(), 250); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
});
// One section at a time: the bottom bar picks which tab shows, like pages in an app
// 5 tabs; Moves, Trades and More each hold a few pages, picked with the switch at the top. Each tab remembers its page.
const navLinks = [...document.querySelectorAll('nav a')];
const GROUPS = { home: ['home'], team: ['team'], moves: ['pickups', 'pending'], trades: ['trades', 'compare'], more: ['season', 'league', 'news', 'help', 'settings'] };
const PAGE_NAME = { pickups: 'Pickups', pending: 'Pending', trades: 'Trade ideas', compare: 'Compare', season: 'Season', league: 'League', news: 'News', help: 'How it works', settings: 'Settings' };
const lastPage = {};
// Switching pages crossfades: the old page fades out while the new one fades in (the browser's view transition,
// iOS 18+; older phones just switch). The tab bar, the switch and the background aren't part of it, so they stay live.
function showTab(tab, jump) {
  if (jump && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => setTab(tab, jump));
  else setTab(tab, jump);
}
function setTab(tab, jump) {
  let g = Object.keys(GROUPS).find(k => GROUPS[k].includes(tab));
  if (!g) { g = GROUPS[tab] ? tab : 'home'; tab = lastPage[g] || GROUPS[g][0]; }
  lastPage[g] = tab;
  if (jump) history.replaceState(null, '', '#' + tab);
  // a section tagged with the tab itself shows on every page of that tab, unless a page has the tab's name
  // (Trades > Trade ideas is 'trades' too: its sections showed under Compare)
  document.querySelectorAll('section[data-tab]').forEach(s => s.classList.toggle('off', s.dataset.tab !== tab && (s.dataset.tab !== g || GROUPS[g].includes(g))));
  document.body.classList.toggle('home', tab === 'home');
  navLinks.forEach(a => { a.classList.toggle('on', a.hash === '#' + g); if (a.hash === '#' + g) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const seg = document.getElementById('seg');
  seg.hidden = GROUPS[g].length < 2;
  if (seg.dataset.g === g) seg.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === tab));
  else seg.dataset.g = g, seg.innerHTML = GROUPS[g].length < 2 ? '' : GROUPS[g].map(p => '<button type="button" data-page="' + p + '"' + (p === tab ? ' class="on"' : '') + '>' + PAGE_NAME[p] + '</button>').join('');
  // red number on Home, and the same number on the to-do list it points to
  const k = document.querySelectorAll('#todo .card.todo:not([hidden])').length;
  for (const dot of document.querySelectorAll('nav .dot, #todo h2 .dot')) { dot.hidden = !k; dot.textContent = k; }
  if (jump) document.body.scrollTo({ top: 0 });
}
// Hold the tab bar and slide your finger like on iPhone: the tab under it lights up, letting go opens it.
// A plain tap works the same way (press and let go on one tab). Keyboard Enter still uses the click.
const tabBar = document.querySelector('nav'), sidebar = matchMedia('(min-width:1000px)'); // same width as the PC layout in page-css.mjs
let held = null;
const press = a => { if (a === held) return; navLinks.forEach(l => l.classList.toggle('press', l === a)); if (held && a) navigator.vibrate?.(8); held = a; };
const tabAt = (x, y) => navLinks.find(l => { const r = l.getBoundingClientRect(); return sidebar.matches ? y >= r.top && y < r.bottom : x >= r.left && x < r.right; });
tabBar.addEventListener('pointerdown', ev => { const a = ev.target.closest('nav a'); if (!a) return; tabBar.setPointerCapture(ev.pointerId); press(a); });
tabBar.addEventListener('pointermove', ev => { if (held) press(tabAt(ev.clientX, ev.clientY) || held); });
tabBar.addEventListener('pointerup', () => { const a = held; press(null); if (a) showTab(a.hash.slice(1), true); });
tabBar.addEventListener('pointercancel', () => press(null));
navLinks.forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); if (!ev.detail) showTab(a.hash.slice(1), true); }));
document.getElementById('seg').addEventListener('click', ev => { const b = ev.target.closest('[data-page]'); if (b) showTab(b.dataset.page, true); });
showTab(location.hash.slice(1), false);
// Glass look: each bar (tab bar, switches) gets one bubble that slides to its picked button, or the tab under your finger.
// Re-placed whenever a class changes anywhere (picked button, look, held tab, page merges) or the screen resizes.
// bars being dragged right now (kept here, not on the element, so a live page update can't drop it mid-drag)
const dragging = new Set();
const placeBlobs = () => { for (const bar of document.querySelectorAll('nav,.seg')) {
  if (dragging.has(bar)) continue; // your finger has it
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
  if (!blob || blob.hidden || !document.documentElement.classList.contains('glass') || (bar === tabBar && sidebar.matches)) return;
  const btns = [...bar.children].filter(x => x !== blob && x.matches('a,button'));
  if (!btns.length) return;
  const x0 = ev.clientX, left = bar.getBoundingClientRect().left, w = (bar.querySelector(':scope > .on') ?? btns[0]).offsetWidth, y = btns[0].offsetTop; // the tab's width: the bubble's own may be mid-animation
  const lo = btns[0].offsetLeft, hi = btns.at(-1).offsetLeft + btns.at(-1).offsetWidth - w;
  const at = x => Math.min(hi, Math.max(lo, x - left - w / 2));
  let moved = false, lastX = x0, frame = 0;
  const paint = () => { frame = 0; const p = at(lastX); blob.style.transform = 'translate(' + p + 'px,' + y + 'px)'; blob.style.setProperty('--spin', Math.round((p + w / 2) / bar.clientWidth * 270 - 135) + 'deg'); };
  const move = e => {
    lastX = e.clientX;
    if (!moved && Math.abs(e.clientX - x0) < 4) return;
    if (!moved) { moved = true; dragging.add(bar); blob.classList.add('held', 'drag'); }
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const end = e => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    cancelAnimationFrame(frame);
    // pick whatever the bubble is over, on the tab bar too (the drag may have started on its edge, not on a tab), and
    // also when the phone cancels the touch partway: it lands where you were instead of snapping back
    if (moved) {
      const c = at(e.type === 'pointerup' ? e.clientX : lastX) + w / 2, pick = btns.find(b => c >= b.offsetLeft && c < b.offsetLeft + b.offsetWidth) ?? btns.reduce((a, b) => Math.abs(b.offsetLeft + b.offsetWidth / 2 - c) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - c) ? b : a);
      if (bar.tagName === 'NAV') showTab(pick.hash.slice(1), true); else if (!pick.classList.contains('on')) pick.click();
      const eat = c => { c.stopPropagation(); c.preventDefault(); };
      addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, true), 500);
    }
    dragging.delete(bar); blob.classList.remove('held', 'drag'); placeBlobs();
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

// Glass background: a coach's chalkboard on the field. Three plays run together (top, middle and bottom of the screen, each
// at a random spot across) so the whole board is busy. Each play: the offense lines up, each receiver's route grows out
// with a glowing runner on its tip, the defenders follow, the QB's pass arcs to one of them (in blue). Then the whole board
// crossfades into the next three, like switching pages. ~30 frames a second, nothing while the app is hidden; with reduce
// motion on, one play stands still.
(() => {
  const cv = document.getElementById('bg-field');
  if (!cv) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, cx = cv.getContext('2d'), dpr = Math.min(1.5, devicePixelRatio || 1);
  // routes for a receiver on the left, in yards from where he lines up (up the screen is upfield); the right side is mirrored
  const ROUTES = [[[0, -16]], [[0, -3], [6, -9]], [[0, -8], [5, -15]], [[0, -7], [-5, -7]], [[0, -9], [1, -7]], [[0, -8], [-5, -14]], [[0, -8], [7, -8]]];
  const WHEEL = [[-3, -1], [-5, -4], [-5, -14]], FLAT = [[-4, -1], [-7, -2]];
  const PLAY = 5.5, ease = x => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3, pick = a => a[Math.floor(Math.random() * a.length)];
  // how far along his route each runner is, s seconds into the play: slowing down but still moving as the play fades out
  const run = s => 1 - (1 - Math.min(1, Math.max(0, (s - 0.5) / 5))) ** 2;
  const LANES = [0.3, 0.6, 0.9]; // where each play's line of scrimmage sits, as a share of the screen's height
  const MIX = 0.8; // seconds the whole board fades out while the next one fades in
  let plays = [], olds = [], last = -99;
  const newPlay = lane => {
    const w = innerWidth, h = innerHeight, u = Math.min(w, 520) / 36, c = 12 * u + Math.random() * Math.max(0, w - 24 * u), y0 = h * (lane + (Math.random() - 0.5) * 0.06);
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
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; plays = []; olds = []; if (still) { last = -99; draw(PLAY * 0.55 * 1000); } };
  const draw = now => {
    if (!still) requestAnimationFrame(draw);
    if (document.hidden || now - last < 33 || dragging.size || !document.documentElement.classList.contains('glass')) return;
    last = now;
    const t = now / 1000;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, innerWidth, innerHeight);
    yardLines();
    LANES.forEach((lane, i) => {
      if (!plays[i] || (!still && t - plays[i].start > PLAY - MIX)) { olds[i] = plays[i]; plays[i] = { ...newPlay(lane), start: still ? t - PLAY * 0.55 : t }; }
      if (olds[i] && t - olds[i].start < PLAY) drawPlay(olds[i], t - olds[i].start);
      drawPlay(plays[i], t - plays[i].start);
    });
    cx.globalAlpha = 1;
    bend();
  };
  // yard lines every 80px and two columns of hash marks, fading out at the sides
  const yardLines = () => {
    const w = innerWidth, h = innerHeight, g = cx.createLinearGradient(0, 0, w, 0);
    for (const [k, a] of [[0, 0], [0.15, 1], [0.85, 1], [1, 0]]) g.addColorStop(k, 'rgba(255,255,255,' + a + ')');
    cx.fillStyle = g;
    cx.globalAlpha = 0.1; for (let y = 79; y < h; y += 80) cx.fillRect(0, y, w, 1);
    cx.globalAlpha = 0.11; for (const x of [0.3 * (w - 10), 0.7 * (w - 10)]) for (let y = 0; y < h; y += 16) cx.fillRect(x, y, 10, 1);
    cx.globalAlpha = 1;
  };
  // The tab bar and switch bars bend the field under them like a drop of water: near the edge each spot shows the field
  // from a little farther out (squeezed in), and red, green and blue bend by different amounts, so lines split into a thin
  // rainbow there. iPhone Safari can't bend what's behind a page element, so the bending is drawn into the field itself.
  const maps = new Map();
  const lensMap = (w, h, r, band, push) => { // in device pixels: each edge pixel, and where its red, green and blue come from
    const key = [w, h, r].join(), hit = maps.get(key);
    if (hit) return hit;
    const m = Math.ceil(push * 1.15) + 1, W = w + 2 * m, idx = [], src = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2, qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy), d = r - out - Math.min(Math.max(qx, qy), 0); // d: how far in from the edge
      if (d < 0 || d >= band) continue;
      let nx = out > 0 ? ox / out : qx > qy ? 1 : 0, ny = out > 0 ? oy / out : qx > qy ? 0 : 1; // outward, away from the middle
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
      const k = (1 - d / band) ** 2 * push;
      idx.push((y + m) * W + x + m);
      for (const c of [1.15, 1, 0.85]) src.push(Math.round(y + m + ny * k * c) * W + Math.round(x + m + nx * k * c));
    }
    const v = { m, idx: Int32Array.from(idx), src: Int32Array.from(src) };
    if (maps.size > 20) maps.clear();
    maps.set(key, v);
    return v;
  };
  const bend = () => {
    for (const el of [...(sidebar.matches ? [] : [document.querySelector('nav')]), ...document.querySelectorAll('.seg')]) {
      const b = el?.getBoundingClientRect();
      if (!b?.width || b.bottom < 0 || b.top > innerHeight) continue;
      const x = Math.round(b.left * dpr), y = Math.round(b.top * dpr), w = Math.round(b.width * dpr), h = Math.round(b.height * dpr);
      const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, b.width / 2, b.height / 2) * dpr;
      const L = lensMap(w, h, Math.round(r), Math.min(16 * dpr, h / 2), 12 * dpr), m = L.m;
      const img = cx.getImageData(x - m, y - m, w + 2 * m, h + 2 * m), s = img.data, o = new Uint8ClampedArray(s);
      for (let i = 0, j = 0; i < L.idx.length; i++, j += 3) {
        const t = L.idx[i] * 4, R = L.src[j] * 4, G = L.src[j + 1] * 4, B = L.src[j + 2] * 4;
        o[t] = s[R]; o[t + 1] = s[G + 1]; o[t + 2] = s[B + 2]; o[t + 3] = Math.max(s[R + 3], s[G + 3], s[B + 3]);
      }
      img.data.set(o); cx.putImageData(img, x - m, y - m);
    }
  };
  const drawPlay = ({ u, runners, line, qb, d, to }, s) => {
    const fade = Math.min(1, s / MIX, (PLAY - s) / MIX), f = run(s);
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
    const b = ease((s - 2.2) / 1.1);
    if (b > 0) {
      const end = along(runners[to], run(2.2 + 1.1))[1], ctl = [(qb[0] + end[0]) / 2, Math.min(qb[1], end[1]) - 5 * u];
      const at = k => [(1 - k) ** 2 * qb[0] + 2 * (1 - k) * k * ctl[0] + k * k * end[0], (1 - k) ** 2 * qb[1] + 2 * (1 - k) * k * ctl[1] + k * k * end[1]];
      cx.setLineDash([3, 6]); cx.strokeStyle = 'rgba(10,132,255,.5)'; cx.beginPath(); cx.moveTo(...qb);
      for (let k = 0.05; k <= b; k += 0.05) cx.lineTo(...at(k));
      cx.stroke(); cx.setLineDash([]);
      const [bx, by] = b < 1 ? at(b) : along(runners[to], f)[1]; cx.fillStyle = '#fff'; cx.shadowColor = '#0a84ff'; cx.shadowBlur = 16;
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
