// The page's main script. fantasy.mjs fills in the two build values.
export const mainJs = (verdictText, VAPID_PUBLIC) => `
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
  ago.textContent = (m < 1 ? 'updated just now' : m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + ' hr ago') + ' \\u00b7 ' + next + (liveAt ? ' \\u00b7 live ' + (Date.now() - liveAt < 5000 ? 'just now' : Math.round((Date.now() - liveAt) / 1000) + 's ago') : liveNote);
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
const KEEP = /^(askbal|askslow|sheet|gloss|fab|changes|lv-tx|tc-|cmp-|tp-|seg|dict|bg-)/;
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
    page = await new Response(new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(m[2]) }, key, b(m[3]))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  const doc = new DOMParser().parseFromString(page, 'text/html');
  morphLib ??= new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/idiomorph@0.7.3/dist/idiomorph.min.js'; s.integrity = 'sha384-JcorokHTL/m+D6ZHe2+yFVQopVwZ+91GxAPDyEZ6/A/OEPGEx1+MeNSe2OGvoRS9'; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = no; document.head.append(s); });
  await morphLib;
  // (the body's HTML, not the body element: given an element, idiomorph nests a second <body> inside this one)
  Idiomorph.morph(document.body, doc.body.innerHTML, { morphStyle: 'innerHTML', callbacks: { beforeNodeMorphed: o => !keep(o), beforeNodeRemoved: o => !keep(o), beforeAttributeUpdated: a => a !== 'open' } }); // a section you opened stays open
  built = +doc.querySelector('meta[name=built]').content;
  const np = JSON.parse(document.getElementById('pdata').textContent);
  for (const k in P) delete P[k];
  Object.assign(P, np);
  if (typeof R === 'object' && document.getElementById('rdata')) { const nr = JSON.parse(document.getElementById('rdata').textContent); for (const k in R) delete R[k]; Object.assign(R, nr); }
  if (typeof hideGone === 'function') hideGone();
  window.poolDraw?.();
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
// after "updated ... ago": how long ago the last live update (every 30s) came in, ticking up, or why live scores are off
let liveOn = false, liveNote = '', liveAt = 0, LD = null; // LD: the last live answer, for the Watch view
// share of his game left from the clock text (same as the build's gameLeft)
const gameLeft = t => !t ? null : /final/i.test(t) ? 0 : /half/i.test(t) ? 0.5 : /OT/.test(t) ? 0
  : (q => q ? Math.max(0, (4 - q) * 15 + +((t.match(/([0-9]+):[0-9]+/) || [])[1] || 0)) / 60 : null)(+((t.match(/([1-4])(st|nd|rd|th)/) || [])[1] || 0));
async function liveTick() {
  if (!LIVE || document.hidden) return;
  try {
    const fa = faIds(), r = await fetch(LIVE.url + '?week=' + LIVE.week + (fa.length ? '&fa=' + fa.join(',') : ''), { headers: { 'x-live': LIVE.token } });
    if (!r.ok) { liveAt = 0; liveNote =' \u00b7 live scores off (' + (r.status === 401 ? 'password mismatch' : 'ESPN login rejected') + ')'; return showAgo(); }
    const d = await r.json(), $ = id => document.getElementById(id), f = v => (Math.round(v * 10) / 10).toFixed(1);
    LD = d; drawGc(); for (const p of Object.values(P)) if (p.pro) { gcG(p); break; } // starts loading last week's games
    liveOn = Object.values(d.games).some(g => g[0] === 'in');
    liveAt = Date.now(); showAgo();
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
    for (const b of document.querySelectorAll('[data-run]')) {
      const x = d.players[b.dataset.run], pts = Array.isArray(x) ? x[0] : x, g = d.games[b.dataset.pro], left = !g || g[0] === 'pre' ? null : g[0] === 'post' ? 0 : gameLeft(g[1]);
      if (left != null) b.textContent = f((pts || 0) + +b.dataset.v * left);
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
      $('lv-verdict').innerHTML = verdictText(x >= y, f(Math.abs(x - y)), done ? 'final' : wp <= 0 || wp >= 100 ? 'decided' : 'guess');
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
// last games as a line chart: what he scored (solid, glowing, shaded under, numbers on the dots: green when he beat his
// projection, red when he fell short) and what he was projected (dashed). The line draws itself in when the sheet opens.
// why he's expected to score what he is: the reasons first; the stat line and where the number comes from fold under More info
const whyBody = p => '<div class="group">Why ' + e(p.proj) + '</div>' +
  (p.projVs ? '<p class="why" style="margin:0 0 6px"><b>' + e(p.projVs) + '</b></p>' : '') +
  (p.experts ? '<p class="why" style="margin:0 0 6px">' + e(p.experts) + '</p>' : '') +
  p.notes.map(t => '<p class="why" style="margin:0 0 6px">' + e(t) + '</p>').join('') +
  (p.projLine?.length || p.sources ? '<details class="plays"><summary><b>More info</b></summary>' +
    (p.projLine?.length ? '<p class="why" style="margin:0">ESPN’s ' + e(p.espnProj) + ' adds up from:</p><ul class="pline">' + p.projLine.map(x => '<li>' + e(x) + '</li>').join('') + '</ul>' : '') +
    (p.sources ? '<p class="why" style="margin:6px 0 0">' + e(p.sources) + '</p>' : '') + '</details>' : '');
// the same, popped up over the page when you tap a player's number on a card; tap outside it to close
function whyPop(id) {
  const p = P[id];
  if (!p || !(p.sources || p.notes.length)) return false;
  const box = document.createElement('div');
  box.className = 'whypop';
  box.innerHTML = '<div role="dialog" aria-modal="true" aria-label="' + e(p.name) + '"><div class="wp-name">' + e(p.name) + '</div>' + whyBody(p) + '</div>';
  box.addEventListener('click', ev => { if (ev.target === box) box.remove(); });
  document.body.append(box);
  return true;
}
let pwOpen = false; // the "Why" under the expected number is open
document.addEventListener('click', ev => {
  const t = ev.target.closest('#sheet [data-projwhy]');
  if (!t) return;
  pwOpen = !pwOpen; t.classList.toggle('on', pwOpen); t.setAttribute('aria-expanded', pwOpen);
  document.getElementById('projwhy').hidden = !pwOpen;
});
let lgWk = null; // the week tapped on the chart; a new sheet starts on the newest
const lgPick = G => { const i = G.findIndex(g => g.wk === lgWk); return i < 0 ? G.length - 1 : i; };
document.addEventListener('click', ev => {
  const t = ev.target.closest('#sheet [data-lgwk]'), G = t && P[sheet.dataset.pid]?.games;
  if (!G) return;
  lgWk = +t.dataset.lgwk;
  sheet.querySelectorAll('[data-lgwk]').forEach(x => x.classList.toggle('on', +x.dataset.lgwk === lgWk));
  sheet.querySelector('.lgwhy').innerHTML = weekText(G[lgPick(G)]);
});
// a week in plain words: how it compared to his projection, where the points came from, why; the stat line last, small
const weekText = g => {
  if (g.note === 'bye' || g.pts == null) return '<b>Week ' + g.wk + '.</b> ' + (g.note === 'bye' ? 'Bye week.' : 'Didn’t play.');
  const d = g.proj == null ? null : g.pts - g.proj;
  const vs = d == null ? '' : Math.abs(d) < 3 ? 'About what he was projected (' + g.proj.toFixed(1) + ').' : Math.abs(d).toFixed(1) + (d > 0 ? ' more' : ' less') + ' than projected (' + g.proj.toFixed(1) + ').';
  // the biggest source of points, from the stat line ("Receiving yards: 84 (+8.4)")
  const top = g.line.map(x => x.match(/^(.*?)(?::[^(]*)? \\(\\+?(-?[\\d.]+)\\)$/)).filter(m => m && +m[2] > 0)[0];
  const from = top && g.pts > 0 ? ' Most came from ' + top[1].toLowerCase() + ' (' + Math.round(+top[2] / g.pts * 100) + '% of his points).' : '';
  return '<b>Week ' + g.wk + ': ' + g.pts.toFixed(1) + ' pts.</b> ' + vs + from + ' ' + e(g.why.filter(t => !t.startsWith('Expected about')).join(' ')) +
    (g.line.length ? '<br><small class="lgstat">' + e(g.line.join(' · ')) + '</small>' : '');
};
function chart(G, sel) {
  const all = G.flatMap(g => [g.pts, g.proj]).filter(v => v != null), lo = Math.min(0, ...all), hi = Math.max(1, ...all);
  const W = Math.max(300, G.length * 62), x = i => (i + 0.5) * W / G.length, y = v => 22 + (hi - v) / (hi - lo || 1) * 74, f = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  // a game with no number (bye, didn't play) is skipped: the line runs on to the next one. Smooth curves through the dots.
  const pts = k => G.flatMap((g, i) => g[k] == null ? [] : [[x(i), y(g[k])]]);
  const smooth = P => P.length ? 'M' + f(P[0]) + P.slice(1).map((p, i) => { const a = P[i - 1] ?? P[i], b = P[i], d = P[i + 2] ?? p;
    return 'C' + f([b[0] + (p[0] - a[0]) / 6, b[1] + (p[1] - a[1]) / 6]) + ' ' + f([p[0] - (d[0] - b[0]) / 6, p[1] - (d[1] - b[1]) / 6]) + ' ' + f(p); }).join('') : '';
  const S = pts('pts'), line = smooth(S), base = y(lo);
  return '<div class="lgk"><span><i></i>Scored</span><span><i class="p"></i>Projected</span></div><div class="bars lgw"><div style="min-width:' + W + 'px"><svg class="lg" viewBox="0 0 ' + W + ' 104">' +
    G.map((g, i) => '<rect class="hit' + (i === sel ? ' on' : '') + '" data-lgwk="' + g.wk + '" x="' + (x(i) - W / G.length / 2).toFixed(1) + '" y="0" width="' + (W / G.length).toFixed(1) + '" height="104" rx="8"/>').join('') +
    '<defs><linearGradient id="lgfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs>' +
    [hi, (hi + lo) / 2, lo].map(v => '<line class="gl" x1="0" x2="' + W + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>').join('') +
    (S.length > 1 ? '<path class="area" d="' + line + 'L' + f([S.at(-1)[0], base]) + 'L' + f([S[0][0], base]) + 'Z"/>' : '') +
    '<path class="p" d="' + smooth(pts('proj')) + '"/><path class="glow" pathLength="1" d="' + line + '"/><path class="a" pathLength="1" d="' + line + '"/>' +
    G.map((g, i) => g.pts == null ? '' : '<g class="dot ' + (g.proj == null ? '' : g.pts >= g.proj ? 'up' : 'dn') + '" style="animation-delay:' + (0.15 + 0.6 * i / G.length).toFixed(2) + 's"><circle cx="' + x(i).toFixed(1) + '" cy="' + y(g.pts).toFixed(1) + '" r="4.5"/><text x="' + x(i).toFixed(1) + '" y="' + (y(g.pts) - 10).toFixed(1) + '">' + g.pts.toFixed(1) + '</text></g>').join('') +
    '</svg><div class="lgx">' + G.map((g, i) => '<div data-lgwk="' + g.wk + '"' + (i === sel ? ' class="on"' : '') + '><small>' + (g.pts == null ? '<b>' + e(g.note) + '</b>' : g.proj == null ? '&nbsp;' : 'proj ' + g.proj.toFixed(1)) + '</small><small>wk ' + g.wk + '</small></div>').join('') + '</div></div></div>';
}
function render(p) {
  // not the sheet itself: it carries data-pid too, and its first photo is whoever was on the page under it
  return '<div class="sh-top">' + (document.querySelector(':not(#sheet)[data-pid="' + p.id + '"] .pic')?.outerHTML ?? '') +
    '<div><div class="sh-name">' + e(p.name) + '</div><div class="meta">' + e(p.posName) + ' &middot; ' + e(p.teamName) + '</div><div class="tag">' + e(p.owner) + '</div></div></div>' +
    '<div class="sh-q ' + p.play[0] + '"' + (p.news.length ? ' data-tonews role="button" tabindex="0" style="cursor:pointer"' : '') + '><small>Will he play this week?</small><b>' + e(p.play[1]) + '</b>' + (p.game ? '<span>' + e(p.game) + '</span>' : '') + '</div>' +
    (p.advice ? '<div class="sh-q ' + p.advice[0] + '"><small>What to do</small><b>' + e(p.advice[1]) + '</b></div>' : '') +
    (g => LD?.field?.[g?.[3]] || g?.[0] === 'post' ? (l => '<button type="button" class="btn" data-watch data-label="' + l + '">' + (gcOpen ? 'Hide the game' : l) + '</button><div id="gc"' + (gcOpen ? '' : ' hidden') + '></div>')(LD.field?.[g[3]] ? 'Watch his game live' : g.last ? 'Watch his plays last week' : 'Watch his plays') : '')(gcG(p)) +
    (p.liveNews?.length ? '<div class="group">Just in</div>' + p.liveNews.map(x => '<p class="why" style="margin:4px 0 0">' + e(x.h) + '</p>').join('') : '') +
    (p.now ? '<div class="group">This week so far</div><p class="why" style="margin:0"><b>' + e(p.now.pts) + ' points</b> &middot; ' + e(p.now.game) + '</p>' +
      (p.now.line.length ? '<ul class="pline">' + p.now.line.map(x => '<li>' + e(x) + '</li>').join('') + '</ul>' : '') +
      (p.now.why?.length ? '<p class="why" style="margin:6px 0 0"><b>Why:</b> ' + e(p.now.why.join(' ')) + '</p>' : '') : '') +
    (p.plays.length ? '<details class="plays"' + (p.plays.length <= 8 ? ' open' : '') + '><summary><b>His plays this game</b> (' + p.plays.length + ', newest first)</summary>' +
      p.plays.map(x => '<p' + (x.td ? ' class="td"' : '') + '><small>' + e(x.when) + '</small> ' + e(x.text) + '</p>').join('') + '</details>' : '') +
    '<div class="stat">' +
      (p.sources || p.notes.length ? '<div class="pw' + (pwOpen ? ' on' : '') + '" data-projwhy role="button" tabindex="0" aria-expanded="' + pwOpen + '"><b>' + e(p.proj) + ' <span class="chev">&rsaquo;</span></b>' : '<div><b>' + e(p.proj) + '</b>') + '<small>expected this week' + (p.ceiling ? ' (up to ' + e(p.ceiling) + ')' : '') + '</small></div>' +
      (p.odds ? '<div><b>' + e(p.odds[0]) + ' to ' + e(p.odds[1]) + '</b><small>bad game to great game</small></div><div><b>' + e(p.odds[2]) + '% / ' + e(p.odds[3]) + '%</b><small>chance of 15+ / 20+</small></div>' : '') +
      '<div><b>' + e(p.avg) + '</b><small>points per game this season</small></div>' +
      '<div><b>' + e(p.rank) + '</b><small>' + e(p.rankWhy || 'rank at his position') + '</small></div>' +
      '<div><b>' + e(p.started) + '</b><small>of ESPN managers start him</small></div></div>' +
    // tap the expected number: where it comes from and what's moving it this week
    (p.sources || p.notes.length ? '<div id="projwhy"' + (pwOpen ? '' : ' hidden') + '>' + whyBody(p) + '</div>' : '') +
    (p.trend ? '<p class="why"><b>' + e(p.trend) + '</b></p>' : '') +
    (p.hit ? '<div class="group">How often he connects</div><p class="why" style="margin:0">' + e(p.hit) + '</p>' : '') +
    (p.rosText ? '<div class="group">Rest of the season</div><p class="why" style="margin:0">' + e(p.rosText) + '</p>' : '') +
    (p.games.length ? (G => '<div class="group">Last games (fantasy points)</div>' + chart(G, lgPick(G)) + '<p class="why lgwhy">' + weekText(G[lgPick(G)]) + '</p>')(p.games) : '') +
    '<div class="group">Bye week</div><p class="why" style="margin:0">' + e(p.byeText) + '</p>' +
    (p.news.length ? '<div class="group">Latest news</div>' + p.news.map(x => x.f ? '<details class="news"><summary><b>' + e(x.h) + '</b>' + (x.s ? '<span class="nsnip">' + e(x.s) + '</span>' : '') + '<span class="nsnip nfull">' + e(x.f) + '</span><small>' + e(x.when) + ' &rsaquo;</small></summary></details>'
      : '<a class="news" href="' + e(x.url) + '" target="_blank" rel="noopener"><b>' + e(x.h) + '</b>' + (x.s ? '<span class="nsnip">' + e(x.s) + '</span>' : '') + '<small>' + e(x.when) + ' &rsaquo;</small></a>').join('') : '') +
    (p.id > 0 ? '<a class="news" href="https://www.espn.com/nfl/player/_/id/' + p.id + '" target="_blank" rel="noopener"><b>Full stats and news on ESPN</b><small>opens ESPN &rsaquo;</small></a>' : '') + toolBtns(p) + addHim(p);
}
// Watch: his game right now, like ESPN's gamecast. Score, down, a field with the drive, the last play,
// the starters from my matchup in that game, and the game's leaders. Redrawn on every live update.
// The live marks drawn over field.webp, a Blender render (1600x490). x is yards from the left end line (0-120),
// z yards from the near sideline (0-53.3). Numbers come from the render's camera: the near sideline is 13.28 px a
// yard wide at y 402.8, the far one 9.11 px a yard at y 102.9; one yard up is 0.868 of a yard across.
// A lateral play, from its text: every spot the ball got to, in yards from the offense's own goal, with what happened
// there, and whether the other team ended up with it. null = not a lateral, or no spots named.
function gcChain(text, code) {
  const t = (text || '').split('PENALTY')[0], stops = [];
  if (!/lateral/i.test(t)) return null;
  for (const m of t.matchAll(/ (?:to|at) (?:([A-Z]+) )?([0-9]+)(?![0-9:])|[Ll]ateral|FUMBLES|fumbles/g)) {
    if (m[2]) stops.push({ y: !m[1] || m[1] === code ? +m[2] : 100 - m[2] });
    else if (stops.length) stops[stops.length - 1].tag = /ateral/.test(m[0]) ? 'LATERAL' : 'FUMBLE';
  }
  const rec = /RECOVERED by ([A-Z]+)-/.exec(t);
  return stops.length ? { stops, lost: !!rec && rec[1] !== code } : null;
}
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
    const chain = /run|pass/.test(kind) && F.play ? gcChain(F.last, F.teams.find(t => t[0] === tid)?.[1]) : null;
    const hold = /fg|miss|block/.test(kind), sx = fx(own(hold ? y0 - 7 : y0));
    // where the play started: a dashed line, next to the blue one where the ball is now
    if (F.play && Math.abs(fx(own(y0)) - fx(ball)) > 0.5) o += line(fx(own(y0)), '#fff').replace('/>', ' stroke-dasharray="14 10" stroke-opacity=".7"/>');
    const post = fx(own(110)), lx = td ? fx(ball) : kind === 'fg' ? post + Math.sign(post - sx) * Math.min(8, 3 + Math.abs(post - sx) * 0.2) : fx(own(kind === 'miss' ? 110 : kind === 'block' ? y0 - 5 : kind === 'inc' ? y0 + (/ deep /.test(F.last) ? 20 : 8) : kind === 'pick' ? pick : chain ? chain.stops[chain.stops.length - 1].y : y1)), dl = Math.abs(lx - sx);
    // across the field: a play starts in the middle and ends on the side the play text names ("pass short left",
    // "right end", "up the middle"), from the offense's view; facing right on screen its left is the far sideline (z up)
    const sd = /(?:short|deep) (left|right)|(left|right) (end|tackle|guard)/.exec(F.last || ''), z0 = 26.65,
      z1 = !sd || !/run|pass|inc|pick/.test(kind) || td ? z0 : z0 + (sd[1] ? 13 : { end: 15, tackle: 9, guard: 5 }[sd[3]]) * ((sd[1] || sd[2]) === 'left' ? 1 : -1) * Math.sign(fx(own(100)) - fx(own(0)));
    // every play throws its own ball, picked from the play itself so a replay flies the same: how high, how much the air
    // slows it (fast off the foot or hand, slower at the end, so it comes down steeper than it went up), how fast it turns
    const rnd = (() => { let h = 2166136261; for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => (h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909), (h >>> 0) / 4294967296); })();
    const kicked = /fg|miss|kick|block/.test(kind), drag = kicked ? 0.8 + rnd() * 0.7 : 0.25 + rnd() * 0.5;
    let H = (kind === 'run' || kind === 'block' ? 0 : /fg|miss|kick/.test(kind) ? Math.min(17.5, 3 + dl * 0.28) : dl >= 5 ? Math.min(7, 1.5 + dl * 0.22) : 0) * (0.8 + rnd() * 0.45);
    // a lateral play follows the text stop by stop: thrown to the first if it's a pass, pitched back to the next one
    // (two yards back and off to the side), a loose ball hops to whoever recovers it, and each carrier runs it flat
    const legs = [];
    if (chain) {
      const fw = Math.sign(fx(own(100)) - fx(own(0))), side = z1 >= z0 ? 5 : -5, X0 = fx(own(chain.stops[0].y)), thrown = / pass /.test(F.last) && Math.abs(X0 - sx) >= 5;
      H = thrown ? Math.min(7, 1.5 + Math.abs(X0 - sx) * 0.22) : 0;
      let z = z1, prev = null;
      const add = (x, zz, lift, tag) => legs.push({ x, z: zz, lift, tag });
      legs.push({ x: sx, z: z0, lift: 0 });
      chain.stops.forEach((st, i) => {
        const x = fx(own(st.y));
        add(x, z, i === 0 ? H : prev === 'FUMBLE' ? 0.8 : 0, st.tag);
        if (st.tag === 'LATERAL') { z += side; add(x - 2 * fw, z, 1.2); }
        prev = st.tag; if (i < chain.stops.length - 1) z += (z1 - z) / (chain.stops.length - 1 - i);
      });
      if (td) add(lx, z1, 0);
    }
    const LEGS = legs.length - 1;
    // height at a share u of the way there: the flight's time at u, then up and down over that time
    const tau = u => -Math.log(1 - u * (1 - Math.exp(-drag))) / drag, up = u => { const tm = tau(u); return H * 4 * tm * (1 - tm); };
    // a good field goal goes through the uprights: over the crossbar (10 feet, 3.3 yards up) with room to spare, under their tops
    if (kind === 'fg') { const tp = tau(Math.abs(post - sx) / dl); H = Math.min(22, (8 + rnd() * 3) / (4 * tp * (1 - tp))); }
    // lost yards, an interception, a missed or blocked kick: red; an incompletion: faint grey
    const bad = !td && ((y1 < y0 && /run|pass/.test(kind)) || /pick|miss|block/.test(kind) || chain?.lost), grey = kind === 'inc';
    const p = pt(F.play ? lx : fx(ball), z1), pb = pt(fx(ball), z1), s = k(z1), X = p[0].toFixed(1);
    // an interception: the defender runs in from a few yards downfield, catches it where it was picked, and carries it back
    // to where the return ended (px: the same sideline distance, so only x moves)
    const run = kind === 'pick' && F.play ? pt(lx + 4 * Math.sign(lx - sx || 1), z1)[0] - p[0] : 0, ret = run && Math.abs(fx(ball) - lx) > 0.5 ? pb[0] - p[0] : 0, pe = ret ? pb : p;
    if (F.play) {
      const path = lift => chain ? Array.from({ length: 20 * LEGS + 1 }, (_, i) => { const u = i / (20 * LEGS), g = Math.min(LEGS - 1, Math.floor(u * LEGS)), v = u * LEGS - g, a = legs[g], c = legs[g + 1];
        return pt(a.x + (c.x - a.x) * v, a.z + (c.z - a.z) * v, lift ? c.lift * 4 * v * (1 - v) : 0); })
        : Array.from({ length: 31 }, (_, i) => { const u = i / 30; return pt(sx + (lx - sx) * u, z0 + (z1 - z0) * u, lift ? up(u) : 0); });
      cam = (pt(sx, 26.65)[0] + p[0]) / 2;
      // a thrown ball spirals, a kicked one tumbles end over end
      gcFly = { b: path(true), g: path(false), x0: pt(sx, 26.65)[0], spin: !H ? '' : chain || /pass|inc|pick/.test(kind) ? 'spiral' : kicked ? 'tumble' : '', drag: H && !chain ? drag : 0, legs: chain ? LEGS : 0, fly: chain ? GC_FLY + (LEGS - 1) * 500 : 0, rate: kicked ? 1.5 + rnd() * 1.2 : 1.8 + rnd() * 1.2, // a spiral stays under 3 turns a second: spin.webp's 16 frames faster than a 60Hz screen would look like it turns backwards
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
      if (chain) legs.forEach((w, i) => { if (!w.tag) return; const q = pt(w.x, w.z), wide = w.tag === 'FUMBLE' ? 84 : 96, y = q[1] + 18 + legs.slice(0, i).filter(x => x.tag).length * 30; o += '<g class="gc-lat" data-u="' + (i / LEGS).toFixed(3) + '"><rect x="' + (q[0] - wide / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + wide + '" height="26" rx="13" fill="' + (w.tag === 'FUMBLE' ? '#dc2626' : '#000') + '" fill-opacity="' + (w.tag === 'FUMBLE' ? 1 : 0.6) + '"/><text x="' + q[0].toFixed(1) + '" y="' + (y + 13).toFixed(1) + '" font-size="13" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="central" letter-spacing="1.5">' + w.tag + '</text></g>'; });
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
  const FLY = F.fly || GC_FLY;
  let conf = null, bits = [], pop = null;
  const step = () => {
    if (!b.isConnected || gcRun !== run) { conf?.remove(); pop?.remove(); b.ownerSVGElement.style.transform = ''; return; }
    const el = Date.now() - gcAt, t = Math.min(1, Math.max(0, (el - GC_LEAD) / FLY)), k = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    // in the air the ball keeps its speed through time, slowed by the air (F.drag); a run slides along easing in and out
    const u = F.legs ? t : F.drag ? (1 - Math.exp(-F.drag * t)) / (1 - Math.exp(-F.drag)) : k;
    const along = (L, w = u) => { const i = Math.min(L.length - 2, Math.floor(w * (L.length - 1))), r = w * (L.length - 1) - i; return [L[i][0] + (L[i + 1][0] - L[i][0]) * r, L[i][1] + (L[i + 1][1] - L[i][1]) * r]; };
    const [x, y] = along(F.b), [gx, gy] = along(F.g), clip = document.querySelector('#gcReveal rect'), trail = fade('gc-trail');
    b.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    // in flight the ball points along its path: a pass spins on its long axis (spin.webp's frames, the laces rolling
    // around), its nose wobbling a little on some throws; a kick turns end over end. Each slows a bit as it flies, at
    // its own rate (F.rate turns a second). Landed, it lies as drawn
    const sp = document.getElementById('gcSpin'), fr = document.getElementById('gcFrame'), fly = t > 0 && t < 1 && (!F.legs || u < 1 / F.legs);
    if (sp && F.spin) {
      const [x2, y2] = along(F.b, Math.min(1, u + 0.02)), dir = x2 < x - 0.01 ? -1 : 1, tilt = Math.atan2(y2 - y, Math.abs(x2 - x) || 1e-3) * 180 / Math.PI;
      const turns = F.rate * t * FLY / 1000 * (1 - 0.2 * t), wob = F.wob * Math.sin(t * FLY / 1000 * F.wf * 2 * Math.PI);
      sp.setAttribute('transform', !fly ? '' : 'translate(0 ' + F.cy.toFixed(2) + ') scale(' + dir + ' 1) rotate(' +
        (F.spin === 'spiral' ? tilt + wob : tilt + F.a0 + turns * 360).toFixed(1) + ') rotate(20) translate(0 ' + (-F.cy).toFixed(2) + ')');
      fr?.setAttribute('viewBox', (!fly ? 0 : F.spin === 'spiral' ? (Math.floor(turns * 16) % 16) * 240 : F.f0 * 240) + ' 0 240 160');
    }
    if (F.legs) document.querySelectorAll('#gc .gc-lat').forEach(g => { g.style.opacity = u + 1e-6 < +g.dataset.u ? 0 : 1; });
    // the shadow stays on the turf right under the ball, smaller and fainter the higher the ball is
    const hi = Math.max(0, gy - y);
    sh.setAttribute('transform', 'translate(' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ') scale(' + Math.max(0.4, 1 - hi / 220).toFixed(2) + ')');
    sh.setAttribute('opacity', Math.max(0.35, 1 - hi / 260).toFixed(2));
    // interception: the defender closes on the ball while it's in the air, then runs it back with the ball in his hands
    if (F.run) {
      const rt = Math.min(1, Math.max(0, (el - GC_LEAD - FLY) / GC_RET)), dx = t < 1 ? F.run * (1 - t) : F.ret * rt * rt * (3 - 2 * rt);
      fade('gc-catch')?.setAttribute('transform', 'translate(' + dx.toFixed(1) + ' 0)');
      if (fade('gc-int')) fade('gc-int').style.opacity = t < 1 ? 0 : Math.min(1, (el - GC_LEAD - FLY) / 250);
      if (t >= 1 && F.ret) { const [ex, ey] = F.b[F.b.length - 1], bx = (ex + dx).toFixed(1); b.setAttribute('transform', 'translate(' + bx + ' ' + ey.toFixed(1) + ')'); sh.setAttribute('transform', 'translate(' + bx + ' ' + ey.toFixed(1) + ')'); sh.setAttribute('opacity', 1); }
    }
    // incomplete: off the turf in two shrinking hops (about a yard and a half, then a third of that), then the label fades in
    if (F.inc) {
      const bt = (el - GC_LEAD - FLY) / 600, [ex, ey] = F.b[F.b.length - 1];
      if (bt > 0 && bt < 1) b.setAttribute('transform', 'translate(' + ex.toFixed(1) + ' ' + (ey - F.inc * 1.3 * Math.abs(Math.sin(bt * 2 * Math.PI)) * (bt < 0.5 ? 1 : 0.35)).toFixed(1) + ')');
      if (fade('gc-inc')) fade('gc-inc').style.opacity = Math.min(1, Math.max(0, bt / 0.4));
    }
    // the trail shows only behind the ball
    if (clip) { clip.setAttribute('x', t < 1 ? Math.min(F.x0, x).toFixed(1) : 0); clip.setAttribute('width', t < 1 ? Math.abs(x - F.x0).toFixed(1) : 1600); }
    if (fade('gc-qb')) fade('gc-qb').style.opacity = Math.min(1, el / GC_LEAD);
    // touchdown: the end zone flashes and settles, the word fades in, confetti bursts out of the end zone and falls
    const tl = (el - GC_LEAD - FLY) / 1000;
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
    if (t < 1 || (F.td && conf !== null) || (F.td && tl < 0) || (F.run && el < GC_LEAD + FLY + GC_RET) || (F.inc && el < GC_LEAD + FLY + 700)) requestAnimationFrame(step);
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
  const a = /^([A-Z]\\.[A-Z][\\w'-]+)/.exec(t)?.[1], latTo = [...t.matchAll(/[Ll]ateral to ([A-Z][.][A-Z][A-Za-z'-]+)/g)].pop()?.[1], recBy = latTo && /RECOVERED by ([A-Z]+)-([A-Z][.][A-Z][A-Za-z'-]+)/.exec(t);
  const b = latTo ? (recBy && recBy[1] === F.teams?.find(x => x[0] === tid)?.[1] ? recBy[2] : latTo) : / pass /.test(t) ? / to ([A-Z]\\.[A-Z][\\w'-]+)/.exec(t)?.[1] : null;
  if (!a || !tid) return [];
  if (b) gcQb[tid] = a;
  const q = !b && /rush/i.test(F.play?.[3] ?? '') ? F.qb || gcQb[tid] : null, kr = /punt|kickoff/i.test(F.play?.[3] ?? '') && /[.] +([A-Z][.][A-Z][A-Za-z'-]+) (?:to|for|pushed|ran) /.exec(t)?.[1];
  // a pick: the defender who caught it stands where he caught it (his team's logo when he isn't on its roster)
  const R = roster(tid), opp = F.teams?.find(x => x[0] !== tid), pk = recBy && recBy[1] === opp?.[1] ? recBy[2] : /interception/i.test(F.play?.[3] ?? '') && /INTERCEPTED by ([A-Z][.][A-Z][A-Za-z'-]+)/.exec(t)?.[1];
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
// ESPN's feed reports these as the last play, but nothing happened on the field
// ESPN's play text uses the league's team codes in places, its own everywhere else
const GC_CODE = { HST: 'HOU', BLT: 'BAL', CLV: 'CLE', WAS: 'WSH', ARZ: 'ARI', LA: 'LAR' }, gcAbbr = s => String(s ?? '').replace(/(^|[^A-Za-z.])(HST|BLT|CLV|WAS|ARZ|LA)(?![A-Za-z])/g, (m, a, c) => a + GC_CODE[c]);
const gcStop = type => /timeout|two-minute|^end (of|period)|coin toss/i.test(type ?? ''), gcReal = {};
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
    // a stoppage: stay on the last real play. A penalty is real, but no ball moved.
    if (gcStop(F.play?.[3])) F = { ...F, ...(gcReal[gid] ?? { play: null, stop: true }) };
    else { if (/^penalty$/i.test(F.play?.[3] ?? '')) F = { ...F, play: null }; gcReal[gid] = { last: F.last, play: F.play }; }
    // right after a kick ESPN names no team with the ball: it's the team that didn't kick
    if (!F.poss && F.play) F = { ...F, poss: /punt|kickoff/i.test(F.play[3]) ? F.teams.find(t => t[0] !== F.play[2])?.[0] : F.play[2] };
    if (gcPts[gid] != null && pts - gcPts[gid] >= 6 && !F.play?.[4]) gcMissedTd(gid, F.last);
    gcPts[gid] = pts;
    if (gcTd && (gcTd.gid !== gid || gcTd.after !== F.last)) gcTd = null;
    if (gcTd?.F) F = { ...F, ...gcTd.F };
  }
  F = { ...F, last: gcAbbr(F.last) };
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
    (F.last ? '<p class="why" style="margin:10px 0 0"><b>' + (past ? e(F.when) : F.stop ? 'Now' : 'Last play') + ':</b> ' + e(F.last) + '</p>' : '') +
    '<div class="group">Your players in this game</div>' + who('me') +
    '<div class="group">Your opponent&rsquo;s players in this game</div>' + who('opp') +
    (F.leaders.length ? '<div class="group">Game leaders</div>' + F.leaders.map(l => '<div class="gc-p"><span>' + e(l[0]) + ': ' + e(l[1]) + '</span><small>' + e(l[2]) + '</small></div>').join('') : '');
  if (html === box.gcHtml) return;
  box.innerHTML = box.gcHtml = html;
  // a new play animates, unless the phone is set to reduce motion and it came in on its own rather than from a tap
  if (Date.now() - gcAt < GC_LEAD + (gcFly?.fly || GC_FLY) + GC_TD && (gcTap || !matchMedia('(prefers-reduced-motion: reduce)').matches)) gcAnimate();
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
let sheetFrom = null;
function sheetShow() { if (sheet.hidden) sheetFrom = document.activeElement; sheet.hidden = false; sheet.querySelector('.sheet-x').focus({ preventScroll: true }); }
function openSheet(id) { const p = P[id]; if (!p) return; gcOpen = false; lgWk = null; pwOpen = false; sheet.dataset.pid = id; delete sheet.dataset.team; clearTimeout(closeTimer); closeTimer = null; sheet.querySelector('.sheet-card').classList.remove('closing'); body.innerHTML = render(p); sheetShow(); body.scrollTop = 0; document.body.style.overflow = 'hidden'; }
__TOOLSJS__
function closeSheet() {
  if (sheet.hidden || closeTimer) return;
  const card = sheet.querySelector('.sheet-card');
  const done = () => { sheet.hidden = true; sheetFrom?.focus?.({ preventScroll: true }); closeTimer = null; document.body.style.overflow = ''; card.style.transform = card.style.transition = ''; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  card.classList.add('closing'); // slides down from wherever a swipe left it
  closeTimer = setTimeout(done, 200);
}
// Swipe down to close: drag from the top of the sheet (no bar shown), or pull down when it's scrolled to the top.
// Let go past a quarter of the way (or flick it) and it closes; otherwise it springs back.
(() => {
  const card = sheet.querySelector('.sheet-card');
  let x0, y0 = null, dy = 0, t0 = 0, drag = false;
  sheet.addEventListener('touchstart', ev => {
    y0 = null;
    if (ev.touches.length > 1 || !ev.target.closest('.sheet-card') || ev.target.closest('input,textarea,select,#gc')) return;
    const top = ev.touches[0].clientY - card.getBoundingClientRect().top < 56;
    if (!top && body.scrollTop > 0) return;
    x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dy = 0; t0 = Date.now(); drag = false;
  }, { passive: true });
  sheet.addEventListener('touchmove', ev => {
    if (y0 == null) return;
    dy = ev.touches[0].clientY - y0;
    if (!drag) {
      if (dy < -6 || Math.abs(ev.touches[0].clientX - x0) > Math.abs(dy) + 6) { y0 = null; return; } // scrolling up or sideways
      if (dy < 8) return;
      drag = true; card.style.transition = 'none';
    }
    ev.preventDefault();
    card.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    if (!drag) return;
    if (dy > card.offsetHeight / 4 || (dy > 40 && dy / (Date.now() - t0) > 0.5)) return closeSheet();
    card.style.transition = 'transform .3s cubic-bezier(.32,.72,0,1)'; card.style.transform = '';
  };
  sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
})();

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
    if (!was) { out.push(['good', now.n + ' joined your team', id]); continue; }
    if (was.s !== now.s) out.push([now.s === 'healthy' ? 'good' : 'bad', now.n + ': ' + was.s + ' → ' + now.s, id]);
    if (was.slot !== now.slot) out.push(['meh', now.n + ': ' + was.slot + ' → ' + now.slot, id]);
    if (Math.abs(was.pr - now.pr) >= 3) out.push([now.pr > was.pr ? 'good' : 'bad', now.n + ': expected points ' + was.pr + ' → ' + now.pr, id]);
  }
  for (const [id, was] of Object.entries(seenSnap)) if (!SNAP[id]) out.push(['meh', was.n + ' left your team']);
  if (out.length) {
    document.getElementById('changelist').innerHTML = out.map(([k, t, id]) => '<div class="chg ' + k + '"' + (P[id] ? ' data-pid="' + id + '" role="button" tabindex="0">' + e(t) + ' <span class="more">&rsaquo;</span>' : '>' + e(t)) + '</div>').join('');
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
  // a team counts as named by its whole name, any word of it with 4+ letters ("Rosalie" in "Rosalie's Rockets"), or its
  // manager's first or last name. ponytail: common words in team names ("team", "the") are skipped by a short list
  const SKIP = ['team', 'the', 'fantasy', 'football', 'league', 'squad', 'club', 'best', 'coaches'];
  const words = t => [...t.name.replace(/'s/gi, '').replace(/[^A-Za-z0-9' ]+/g, ' ').split(' ').filter(w => w.length >= 4), ...(t.mgr || '').split(/ & | /).filter(w => w.length >= 3)].filter(w => !SKIP.includes(w.toLowerCase()));
  const teams = R.teams.filter(t => t.id !== R.me && (has(t.name.replace(/[^A-Za-z0-9' ]+/g, ' ').replace(/ +/g, ' ').trim()) || words(t).some(w => has(w) || has(w + "'s") || has(w + 's')))).slice(0, 3);
  const named = all.filter(p => !mine.has(p.id) && (has(p.name.replace(/[^A-Za-z0-9' ]+/g, ' ')) || (lastOf(p).length >= 4 && lastCount[lastOf(p).toLowerCase()] === 1 && has(lastOf(p))))).slice(0, 12);
  const owner = p => { const t = R.teams.find(t => t.ids.includes(p.id)); return t ? 'on ' + t.name + "'s team" : 'free agent'; };
  const row = p => '- ' + p.name + ' (' + p.pos + ', ' + p.team + ', bye wk ' + (p.bye || '?') + '), ' + owner(p) + ': expected ' + (p.proj || 0).toFixed(1) + ' this week, ' + (p.avg || 0).toFixed(1) + ' per game so far, ' + (p.rate || 0).toFixed(1) + ' per game rest of season, ' + (p.status || 'healthy');
  // String.fromCharCode(10) is a line break (this script sits inside the page's template string, where backslashes get eaten)
  const NL = String.fromCharCode(10);
  return (named.length ? NL + NL + 'Other players I mentioned:' + NL + named.map(row).join(NL) : '') +
    teams.map(t => NL + NL + t.name + (t.mgr ? ' (manager ' + t.mgr + ')' : '') + ' (' + t.rec + ') roster:' + NL + t.ids.map(plOf).filter(Boolean).map(row).join(NL)).join('');
}
// claude.ai opens a new chat with ?q= already typed in the box. Very long text may not fit in a link, so then it opens
// empty and the clipboard copy (always made too) is the fallback
// The full facts are often too long for a link, so the link drops the least needed parts until it fits (news, then
// free agents, schedule, IR, bench), never the question at the end. The clipboard keeps the full text.
function claudeUrl(t) {
  const P = String.fromCharCode(10, 10), drop = ['Roster of ', 'Recent league moves', 'Every result so far', "This week's matchups", 'Recent news', 'No news', 'Best free agents', 'My remaining schedule', 'IR:', 'Bench:', 'Pending moves'];
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
// how much of the text is the same for every question (everything before the players named and the question), so the
// Worker can have Claude keep it cached between questions
const askFixed = () => { const base = JSON.parse(document.getElementById('facts').textContent), cut = base.lastIndexOf('Explain things simply'); return cut > 0 ? base.slice(0, cut).trimEnd().length : 0; };
// the answer as simple HTML: paragraphs, "- " lines as a list, **bold**
const askHtml = t => t.split(String.fromCharCode(10)).map(l => l.trim()).reduce((o, l) => {
  const h = e(l.replace(/^[-*] /, '')).replace(/[*][*](.+?)[*][*]/g, '<b>$1</b>');
  return !l ? o : /^[-*] /.test(l) ? o + '<li>' + h + '</li>' : o + '<p>' + h + '</p>';
}, '').replace(/((?:<li>.*?<[/]li>)+)/g, '<ul>$1</ul>');
// which model answers: Auto lets the Worker pick from the question, Quick is Haiku, Smart is Sonnet (remembered)
const ASK_TIP = { auto: 'Picks for you: Smart for decisions, Quick for meanings and lookups.', quick: 'Haiku: fast and almost free. Good for meanings and lookups, not decisions.', smart: 'Sonnet: best for trades and start/sit.' };
let askMode = 'auto';
try { askMode = ASK_TIP[localStorage.getItem('askMode')] ? localStorage.getItem('askMode') : 'auto'; } catch {}
const askModeShow = () => { document.querySelectorAll('#askmode button').forEach(x => x.classList.toggle('on', x.dataset.mode === askMode)); };
document.getElementById('askmode').onclick = ev => { const x = ev.target.closest('[data-mode]'); if (!x) return; askMode = x.dataset.mode; try { localStorage.setItem('askMode', askMode); } catch {} askModeShow(); };
askModeShow();
// Half price: its own on/off button next to the modes, works with any of them; saved on this phone
const askSlowBox = document.getElementById('askslow');
let askSlowOn = false;
try { askSlowOn = localStorage.getItem('askSlowOn') === '1'; } catch {}
askSlowBox.classList.toggle('on', askSlowOn);
askSlowBox.onclick = () => { askSlowOn = !askSlowOn; askSlowBox.classList.toggle('on', askSlowOn); try { localStorage.setItem('askSlowOn', askSlowOn ? '1' : '0'); } catch {} };
// credits left: the API can't tell the page the balance, so it's typed in once (from console.anthropic.com > Billing)
// and each answer's cost, worked out by the Worker from the tokens it used, comes off it. The Worker keeps the one
// number for every device; this phone keeps a copy to show right away
const money = x => x < 0.995 ? (x * 100).toFixed(x < 0.1 ? 2 : 1) + '¢' : '$' + x.toFixed(2);
const balGet = () => { try { const b = parseFloat(localStorage.getItem('askBal')); return isNaN(b) ? null : b; } catch { return null; } };
const balShow = spent => { const b = balGet(); document.getElementById('askbal').textContent = (b == null ? 'Set credits' : '$' + b.toFixed(2) + ' left') + (spent != null ? ' (−' + money(spent) + ')' : ''); };
const balKeep = b => { try { b == null ? localStorage.removeItem('askBal') : localStorage.setItem('askBal', String(b)); } catch {} };
// ask the Worker (set: a new amount, or null to clear); keeps the copy and shows it
const balSync = (body = {}) => LIVE && fetch(LIVE.url.replace(/[/]$/, '') + '/bal', { method: 'POST', headers: { 'content-type': 'application/json', 'x-live': LIVE.token }, body: JSON.stringify(body) })
  .then(r => r.ok ? r.json() : null).then(d => { if (d && 'bal' in d) { balKeep(d.bal); balShow(); } }).catch(() => {});
document.getElementById('askbal').onclick = () => {
  const v = prompt('How much Anthropic credit is left? (console.anthropic.com, Billing)', balGet()?.toFixed(2) ?? '');
  if (v == null) return;
  const b = parseFloat(v.replace('$', ''));
  balKeep(isNaN(b) ? null : b); balShow();
  balSync({ set: isNaN(b) ? null : b });
};
balShow(); balSync();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') balSync(); });
// Ask: the Worker asks Claude (paid from the Anthropic credits) and the answer shows here. No Worker: open claude.ai
// answers come short; Tell me more asks again for the full version (the league facts are cached by then, so it's mostly
// the longer writing you pay for), with the short answer so it builds on it
let askLast = '', askCtl = null;
const askPaid = (c, bal) => { if (typeof c !== 'number') return; if (bal !== undefined) balKeep(bal); else { const b = balGet(); if (b != null) balKeep(b - c); } balShow(c); };
const askDone = (d, more) => askHtml(d.answer || 'No answer came back.') + (d.cut ? '<p class="tag">The answer was cut off. Ask a narrower question for the rest.</p>' : '') + (more || !d.answer ? '' : '<button type="button" id="askmore" class="linkbtn">Tell me more</button>');
// Slow (half price): the Worker hands back a batch id, saved on this phone and checked every 30 seconds while the app is
// open and again whenever it's opened; the site's update sends a notification when it's in.
// ponytail: one slow question at a time, a new one replaces the one waiting (its notification still comes)
let slowT = 0;
const slowGet = () => { try { return JSON.parse(localStorage.getItem('askSlow') || 'null'); } catch { return null; } };
// tap Cancel while one is waiting: it's dropped (not charged if it hadn't started)
const slowCancel = () => {
  const p = slowGet();
  clearTimeout(slowT);
  try { localStorage.removeItem('askSlow'); } catch {}
  document.getElementById('askout').hidden = true; askReady();
  if (p && LIVE) fetch(LIVE.url.replace(/[/]$/, '') + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-live': LIVE.token }, body: JSON.stringify({ cancel: p.id }) }).catch(() => {});
};
const histGet = () => { try { return JSON.parse(localStorage.getItem('askHist')) || []; } catch { return []; } };
const histShow = () => {
  const h = histGet(), b = document.getElementById('askhist'), box = document.getElementById('askhistout');
  b.hidden = !h.length; b.textContent = box.hidden ? 'Past questions (' + h.length + ')' : 'Hide past questions';
  if (!box.hidden) box.innerHTML = h.map(x => '<details class="plays"><summary><b>' + e(x.q) + '</b> <span class="tag">' + new Date(x.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</span></summary>' + askHtml(x.a) + '</details>').join('');
};
const histAdd = (q, a) => { if (!a) return; try { localStorage.setItem('askHist', JSON.stringify([{ q: q || 'Question', a, t: Date.now() }, ...histGet()].slice(0, 30))); } catch {} histShow(); };
document.getElementById('askhist').onclick = () => { const box = document.getElementById('askhistout'); box.hidden = !box.hidden; histShow(); };
histShow();
const slowCheck = async () => {
  clearTimeout(slowT);
  const p = slowGet();
  const out = document.getElementById('askout');
  if (!p || !LIVE) return;
  out.hidden = false;
  try {
    const r = await fetch(LIVE.url.replace(/[/]$/, '') + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-live': LIVE.token }, body: JSON.stringify({ batch: p.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
    if (d.pending) { out.innerHTML = '<p class="tag">Half-price answer on the way for: ' + e(p.q) + '<br>Usually a few minutes, up to a day. You&#39;ll get a notification, so you can close the app.</p>'; slowT = setTimeout(slowCheck, 30000); askReady(); return; }
    if (slowGet()?.id !== p.id) return; // cancelled or replaced while this check was out
    try { localStorage.removeItem('askSlow'); } catch {}
    askReady();
    askPaid(d.cost, d.bal);
    if (!p.more) askLast = d.answer || '';
    histAdd(p.q + (p.more ? ' (more)' : ''), d.answer);
    out.innerHTML = '<p class="tag">' + e(p.q) + '</p>' + askDone(d, p.more);
  } catch (err) { out.innerHTML = '<p class="tag">Couldn&#39;t check on the half-price answer (' + e(err.message) + '). Trying again in a minute.</p>'; slowT = setTimeout(slowCheck, 60000); }
};
slowCheck();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') slowCheck(); });
const askRun = async more => {
  const b = document.getElementById('askbtn'), out = document.getElementById('askout'), NL = String.fromCharCode(10);
  const facts = askFacts() + (more ? NL + NL + 'You answered: ' + askLast + NL + NL + 'Tell me more: explain that in full detail.' : '');
  if (!LIVE) return document.getElementById('askopen').click();
  askCtl = new AbortController(); b.textContent = 'Cancel'; out.hidden = false;
  if (more) document.getElementById('askmore')?.replaceWith(Object.assign(document.createElement('p'), { className: 'tag', textContent: 'Getting the full answer...' })); else out.innerHTML = '';
  try {
    const r = await fetch(LIVE.url.replace(/[/]$/, '') + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-live': LIVE.token }, body: JSON.stringify({ text: facts, fixed: askFixed(), q: document.getElementById('askq').value.trim(), mode: askMode, slow: askSlowOn }), signal: askCtl.signal });
    const d = await r.json().catch(() => ({}));
    askPaid(d.cost, d.bal);
    if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
    if (d.batch) {
      try { localStorage.setItem('askSlow', JSON.stringify({ id: d.batch, q: document.getElementById('askq').value.trim(), more })); } catch {}
      setTimeout(slowCheck);
    } else {
      if (!more) askLast = d.answer || '';
      histAdd(document.getElementById('askq').value.trim() + (more ? ' (more)' : ''), d.answer);
      out.innerHTML = askDone(d, more);
    }
  } catch (err) {
    if (err.name === 'AbortError') { if (more) out.innerHTML = askHtml(askLast); else out.hidden = true; }
    else out.innerHTML = '<p class="tag">That didn&#39;t work (' + e(err.message) + '). Use Open in Claude below instead.</p>';
  }
  askCtl = null; b.textContent = 'Ask Coach'; askReady();
};
// tap again while it's thinking to cancel; with an empty box there's nothing to ask
// a half-price question waiting counts as busy too
const askReady = () => { const b = document.getElementById('askbtn'), busy = askCtl || slowGet(); b.textContent = busy ? 'Cancel' : 'Ask Coach'; b.disabled = !busy && !document.getElementById('askq').value.trim(); };
document.getElementById('askq').addEventListener('input', askReady); askReady();
document.getElementById('askbtn').onclick = () => askCtl ? askCtl.abort() : slowGet() ? slowCancel() : askRun(false);
document.getElementById('askout').addEventListener('click', ev => { if (ev.target.id === 'askmore') askRun(true); });
// Talk to type: the phone's own speech-to-text fills the box as you talk; tap again to stop. Hidden where the browser
// has none (then the keyboard's mic key does the same)
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = document.getElementById('askmic');
  if (!SR) { mic.hidden = true; return; }
  let rec = null;
  mic.onclick = () => {
    if (rec) return rec.stop();
    const q = document.getElementById('askq'), before = q.value.trim();
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    rec.onresult = ev => { q.value = (before ? before + ' ' : '') + [...ev.results].map(x => x[0].transcript).join('').trim(); askReady(); };
    rec.onend = () => { rec = null; mic.classList.remove('on'); };
    rec.onerror = () => rec?.stop();
    mic.classList.add('on');
    try { rec.start(); } catch { rec = null; mic.classList.remove('on'); }
  };
})();
document.getElementById('askopen').onclick = async () => {
  const facts = askFacts(), b = document.getElementById('askopen');
  try { await navigator.clipboard.writeText(facts); b.textContent = '✓ Opening Claude. If the box is empty, paste'; }
  catch { prompt('Copy this, then paste it into Claude:', facts); }
  window.open(claudeUrl(facts), '_blank', 'noopener');
  setTimeout(() => (b.textContent = 'Or open it in the Claude app'), 4000);
};
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-close]')) return closeSheet();
  // "Will he play?": jump to the news story about his status (practice, injury tag, ruled out...), opened; else the newest
  if (ev.target.closest('[data-tonews]')) {
    const all = [...body.querySelectorAll('.news')], d = all.find(x => /practic|limited|\bDNP\b|questionable|doubtful|ruled out|inactive|game-time|status|injur|expected to play|will play|won't play|\bsit\b|\bout\b/i.test(x.textContent)) ?? all[0];
    if (d) { if (d.tagName === 'DETAILS') d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  // a player's number on a card: why he's expected that, in a pop-up
  const wy = ev.target.closest('[data-why]');
  if (wy && whyPop(wy.dataset.why)) return;
  // a name or bar in this week's matchup: that team's page (yours opens the Team tab)
  const tm = ev.target.closest('[data-tm]');
  if (tm) return +tm.dataset.tm === R.me ? (showTab('team', true), scrollTo(0, 0)) : openTeam(tm.dataset.tm); // yours: the Team tab
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
`;
// end of page script
