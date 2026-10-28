// One-time check of what the FantasyPros key unlocks: a couple of calls, and only what came back (never the key)
// is published as fp-probe2.json. Once that file is on the site it's copied forward and nothing is called again.
// The first check (fp-probe.json) showed every list stops at 10 players; this one reads the limit/tier fields and
// tries asking for more. Delete this file (and its step in report.yml) once that's settled.
import fs from 'fs';

const KEY = process.env.FANTASYPROS_KEY, OUT = 'site/fp-probe2.json';
if (!KEY) { console.log('fp-probe: no FANTASYPROS_KEY'); process.exit(0); }
try {
  const r = await fetch(`https://mrbrofo.github.io/Fantasy-app/fp-probe2.json?t=${Date.now()}`);
  if (r.ok) { fs.writeFileSync(OUT, await r.text()); console.log('fp-probe: already done, copied forward'); process.exit(0); }
} catch {}

const SEASON = process.env.SEASON || new Date().getFullYear();
const week = (await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')).json()).week?.number;
const B = `https://api.fantasypros.com/public/v2/json/nfl/${SEASON}`;
const calls = {
  rankWR500: `${B}/consensus-rankings?position=WR&type=weekly&scoring=HALF&week=${week}&limit=500`,
  projWR500: `${B}/projections?position=WR&week=${week}&scoring=HALF&limit=500`,
};
const out = { at: Date.now(), week, calls: {} };
for (const [name, url] of Object.entries(calls)) {
  const o = out.calls[name] = { url };
  try {
    const r = await fetch(url, { headers: { 'x-api-key': KEY } });
    o.status = r.status;
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { o.body = text.slice(0, 300); continue; }
    // every field that isn't a list, so limit / public_api / tier / count show up
    o.fields = Object.fromEntries(Object.entries(j).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v]));
    o.lists = Object.fromEntries(Object.entries(j).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
    if (Array.isArray(j.players)) o.last = j.players.at(-1);
  } catch (err) { o.error = err.message; }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('fp-probe:', Object.entries(out.calls).map(([k, v]) => `${k} ${v.status} ${JSON.stringify(v.lists)}`).join(', '));
