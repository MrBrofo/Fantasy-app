// One-time check of what the FantasyPros key unlocks: a few calls, and only what came back (never the key)
// is published as fp-probe.json. Once that file is on the site it's copied forward and nothing is called again.
// Delete this file (and its step in report.yml) once the real FantasyPros fetch is built.
import fs from 'fs';

const KEY = process.env.FANTASYPROS_KEY, OUT = 'site/fp-probe.json';
if (!KEY) { console.log('fp-probe: no FANTASYPROS_KEY'); process.exit(0); }
try {
  const r = await fetch(`https://mrbrofo.github.io/Fantasy-app/fp-probe.json?t=${Date.now()}`);
  if (r.ok) { fs.writeFileSync(OUT, await r.text()); console.log('fp-probe: already done, copied forward'); process.exit(0); }
} catch {}

const SEASON = process.env.SEASON || new Date().getFullYear();
const week = (await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')).json()).week?.number;
const B = `https://api.fantasypros.com/public/v2/json/nfl/${SEASON}`;
const calls = {
  rankAll: `${B}/consensus-rankings?position=ALL&type=weekly&scoring=HALF&week=${week}`,
  rankWR: `${B}/consensus-rankings?position=WR&type=weekly&scoring=HALF&week=${week}`,
  rankRosAll: `${B}/consensus-rankings?position=ALL&type=ros&scoring=HALF`,
  projAll: `${B}/projections?position=ALL&week=${week}&scoring=HALF`,
  projWR: `${B}/projections?position=WR&week=${week}&scoring=HALF`,
};
const out = { at: Date.now(), week, calls: {} };
for (const [name, url] of Object.entries(calls)) {
  const o = out.calls[name] = { url };
  try {
    const r = await fetch(url, { headers: { 'x-api-key': KEY } });
    o.status = r.status;
    o.limits = Object.fromEntries([...r.headers].filter(([k]) => /rate|limit|quota|remaining/i.test(k)));
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { o.body = text.slice(0, 300); continue; }
    o.keys = Object.keys(j);
    const list = Object.values(j).find(Array.isArray) ?? (Array.isArray(j) ? j : null);
    if (list) { o.count = list.length; o.positions = [...new Set(list.map(x => x.player_position_id ?? x.position_id ?? x.position))].slice(0, 12); o.sample = list.slice(0, 2); }
    else o.sample = JSON.stringify(j).slice(0, 600);
  } catch (err) { o.error = err.message; }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('fp-probe:', Object.entries(out.calls).map(([k, v]) => `${k} ${v.status} ${v.count ?? ''}`).join(', '));
