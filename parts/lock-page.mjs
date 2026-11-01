import crypto from 'crypto';
import zlib from 'zlib';

// Site password (GitHub secret SITE_PASSWORD): the published page is the real page encrypted
// (gzipped, then AES-GCM, key from the password via PBKDF2), plus a small unlock screen. The page is public on
// GitHub, so a plain "enter password" screen would only hide it; encrypted, it can't be read without
// the password. The phone keeps the password, so it's asked once. The head stays readable (no team
// data in it) so the update check can still read the build time.
export async function lockPage(page, password) {
  // fixed salt so the key (which the phone saves) stays the same between builds; the iv is new every build
  const { subtle } = crypto.webcrypto, salt = crypto.createHash('sha256').update('Fantasy-app site lock').digest().subarray(0, 16), iv = crypto.randomBytes(12);
  const base = await subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, key, zlib.gzipSync(page))).toString('base64');
  return page.slice(0, page.indexOf('</head>')) + `<style>
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
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(LOCK.salt), iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function unlock(key, show) {
    let page = await new Response(new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(LOCK.iv) }, key, bytes(LOCK.data))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
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
