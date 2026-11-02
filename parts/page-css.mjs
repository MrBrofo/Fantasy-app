// The page's styles
export const CSS = `
/* Stadium Lime: dark only. Graphite surfaces, one lime accent (matches the ESPN Fantasy icon); green/amber/red mean good/so-so/bad. */
:root{color-scheme:dark;--bg:#0b0d10;--card:#15181d;--fg:#f2f4f7;--muted:#9aa3b2;--line:#232830;--accent:#c6f432;--onaccent:#0b0d10;
--good:#3ddc84;--goodbg:#0f2a1c;--warn:#ffb23f;--warnbg:#2e2310;--bad:#ff5c5c;--badbg:#341616;--chip:#1e2229;--glass:rgba(21,24,29,.72);--glassline:rgba(255,255,255,.08);
--num:'Geist Mono',ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
/* The body scrolls, not the page: iOS 26 moves fixed bars (the tab bar) up and down while the page itself scrolls */
/* overflow-x: the page never slides sideways, even if something inside is too wide */
body{height:100%;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth;scroll-padding-top:calc(env(safe-area-inset-top) + 12px);margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Geist,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
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
.vs [data-tm]{cursor:pointer}.vs .t{font-weight:600;overflow-wrap:anywhere}.vs .p{font:600 18px var(--num);text-align:right}
.bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--chip);overflow:hidden;margin-bottom:6px}.bar i{display:block;height:100%;border-radius:3px}
.verdict{margin-top:8px;font-size:14px}
/* Bottom bar, frosted glass like iOS. Fixed so it's always one tap away. */
nav{position:fixed;left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 80px));bottom:calc(env(safe-area-inset-bottom) + 8px);z-index:10;display:flex;gap:2px;padding:4px;border-radius:24px;background:var(--glass);border:1px solid var(--glassline);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
/* 5 tabs that all fit: icon over label, like a phone app */
nav a{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 0 6px;border-radius:20px;color:var(--muted);text-decoration:none;font-weight:600;font-size:12px;line-height:14px;transition:background .2s,color .2s,transform .1s ease-out}
nav svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
nav{touch-action:none}nav a,#fab{-webkit-touch-callout:none}
nav a.on{color:var(--accent);background:rgba(198,244,50,.1)}
nav a.press{background:rgba(255,255,255,.14);color:var(--fg);transform:scale(1.1)}
nav .dot{position:absolute;top:3px;left:calc(50% + 6px);min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--bad);color:#000;font-weight:700;font-size:11px;line-height:16px;text-align:center}
@media(max-width:680px){nav{left:8px;transform:none;width:calc(100% - 74px)}} /* leaves room for the ESPN button, which otherwise takes taps meant for More */
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
.todo{display:flex;gap:12px;align-items:flex-start;touch-action:pan-y}
#todo,#todo details{position:relative}.card.todo{position:relative;z-index:1}
.todo-back{background:none;border:0;padding:4px 0;color:var(--muted);font:inherit;font-size:14px;text-decoration:underline;cursor:pointer}
.card.todo{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.todo-del{position:absolute;box-sizing:border-box;background:var(--bad);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;opacity:.75;transition:opacity .15s}
.todo-del.go{opacity:1}html.term .todo-del{border-radius:0}
.todo .lvl{flex:none;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:6px;margin-top:2px}
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
.pos{display:inline-block;font-size:12px;font-weight:800;padding:1px 6px;border-radius:5px;color:#fff;margin-right:2px;vertical-align:1px}
.pos-QB{background:#e5484d}.pos-RB{background:#12a150}.pos-WR{background:#3e63dd}.pos-TE{background:#f76b15}.pos-K{background:#8e4ec6}.pos-DST{background:#646f82}
.chip{display:inline-block;margin-top:4px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px}
.chip.bad{background:var(--badbg);color:var(--bad)}.chip.good{background:var(--goodbg);color:var(--good)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.row{display:flex;align-items:center;gap:10px}
.slot{flex:none;width:30px;font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--muted);text-transform:uppercase}
.big{flex:none;text-align:right;max-width:84px}.big b{display:block;font:600 21px/1.1 var(--num);letter-spacing:-.02em}.big small{display:block;font-size:12px;line-height:1.3;color:var(--muted)}
/* lineup slot (QB/RB/FLEX) as a small corner tag instead of its own column: gives the player name ~40px more on a phone */
.card.row{position:relative}.card.row .slot{position:absolute;left:12px;top:10px;width:auto;font-size:9px;line-height:1;padding:3px 5px;border-radius:4px;background:var(--chip)}
.card.row .slot:empty{display:none}.card.row .slot:not(:empty)+.player{padding-top:8px}
@media (max-width:420px){.card.row .pic{width:42px;height:42px}.card.row{gap:8px}}
.big small.up{color:var(--good);font-weight:600}
.big .t-good{color:var(--good)}.big .t-weak{color:var(--warn)}.big small.tw{font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:12px}

.btn{background:var(--accent);color:var(--onaccent);border:0;border-radius:12px;padding:13px 16px;min-height:46px;font:600 15px Geist,system-ui,sans-serif;cursor:pointer;width:100%;margin-top:10px;transition:transform .1s ease-out,filter .1s}
.btn:active{transform:scale(.97);filter:brightness(.9)}
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}.ask{display:grid;gap:2px}#askbtn:disabled{opacity:.45}.askmic{position:absolute;right:2px;bottom:2px;width:34px;height:34px;border:0;padding:0;display:grid;place-items:center;background:none;color:var(--muted);cursor:pointer}.askmic.on{color:#ff3b30;animation:askmic 1.2s ease-in-out infinite}@keyframes askmic{50%{opacity:.4}}.askout{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:15px;line-height:1.5}.askout p{margin:0 0 8px}.askout p:last-child{margin:0}.askout ul{margin:0 0 8px;padding-left:20px}.linkbtn{background:none;border:0;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;padding:10px 0 0;min-height:32px;cursor:pointer;justify-self:center}
.chg{padding:8px 10px;border-radius:10px;margin-bottom:6px;font-size:14px;font-weight:600;background:var(--chip)}
.chg.good{background:var(--goodbg);color:var(--good)}.chg.bad{background:var(--badbg);color:var(--bad)}
.lnk{text-decoration:underline dotted;text-underline-offset:3px;color:var(--fg)}
[data-pid]{cursor:pointer;-webkit-tap-highlight-color:transparent}.more{color:var(--muted);font-weight:400}
#sheet{position:fixed;inset:0;z-index:20}.sheet-bg{position:absolute;inset:0;background:rgba(5,10,25,.55)}
.sheet-card{position:absolute;left:0;right:0;bottom:0;max-width:720px;margin:0 auto;max-height:88vh;max-height:88dvh;background:var(--bg);border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;animation:up .35s cubic-bezier(.32,.72,0,1)}
.sheet-card.closing{animation:down .2s cubic-bezier(.4,0,1,1) forwards}
@keyframes up{from{transform:translateY(100%)}}@keyframes down{to{transform:translateY(100%)}}
.sheet-body{overflow-y:auto;overflow-x:hidden;padding:20px 16px calc(24px + env(safe-area-inset-bottom))}
.sheet-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border-radius:50%;border:0;background:var(--chip);color:var(--fg);font-size:22px;line-height:1;cursor:pointer;z-index:1}
.sheet-x::after{content:'';position:absolute;inset:-5px}/* 44px tap area around the 34px close button */
.sh-top{display:flex;gap:14px;align-items:center;margin-bottom:14px;padding-right:40px}.sh-top .pic{width:64px;height:64px}
.sh-name{font-size:20px;font-weight:800}
.sh-q{border-radius:14px;padding:12px 14px;margin-bottom:10px;background:var(--card);border:1px solid var(--line)}
.sh-q small{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.sh-q b{display:block;font-size:16px;margin:2px 0}.sh-q span{font-size:13px;color:var(--muted)}
.sh-q.yes{border-left:4px solid var(--good)}.sh-q.no{border-left:4px solid var(--bad)}.sh-q.maybe{border-left:4px solid var(--warn)}
.bars{display:flex;gap:8px;align-items:flex-end;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.bars div{flex:1;text-align:center}.bars i{display:block;background:var(--accent);border-radius:4px 4px 0 0;margin:0 auto 4px;width:70%}
.bars b{display:block;font-size:13px}.bars small{font-size:12px;color:var(--muted)}
.lgw{display:block;overflow-x:auto;direction:rtl}.lgw>div{direction:ltr}.lg{display:block;width:100%;height:auto;overflow:visible}.lg path{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.lg .gl{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}.lg stop{stop-color:var(--accent);stop-opacity:.28}.lg stop+stop{stop-opacity:0}
.lg .area{fill:url(#lgfill);stroke:none;animation:lgfade .9s ease-out both}.lg .glow{stroke-width:8;opacity:.18}
.lg .a,.lg .glow{stroke-dasharray:1;animation:lgdraw .9s cubic-bezier(.3,.7,.2,1) both}
.lg path.p{stroke:#dfe4ec;stroke-width:2;stroke-dasharray:5 5;opacity:.75;animation:lgfade .9s ease-out both}
.lg circle{fill:var(--card);stroke:var(--accent);stroke-width:2.5}.lg .up circle{stroke:var(--good)}.lg .dn circle{stroke:var(--bad)}
.lg text{fill:var(--fg);font:700 11px var(--num);text-anchor:middle}.lg .up text{fill:var(--good)}.lg .dn text{fill:var(--bad)}
.lg .dot{animation:lgfade .35s ease-out both}
@keyframes lgdraw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}@keyframes lgfade{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.lg *{animation:none!important}}
.stat .pw{cursor:pointer;border:1px solid var(--accent)}.stat .pw .chev{display:inline-block;color:var(--accent);transition:transform .2s}.stat .pw.on .chev{transform:rotate(90deg)}html.term .stat .pw{border-color:var(--accent)}
nav{view-transition-name:nav}#seg{view-transition-name:seg}#bg-field{view-transition-name:bg}
::view-transition-old(root),::view-transition-new(root){animation-duration:.3s}
::view-transition-old(nav),::view-transition-old(seg),::view-transition-old(bg){display:none}::view-transition-new(nav),::view-transition-new(seg),::view-transition-new(bg){animation:none}
::view-transition-group(nav),::view-transition-group(seg),::view-transition-group(bg){animation:none}
[data-why]{cursor:pointer}.whypop{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px;animation:lgfade .2s ease-out}
.whypop>div{width:100%;max-width:440px;max-height:80vh;max-height:80dvh;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:18px;padding:4px 18px 16px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.wp-name{font-weight:700;font-size:17px;margin-top:14px}.whypop .group{margin-top:6px}html.term .whypop>div{border-radius:0}
.lgx{display:flex;margin-top:4px}.lgx div{flex:1;text-align:center;cursor:pointer}.lgx .on small{color:var(--fg);font-weight:700}
.lg .hit{fill:var(--fg);opacity:0;cursor:pointer}.lg .hit.on{opacity:.06}html.term .lg .hit{rx:0}.lg .dot,.lg path,.lg line{pointer-events:none}.lgwhy{margin:8px 0 0}.lgstat{display:block;margin-top:4px;font-size:12px;opacity:.8}.lgx small{display:block}
.lgk{display:flex;gap:14px;font-size:12px;color:var(--muted);margin:0 0 6px}.lgk i{display:inline-block;width:16px;border-top:2.5px solid var(--accent);vertical-align:middle;margin-right:6px}.lgk i.p{border-top:2px dashed #dfe4ec;opacity:.75}
.news{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;color:var(--fg);text-decoration:none}
.news b{display:block;font-size:14px;font-weight:600}.news .nsnip{display:block;font-size:13px;color:var(--muted);margin:3px 0 2px}.news small{color:var(--muted);font-size:12px}
details.news>summary,details.news[open]>summary{display:block;font-weight:400;margin:0;list-style:none;cursor:pointer}details.news>summary::after{content:none}details.news>summary::-webkit-details-marker{display:none}
.news[open] .nsnip:not(.nfull),.news:not([open]) .nfull{display:none}.nfull{white-space:pre-line}
.wp{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}.wp b{font:600 44px/1 var(--num);letter-spacing:-.04em}
.live{display:inline-block;background:var(--badbg);color:var(--bad);font-size:12px;font-weight:800;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:2px}
.stat{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat div{background:var(--chip);border-radius:12px;padding:10px}.stat b{display:block;font:600 20px var(--num)}.stat small{color:var(--muted);font-size:12px}
.lv{font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase}.lv.hard{background:var(--badbg);color:var(--bad)}.lv.medium{background:var(--warnbg);color:var(--warn)}.lv.easy{background:var(--goodbg);color:var(--good)}
.list .card{margin-bottom:0;border-radius:0;border-bottom:none}.list .card:first-child{border-radius:16px 16px 0 0}.list .card:last-child{border-radius:0 0 16px 16px;border-bottom:1px solid var(--line)}
.list .card:only-child{border-radius:16px}
.group{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 8px}
.swap{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.row{min-width:0}
.arrow{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase}
.arrow::after{content:"";flex:1;height:1px;background:var(--line)}
.gain{display:block;width:fit-content;max-width:100%;box-sizing:border-box;margin-bottom:6px;background:var(--goodbg);color:var(--good);font-weight:800;padding:4px 10px;border-radius:8px;font-size:14px}.gain>span{white-space:nowrap}
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
#todo h2 .dot{display:inline-block;vertical-align:middle;min-width:20px;height:20px;padding:0 6px;margin-left:6px;border-radius:99px;background:var(--bad);color:#000;font-weight:700;font-size:11px;line-height:20px;text-align:center}#todo h2 .dot[hidden]{display:none}.nowpts b{color:var(--accent);font-family:var(--num)}
.tag{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:9px 4px;border-bottom:1px solid var(--line)}
td.num{text-align:right;font-family:var(--num);font-size:13px;color:var(--muted);white-space:nowrap}td.num small{white-space:normal}tr.me td{font-weight:800;color:var(--fg)}
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
.vhead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
[class^=verdict-]{max-width:100%;box-sizing:border-box;font-size:12px;font-weight:800;padding:3px 10px;border-radius:12px}[class^=verdict-]>span{white-space:nowrap}
.verdict-good{background:var(--goodbg);color:var(--good)}.verdict-bad{background:var(--badbg);color:var(--bad)}.verdict-meh{background:var(--chip);color:var(--muted)}

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
table.cmp tr.bh td{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding-bottom:2px}table.cmp td[data-now]{color:var(--muted)}table.cmp td[data-proj]{font-weight:700}
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
.gc-score span{color:var(--muted)}.gc-score .has span::after{content:' \\25CF';color:var(--accent);font-size:12px;vertical-align:middle}.gc-score small{margin-left:auto;color:var(--bad);font-weight:600}
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
html.term #bg-field,html.glass #bg-field{position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:.5}
html.term .bgring{position:fixed;left:50%;top:38%;width:min(140vw,700px);aspect-ratio:1;translate:-50% -50%;border:1px dashed #ffffff1c;border-radius:50%;animation:spin 140s linear infinite;pointer-events:none;z-index:-1}
html.term .bgring.r2{width:min(95vw,460px);border:1px solid #ffffff10;animation-duration:50s;animation-direction:reverse}
html.term .bgring.r2::after{content:'';position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 14px #fff}
html.term header{background:none}
html.term .league{letter-spacing:.12em;text-transform:uppercase;font-size:12px}
html.term h1{text-transform:uppercase;letter-spacing:.1em;font-size:22px;font-weight:700}
html.term h1::after{content:'_';animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
html.term .record{letter-spacing:.1em;text-transform:uppercase;font-size:12px}
html.term h2{text-transform:uppercase;letter-spacing:.14em;font-size:15px}
html.term section>h2::before,html.term details.fold>summary h2::before{content:'// ';color:var(--muted)}
html.term .group,html.term .match h2,html.term .sh-q small{letter-spacing:.2em;font-size:12px}
html.term .sub,html.term .why,html.term .tag,html.term .meta{font-size:12.5px}
/* square edges everywhere */
html.term .card,html.term .match,html.term details.fold,html.term .seg,html.term .seg button,html.term .btn,html.term .chip,html.term .lvl,html.term .lv,html.term .pos,html.term .gain,html.term .live,html.term .stat div,html.term .sh-q,html.term .bars,html.term .news,html.term .sel,html.term .cmp-slot,html.term .pitch,html.term .chg,html.term .worder span,html.term [class^=verdict-],html.term #gloss,html.term #refresh,html.term .card.row .slot,html.term .bar,html.term .bar i{border-radius:0!important}
html.term .list .card:first-child,html.term .list .card:last-child,html.term .list .card:only-child{border-radius:0}
html.term .card,html.term .match,html.term details.fold,html.term .news,html.term .sh-q{background:var(--card);border-color:var(--line)}
html.term .match{border-color:#ffffff59;box-shadow:none;position:relative}
html.term .wp b{text-shadow:0 0 18px currentColor}
html.term .bar{height:2px}html.term .bar i{box-shadow:0 0 8px currentColor}
/* tags: outlined, like the ACCESS GRANTED stamp */
html.term .chip,html.term .lvl,html.term .lv,html.term .live,html.term [class^=verdict-],html.term .gain{background:transparent!important;border:1px solid currentColor;letter-spacing:.12em;text-transform:uppercase;font-size:12px}
html.term .live{animation:blink 1.4s steps(1) infinite}
html.term .pos{border-radius:0}
/* things that were boxes by their gray fill get an outline, so they still read as boxes on black */
html.term .stat div,html.term .worder span,html.term .pitch,html.term .chg,html.term .card.row .slot,html.term .sh-q,html.term .bars,html.term .tools2 .btn,html.term #cmp-out table,html.term .sel{border:1px solid var(--line)}
html.term .worder span.me{border-color:var(--accent)}html.term .chg.good{border-color:var(--good)}html.term .chg.bad{border-color:var(--bad)}
/* buttons: white outline, flips to white when pressed */
html.term .btn{background:transparent;color:#fff;border:1px solid #fff;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
html.term .btn:active,html.term .btn:hover{background:#fff;color:#000;filter:none}
html.term .btn[disabled]{opacity:.5}
html.term .tools2 .btn{background:transparent;color:#fff}
html.term #refresh{background:transparent;border-color:#ffffff59;text-transform:uppercase;letter-spacing:.12em;font-size:12px}
/* bottom bar: black glass strip, glowing tab */
html.term nav{border-radius:0;background:var(--glass);border-color:var(--glassline)}
html.term nav a{border-radius:0;letter-spacing:.12em;text-transform:uppercase;font-size:9.5px}
html.term nav a.on{color:#fff;background:#ffffff12;text-shadow:0 0 10px #fff}
html.term nav a.on svg{filter:drop-shadow(0 0 5px #fff)}
html.term nav a.press{background:#ffffff26}
html.term nav .dot,html.term #todo h2 .dot{border-radius:0;background:var(--bad);box-shadow:0 0 10px var(--bad)}
html.term .seg button{text-transform:uppercase;letter-spacing:.08em;font-size:12px}/* .08em: 5 buttons on More still fit a phone */
html.term .seg button.on{background:#fff;color:#000}
html.term .gl{text-decoration-color:var(--good)}
html.term #gloss{border-color:var(--good);box-shadow:0 0 24px #39ff8826}
html.term #gloss b{color:var(--good);letter-spacing:.1em;text-transform:uppercase;font-size:12px}
html.term .sheet-card{border-radius:0;border-top:1px solid #ffffff59;background:#000}
html.term .sheet-x{border-radius:0}
html.term .pic{border:1px solid var(--line)}

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
html.glass .card,html.glass .match,html.glass details.fold,html.glass .news,html.glass .sh-q{background:var(--card);border:0;box-shadow:none}
html.glass .card,html.glass details.fold,html.glass .match{border-radius:26px}html.glass .sh-q,html.glass .news{border-radius:20px}
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
html.glass .blob::after{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:2px;pointer-events:none;mix-blend-mode:screen;
background:conic-gradient(from var(--spin),rgba(255,140,0,0),rgba(255,140,0,.75) 12%,rgba(255,0,170,.6) 22%,rgba(90,60,255,.7) 32%,rgba(0,190,255,.6) 42%,rgba(0,190,255,0) 55% 62%,rgba(0,190,255,.45) 72%,rgba(255,0,170,.4) 84%,rgba(255,140,0,.5) 94%,rgba(255,140,0,0));
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
html.glass .blob.held{scale:1.12;background:rgba(255,255,255,.16)}
html.glass .blob{z-index:1}html.glass .blob.drag{will-change:transform;transition:scale .3s cubic-bezier(.3,1.6,.5,1),background .2s}html.glass :is(nav a,.seg button){z-index:2}
html.glass .sheet-x{background:rgba(255,255,255,.06)}
/* buttons and switches inside the page sit on solid cards, so they're flat iOS controls, not glass */
html.glass .btn{border-radius:999px;color:#fff;background:#0071e3;box-shadow:none}
html.glass .tools2 .btn,html.glass #refresh{background:rgba(118,118,128,.24);color:var(--fg);border:0}
html.glass .btn:active,html.glass #refresh:active{transform:scale(.97);filter:brightness(1.1)}
html.glass .seg{position:relative;border-radius:999px;background:rgba(20,20,22,.22);touch-action:none}html.glass .seg button{position:relative;border-radius:999px}html.glass .seg button.on{color:#fff}
/* the player sheet floats in from the edges like an iOS 26 sheet, darker glass so its text stays easy to read */
html.glass .sheet-bg{background:rgba(0,0,0,.4)}
html.glass .sheet-card{left:8px;right:8px;bottom:8px;border-radius:34px;background:rgba(28,28,30,.55);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%)}
/* top edge: the page fades and softens as it scrolls under the status bar, instead of a hard bar */
html.glass body::before{height:calc(env(safe-area-inset-top) + 28px);background:linear-gradient(rgba(0,0,0,.8),transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);-webkit-mask-image:linear-gradient(#000 40%,transparent);mask-image:linear-gradient(#000 40%,transparent)}
/* behind the page: a soft stadium light; the yard lines, hash marks and plays are drawn on the chalkboard canvas, so the
   glass can bend them */
html.glass::before{content:'';position:fixed;left:0;right:0;top:-80px;bottom:0;z-index:-1;pointer-events:none;
background:radial-gradient(90% 55% at 50% 0%,rgba(255,255,255,.09),transparent 70%);
-webkit-mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent);mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent)}
/* glow, like Terminal: the picked tab, its bubble, win chances, the bars, coloured numbers and chips, and the main button */
html.glass nav a.on{text-shadow:0 0 10px rgba(10,132,255,.8)}html.glass nav a.on svg{filter:drop-shadow(0 0 6px rgba(10,132,255,.9))}
html.glass .blob{box-shadow:0 0 18px rgba(10,132,255,.22)}
html.glass .wp b,html.glass .big b[class^=t-],html.glass .tw,html.glass .stat b[style*=color]{text-shadow:0 0 16px currentColor}
html.glass .bar i{box-shadow:0 0 10px currentColor}html.glass .chip{box-shadow:0 0 14px -4px currentColor}
html.glass .btn{box-shadow:0 0 22px rgba(10,132,255,.45)}html.glass .worder span.me{box-shadow:0 0 14px rgba(10,132,255,.5)}
@media (prefers-reduced-transparency:reduce){html.glass :is(nav,.sheet-card){background:#1c1c1e;-webkit-backdrop-filter:none;backdrop-filter:none}}
/* parts of the page only PC arranges: on a phone they don't exist as boxes */
nav a.sub{display:none}.m1,.m2,.m3,#hs{display:contents}
/* PC layout. The width is also in tools-js.mjs (sidebar). */
@media (min-width:1000px){
body{padding-left:216px;font-size:14px}
.wrap{max-width:1400px;padding:0 32px 40px}
/* one-line header */
header,body:not(.home) header{padding:20px 0 16px;background:none}
header .wrap{display:grid;grid-template-columns:1fr auto auto;column-gap:16px;align-items:center}
.top{display:contents}
h1{grid-area:1/1;margin:0;font-size:24px}
.record{grid-area:2/1}
.league{grid-area:1/2/3/3}
#refresh{grid-area:1/3/3/4}
/* sidebar with every page in it */
nav,html.term nav,html.glass nav{left:0;top:0;bottom:0;width:216px;transform:none;flex-direction:column;gap:2px;padding:calc(env(safe-area-inset-top) + 18px) 12px 68px;overflow-y:auto;border-radius:0;border-width:0 1px 0 0;box-shadow:none}
nav::before{content:'Gameday';padding:0 12px 14px;color:var(--fg);font-size:18px;font-weight:700;letter-spacing:-.02em}
nav svg{display:none}
nav a,html.term nav a{flex:none;flex-direction:row;gap:12px;padding:8px 12px;font-size:14px;line-height:20px}
html.term nav a{font-size:12px}
nav a.sub{display:flex}
nav a.grp,html.term nav a.grp{pointer-events:none;margin-top:14px;padding:4px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
nav .dot{position:static;margin:2px 0 0 auto}
#seg{display:none}
/* the ESPN button sits in the sidebar instead of floating over the page */
#fab{left:12px!important;right:auto!important;top:auto!important;bottom:16px!important;width:192px;height:38px;display:flex;align-items:center;gap:10px;padding:0 8px;border-radius:10px;background:var(--chip);color:var(--fg);box-shadow:none;text-decoration:none;font-size:13px;font-weight:600;opacity:1!important;transform:none!important}
#fab img{flex:none;width:24px;height:24px;border-radius:6px}
#fab::after{content:'Open ESPN'}
html.term #fab,html.term #fab img{border-radius:0}
/* buttons sized for a mouse, not a thumb */
.btn{width:auto;min-height:0;padding:9px 18px;font-size:14px}
.tools2 .btn{width:100%}
/* page grid */
[role=main]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px;align-items:start}
[role=main]>*{grid-column:1/-1}
/* Home: matchup across the top, to-do on the left, the rest on the right */
.match{display:grid;grid-template-columns:auto minmax(0,1.2fr) minmax(0,1fr);gap:8px 36px;align-items:center;margin:0 0 24px;padding:20px 24px}
.match>h2,.match>.board{grid-column:1/-1}
.m1,.m2,.m3{display:block;min-width:0}.m1{min-width:210px}
.wp{flex-direction:column;gap:4px;margin:0}.wp b{font-size:56px}
.verdict{margin-top:0}
body.home #todo{grid-column:1;margin-top:0}
#hs{display:block;grid-column:2}body:not(.home) #hs{display:none}
#hs>section{margin:0 0 24px}
/* Team: starters and bench side by side, each player one line */
#lineup{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto auto auto 1fr;column-gap:28px}
#lineup>h2{grid-column:1/-1}
#lineup>.group{grid-area:2/1}
#lineup>.list{grid-area:3/1/5/2}
#lineup>details{grid-column:2;grid-row:2/4;margin:0 0 10px}
#lineup>details+details{grid-row:4}
.card.row{padding:10px 14px}
.card.row .slot{position:static;flex:none;width:44px;text-align:center}
.card.row .slot:not(:empty)+.player{padding-top:0}
.big{max-width:none;display:flex;flex-direction:row-reverse;align-items:center;gap:12px}
.big b{min-width:48px}
.big small{white-space:nowrap}
.big small:not(.tw){display:none}.big small.up{display:block}
@media (max-width:1279px){.big{flex-direction:column;align-items:flex-end;gap:0}.big b{min-width:0}}
/* lists that become grids of cards */
.pool-list,#bench .list,#news .list,#buysell .list,#pickups details .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:10px;align-items:start}
.pool-list .card{margin:0}.pool-empty{grid-column:1/-1}
#bench .list .card,#news .list .card,#buysell .list .card,#pickups details .list .card{border-radius:16px;border:1px solid var(--line)}
html.glass #bench .list .card,html.glass #news .list .card,html.glass #buysell .list .card,html.glass #pickups details .list .card{border-radius:26px}
html.term #bench .list .card,html.term #news .list .card,html.term #buysell .list .card,html.term #pickups details .list .card{border-radius:0}
/* Trades and Compare */
#compare,#check{grid-column:auto}
/* long pages read in two columns */
#season,#pickups{columns:2;column-gap:28px}
#season>*,#pickups>*{break-inside:avoid}
#season>h2,#pickups>h2,#pickups>h2+.sub{column-span:all}
#help dl{columns:2;column-gap:28px}
#help dd{break-before:avoid}
#look,#alerts,#account{max-width:760px}
/* something answers when the mouse is on it */
@media (hover:hover){
nav a:hover:not(.on){background:rgba(255,255,255,.07);color:var(--fg)}
.card.row:hover,tr[data-team]:hover td{background:rgba(255,255,255,.04)}
.player:hover .name{color:var(--accent)}
details>summary:hover{color:var(--accent)}
.btn:hover,#refresh:hover,#fab:hover{filter:brightness(1.15)}
.seg button:hover:not(.on){color:var(--fg)}
}
.sheet-card,html.term .sheet-card,html.glass .sheet-card{left:auto;right:0;top:0;bottom:0;width:560px;max-width:100%;max-height:none;margin:0;border-radius:0;box-shadow:-10px 0 40px rgba(0,0,0,.3)}
html.term .sheet-card{border-top:0;border-left:1px solid #ffffff59}
html.glass .sheet-card{right:12px;top:12px;bottom:12px;border-radius:28px}
.sheet-card{animation-name:sideIn}.sheet-card.closing{animation-name:sideOut}
@keyframes sideIn{from{transform:translateX(100%)}}@keyframes sideOut{to{transform:translateX(100%)}}
}
`;
