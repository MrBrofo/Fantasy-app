// Every page of the app as a phone screen, built from flat blocks that can spread apart in depth.
// Names are real NFL players; teams and numbers are made up.
import { useCurrentFrame, staticFile } from 'remotion';
import { useT, glow, Card, Chip, H2, Bar, Rim, Chalk } from './theme';

export const W = 780, H = 1688; // 2x an iPhone's 390x844
const ICONS = [['Home', '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>'], ['Team', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>'], ['Moves', '<path d="M12 5v14M5 12h14"/>'], ['Trades', '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'], ['More', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>']];
const POS = { QB: '#e5484d', RB: '#12a150', WR: '#3e63dd', TE: '#f76b15', K: '#8e4ec6', DST: '#646f82' };

// the tab bar; `tab` can be fractional so the glass bubble slides between tabs
export const Nav = ({ tab = 0, width = 700 }) => {
  const T = useT(), cell = (width - 24) / 5;
  const items = ICONS.map(([label, d], i) => {
    const on = Math.max(0, 1 - Math.abs(tab - i));
    return (
      <div key={label} style={{ width: cell, display: 'grid', justifyItems: 'center', gap: 4, fontSize: 20, fontWeight: 600, color: on > 0.5 ? T.accent : T.glass ? 'rgba(255,255,255,.75)' : T.muted, textShadow: on > 0.5 ? glow(T, T.accent, 10) : 'none' }}>
        <svg viewBox="0 0 24 24" width={44} height={44} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
        {T.glass ? label : label.toUpperCase()}
      </div>
    );
  });
  const row = <div style={{ position: 'relative', display: 'flex', padding: '14px 10px' }}>
    {T.glass && <Rim style={{ position: 'absolute', top: 6, left: 10 + tab * cell, width: cell, height: 'calc(100% - 12px)' }} fill="rgba(255,255,255,.12)" />}
    {items}
  </div>;
  return T.glass
    ? <Rim style={{ width }} fill="rgba(20,20,22,.6)">{row}</Rim>
    : <div style={{ width, border: `2px solid ${T.line}`, background: 'rgba(0,0,0,.82)' }}>{row}</div>;
};

// ---- small pieces ----
const useUp = () => { const T = useT(); return s => (T.glass ? s : s.toUpperCase()); };
const Pos = ({ p }) => {
  const T = useT(), c = POS[p.replace('/', '')];
  return <span style={{ display: 'inline-block', minWidth: 58, textAlign: 'center', fontSize: 18, fontWeight: 700, padding: '4px 8px', borderRadius: T.glass ? 8 : 0, background: T.glass ? c : 'none', border: T.glass ? 0 : `2px solid ${c}`, color: T.glass ? '#fff' : c }}>{p}</span>;
};
const Pic = ({ name, size = 64 }) => {
  const T = useT(), ini = name.split(' ').map(s => s[0]).join('').slice(0, 2);
  return <span style={{ width: size, height: size, flex: 'none', borderRadius: T.glass ? '50%' : 0, background: T.glass ? '#3a3a3e' : 'none', border: T.glass ? 0 : `2px solid ${T.line}`, display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 700, color: T.muted }}>{ini}</span>;
};
// a player row: slot, photo, name, position + team, a number on the right
const PRow = ({ slot, name, pos, team, pts, c, first }) => {
  const T = useT();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 0', borderTop: first ? 0 : `1px solid ${T.line}` }}>
      {slot && <span style={{ width: 70, fontSize: 18, color: T.muted, fontWeight: 600 }}>{slot}</span>}
      <Pic name={name} size={56} />
      <div style={{ flex: 1 }}><div style={{ fontSize: 27, fontWeight: 600 }}>{name}</div><div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 20, color: T.muted, marginTop: 4 }}><Pos p={pos} />{team}</div></div>
      <b style={{ fontSize: 30, color: c || T.fg, textShadow: c ? glow(T, c, 12) : 'none', fontVariantNumeric: 'tabular-nums' }}>{pts}</b>
    </div>
  );
};
const Group = ({ children }) => { const T = useT(), up = useUp(); return <div style={{ fontSize: T.glass ? 22 : 18, color: T.muted, fontWeight: 600, letterSpacing: T.glass ? 0 : '.2em', marginBottom: 10 }}>{up(children)}</div>; };
const Why = ({ children }) => { const T = useT(); return <div style={{ fontSize: 22, color: T.muted, lineHeight: 1.45, marginTop: 12 }}>{children}</div>; };
const VHead = ({ tag, v, c }) => { const T = useT(), up = useUp(); return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 22, color: T.muted }}>{up(tag)}</span><Chip c={c} style={{ fontSize: 20 }}>{v}</Chip></div>; };
const Arrow = ({ children }) => { const T = useT(), up = useUp(); return <div style={{ fontSize: 18, color: T.muted, letterSpacing: '.1em', margin: '8px 0 0' }}>{up(children)}</div>; };
const Stat = ({ items }) => {
  const T = useT();
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 14 }}>{items.map(([b, s, c]) => (
    <div key={s} style={{ background: T.glass ? '#ffffff0d' : 'none', border: T.glass ? 0 : `1px solid ${T.line}`, borderRadius: T.glass ? 22 : 0, padding: '18px 20px' }}>
      <b style={{ fontSize: 44, color: c || T.fg, textShadow: c ? glow(T, c, 14) : 'none' }}>{b}</b><div style={{ fontSize: 19, color: T.muted, marginTop: 4 }}>{s}</div>
    </div>))}</div>;
};
const Seg = ({ items, on }) => {
  const T = useT(), up = useUp();
  const inner = <div style={{ display: 'flex', padding: 6 }}>{items.map((s, i) => <div key={s} style={{ flex: 1, textAlign: 'center', padding: '14px 0', fontSize: 22, fontWeight: 600, borderRadius: T.glass ? 999 : 0, background: i === on ? (T.glass ? 'rgba(255,255,255,.14)' : T.accent) : 'none', color: i === on ? (T.glass ? T.accent : '#000') : T.fg }}>{up(s)}</div>)}</div>;
  return T.glass ? <Rim fill="rgba(40,40,44,.7)">{inner}</Rim> : <div style={{ border: `2px solid ${T.line}` }}>{inner}</div>;
};
const Btn = ({ children, c }) => { const T = useT(), up = useUp(); return <div style={{ textAlign: 'center', padding: '18px 0', marginTop: 16, fontSize: 24, fontWeight: 700, borderRadius: T.glass ? 999 : 0, background: T.glass ? (c || T.accent) : 'none', border: T.glass ? 0 : `2px solid ${c || T.accent}`, color: T.glass ? '#fff' : (c || T.accent) }}>{up(children)}</div>; };
const Head = ({ league = 'Sunday League', title, sub }) => {
  const T = useT(), up = useUp();
  return <div>
    <div style={{ fontSize: 24, color: T.muted, fontWeight: 500, letterSpacing: T.glass ? 0 : '.12em' }}>{up(league)}</div>
    <div style={{ fontSize: T.glass ? 68 : 48, fontWeight: 700, letterSpacing: T.glass ? '-.02em' : '.1em', margin: '6px 0' }}>{up(title)}</div>
    {sub && <div style={{ fontSize: 26, color: T.muted }}>{up(sub)}</div>}
  </div>;
};
const Sec = ({ title, children, size }) => { const T = useT(); return <div><H2 style={{ fontSize: size || (T.glass ? 38 : 28) }}>{title}</H2>{children}</div>; };

// ---- the pages: [top, block] pairs, plus which tab is lit ----
const Matchup = ({ n, wp }) => {
  const T = useT(), up = useUp();
  return <Card style={{ display: 'grid', gap: 22, padding: 36 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: T.muted, fontSize: 24 }}>{up('Week 8')}</span><Chip c={T.bad} style={{ fontSize: 20 }}>● Live</Chip></div>
    {[[up('My Team'), 112.4, T.good], [up('The Rival'), 96.8, T.fg]].map(([t, p, c]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 34 }}>{t}</b><b style={{ fontSize: 64, color: c, textShadow: glow(T, c, 20), fontVariantNumeric: 'tabular-nums' }}>{(p * n).toFixed(1)}</b></div>)}
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24 }}><span style={{ color: T.muted }}>{up('Win chance')}</span><b style={{ color: T.good }}>{Math.round(wp)}%</b></div>
    <Bar w={`${wp}%`} c={T.good} />
  </Card>;
};
const rowCard = rows => { const R = () => { const T = useT(); return <Card style={{ padding: '10px 36px' }}>{rows.map(([a, b, c], i) => <div key={a} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 28, padding: '18px 0', borderTop: i ? `1px solid ${T.line}` : 0 }}><span>{a}</span><Chip c={T[c]}>{b}</Chip></div>)}</Card>; }; return <R />; };

const PAGES = {
  home: { tab: 0, blocks: ({ n, wp }) => [
    [110, <Head title="My Team" sub="6-1 · 1st place" />],
    [360, <Matchup n={n} wp={wp} />],
    [860, <Sec title="Do this now">{rowCard([['Add Rashee Rice', '+4.2', 'good'], ['Bench your TE', 'Hurt', 'warn'], ['Trade for a WR', 'Fleece', 'good']])}</Sec>],
    [1290, <AskMini />],
  ] },
  team: { tab: 1, blocks: () => [
    [110, <Head title="My team" sub="Starting lineup" />],
    [330, <Card style={{ padding: '6px 32px' }}>{[['QB', 'Josh Allen', 'QB', 'BUF', '24.8'], ['RB', 'Bijan Robinson', 'RB', 'ATL', '19.2'], ['RB', 'Jahmyr Gibbs', 'RB', 'DET', '17.6'], ['WR', "Ja'Marr Chase", 'WR', 'CIN', '18.1'], ['WR', 'Amon-Ra St. Brown', 'WR', 'DET', '16.9'], ['TE', 'Trey McBride', 'TE', 'ARI', '12.4'], ['FLEX', 'Rashee Rice', 'WR', 'KC', '13.0'], ['D/ST', 'Steelers', 'D/ST', 'PIT', '8.0']].map(([s, nm, p, t, v], i) => <PRow key={nm} slot={s} name={nm} pos={p} team={t} pts={v} first={!i} />)}</Card>],
    [1200, <BenchCheck />],
  ] },
  moves: { tab: 2, blocks: () => [
    [110, <Head title="Pickup plan" sub="Do these in order." />],
    [340, <WaiverOrder />],
    [600, <PlanStep />],
    [1040, <Pending />],
  ] },
  trades: { tab: 3, blocks: () => [
    [110, <Head title="Trade ideas" sub="Best deals in your league" />],
    [340, <TradeIdea />],
    [820, <BuySell />],
    [1150, <Compare />],
  ] },
  season: { tab: 4, blocks: ({ n }) => [
    [110, <Head title="Season outlook" sub="7 games left" />],
    [340, <Card><Group>Playoff chances</Group><Stat items={[[`${Math.round(82 * n)}%`, 'make the playoffs', useT().good], ['6-1', 'now']]} /><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>{['9-8: 64%', '10-7: 91%', '11-6: 99%'].map(s => <Chip key={s} c={useT().muted} style={{ fontSize: 20 }}>{s}</Chip>)}</div></Card>],
    [770, <Card><Group>Luck check</Group><Stat items={[['6-1', 'real record'], ['49 of 63', 'all-play wins', useT().good]]} /><Why>Your record matches how you've played.</Why></Card>],
    [1150, <Schedule />],
  ] },
  league: { tab: 4, blocks: () => [
    [110, <Head title="League" sub="Dashed line = playoff cutoff" />],
    [340, <Standings />],
  ] },
  // the team page with a player's card slid up over it
  player: { tab: 1, nav: false, blocks: () => [
    ...PAGES.team.blocks(),
    [-6, <div style={{ width: W, height: H, margin: '0 -40px', borderRadius: 110, background: 'rgba(0,0,0,.55)' }} />],
    [470, <PlayerSheet />],
  ] },
  ask: { tab: 0, blocks: () => [
    [110, <Head title="Ask Claude" sub="About your team" />],
    [340, <AskFull />],
  ] },
  settings: { tab: 4, blocks: () => [
    [110, <Head title="More" />],
    [300, <Card><Group>Look</Group><Seg items={['Terminal', 'Classic', 'Glass']} on={useT().glass ? 2 : 0} /></Card>],
    [560, <Card><b style={{ fontSize: 30 }}>Phone alerts</b><Why>Touchdowns, injuries, trades and waiver results.</Why><Btn>Turn on alerts</Btn></Card>],
    [920, <Sec title="News"><Card style={{ padding: '6px 32px' }}>{[['Bijan Robinson', 'RB', 'Full practice Wednesday'], ['Trey McBride', 'TE', 'Questionable, ankle'], ['Rashee Rice', 'WR', 'Snaps up to 88%']].map(([nm, p, t], i) => <PRow key={nm} name={nm} pos={p} team={t} pts="" first={!i} />)}</Card></Sec>],
  ] },
  live: { tab: 0, blocks: () => [
    [110, <Head title="Watch" sub="BUF 21 · KC 17 · Q4 2:14" />],
    [340, <LiveField />],
    [900, <Card style={{ padding: '6px 32px' }}><PRow name="Josh Allen" pos="QB" team="Pass TD · 34 yds" pts="+6.0" c={useT().good} first /><PRow name="Rashee Rice" pos="WR" team="Catch · 34 yds" pts="+9.4" c={useT().good} /></Card>],
    [1250, <Matchup n={1} wp={81} />],
  ] },
};
export const PAGE_NAMES = Object.keys(PAGES);

function AskMini() {
  const T = useT(), up = useUp();
  return <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 32 }}>
    <span style={{ fontSize: 28, fontWeight: 600 }}>Ask Claude about your team</span>
    <span style={{ background: T.glass ? T.accent : 'none', border: T.glass ? 0 : `2px solid ${T.accent}`, color: T.glass ? '#fff' : T.accent, borderRadius: 999 * +T.glass, padding: '10px 26px', fontSize: 24, fontWeight: 600 }}>{up('Ask')}</span>
  </Card>;
}
function AskFull() {
  const T = useT();
  const box = { background: T.glass ? '#ffffff0f' : 'none', border: T.glass ? 0 : `2px solid ${T.line}`, borderRadius: T.glass ? 24 : 0, padding: 24, fontSize: 26 };
  return <Card style={{ display: 'grid', gap: 20 }}>
    <b style={{ fontSize: 30 }}>Ask Claude about your team</b>
    <div style={box}>Should I trade McBride for a WR?</div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div style={{ flex: 1 }}><Seg items={['Auto', 'Quick', 'Smart']} on={0} /></div><Chip c={T.muted} style={{ fontSize: 20 }}>Half price</Chip></div>
    <Btn>Ask Claude</Btn>
    <div style={{ ...box, border: T.glass ? 0 : `2px solid ${T.good}66`, lineHeight: 1.5 }}>Yes. Your WR2 averages 9.1 and McBride is the 3rd best TE. Offer him to <b>Fourth &amp; Long</b> for Garrett Wilson: +3.4 a week for you.</div>
  </Card>;
}
function BenchCheck() {
  const T = useT();
  return <Sec title="Bench check"><Card><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 28 }}>Tony Pollard</b><Chip c={T.bad} style={{ fontSize: 20 }}>Drop</Chip></div><Why>He doesn't start in any of the next 3 weeks. Drop him for Rashee Rice: about +11 points.</Why></Card></Sec>;
}
function WaiverOrder() {
  const T = useT();
  return <Card><VHead tag="Waiver order" v="You pick 3 of 10" c={T.warn} /><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{['1. Hail Marys', '2. Gridiron Gang', '3. You', '4. Fourth & Long'].map((s, i) => <span key={s} style={{ fontSize: 20, padding: '6px 12px', border: `1px solid ${i === 2 ? T.accent : T.line}`, color: i === 2 ? T.accent : T.fg, borderRadius: T.glass ? 10 : 0 }}>{s}</span>)}</div></Card>;
}
function PlanStep() {
  const T = useT();
  return <Card><Group>Step 1 · This week</Group><PRow name="Rashee Rice" pos="WR" team="KC · 14.2 a game" pts="Add" c={T.good} first /><PRow name="Tony Pollard" pos="RB" team="TEN · 6.1 a game" pts="Drop" c={T.bad} /><Why><Chip c={T.good} style={{ fontSize: 18 }}>+4.2</Chip> a week. No team that picks before you needs him.</Why></Card>;
}
function Pending() {
  const T = useT();
  return <Sec title="Your pending moves"><Card><VHead tag="Waiver claim" v="Good for you" c={T.good} /><PRow name="Jaylen Warren" pos="RB" team="PIT" pts="Add" c={T.good} first /><Arrow>drop</Arrow><PRow name="Zay Flowers" pos="WR" team="BAL" pts="Drop" c={T.bad} first /></Card></Sec>;
}
function TradeIdea() {
  const T = useT();
  return <Card><VHead tag="with Fourth & Long" v="+3.4 a week" c={T.good} /><Arrow>you give</Arrow><PRow name="Trey McBride" pos="TE" team="ARI · 12.4" pts="" first /><Arrow>you get</Arrow><PRow name="Garrett Wilson" pos="WR" team="NYJ · 15.8" pts="" first /><Btn>Send on ESPN</Btn></Card>;
}
function BuySell() {
  const T = useT(), f = useCurrentFrame(), w = v => `${Math.min(v, f * 2)}%`;
  return <Sec title="Buy low, sell high"><Card style={{ display: 'grid', gap: 14 }}>
    {[['Mark Andrews', 'Buy', T.good, 70], ['Kyren Williams', 'Sell', T.bad, 35]].map(([nm, v, c, b]) => <div key={nm}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, marginBottom: 10 }}><span>{nm}</span><Chip c={c} style={{ fontSize: 18 }}>{v}</Chip></div><Bar w={w(b)} c={c} /></div>)}
  </Card></Sec>;
}
function Compare() {
  const T = useT();
  const rows = [['Points / game', '15.8', '12.4'], ['Targets', '9.1', '6.8'], ['Red zone', '22%', '18%']];
  return <Sec title="Compare players"><Card style={{ padding: '18px 32px' }}>{rows.map(([a, b, c], i) => <div key={a} style={{ display: 'flex', fontSize: 24, padding: '12px 0', borderTop: i ? `1px solid ${T.line}` : 0 }}><span style={{ flex: 1, color: T.muted }}>{a}</span><b style={{ width: 110, textAlign: 'right', color: T.good }}>{b}</b><span style={{ width: 110, textAlign: 'right' }}>{c}</span></div>)}</Card></Sec>;
}
function Schedule() {
  const T = useT();
  return <Card><Group>Your schedule ahead</Group>{[['Wk 9', 'Hail Marys', 'Easy', T.good], ['Wk 10', 'Gridiron Gang', 'Hard', T.bad], ['Wk 11', 'Blitz Boys', 'Even', T.warn]].map(([w, t, l, c], i) => <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 24, padding: '12px 0', borderTop: i ? `1px solid ${T.line}` : 0 }}><span style={{ width: 80, color: T.muted }}>{w}</span><span style={{ flex: 1 }}>{t}</span><Chip c={c} style={{ fontSize: 18 }}>{l}</Chip></div>)}</Card>;
}
function Standings() {
  const T = useT(), f = useCurrentFrame();
  const teams = [['My Team', '6-1', '842'], ['Gridiron Gang', '5-2', '815'], ['Fourth & Long', '5-2', '798'], ['Hail Marys', '4-3', '781'], ['Blitz Boys', '4-3', '760'], ['The Rival', '4-3', '744'], ['Red Zone', '3-4', '731'], ['Punt City', '2-5', '702'], ['Fumblers', '1-6', '668'], ['Bye Week', '1-6', '650']];
  return <Card style={{ padding: '14px 32px' }}>{teams.map(([t, r, p], i) => (
    <div key={t} style={{ display: 'flex', fontSize: 25, padding: '15px 0', borderTop: i === 6 ? `3px dashed ${T.muted}` : i ? `1px solid ${T.line}` : 0, color: i ? T.fg : T.good, fontWeight: i ? 400 : 700, opacity: Math.min(1, Math.max(0, (f - i * 3) / 8)) }}>
      <span style={{ width: 46, color: T.muted }}>{i + 1}</span><span style={{ flex: 1 }}>{t}</span><span style={{ width: 90, textAlign: 'right' }}>{r}</span><span style={{ width: 100, textAlign: 'right' }}>{p}</span>
    </div>))}</Card>;
}
function PlayerSheet() {
  const T = useT(), log = [12, 18, 9, 22, 16, 25, 19];
  return <div style={{ position: 'relative' }}>
    <Card style={{ borderRadius: T.glass ? '52px 52px 0 0' : 0, paddingBottom: 60, boxShadow: '0 -20px 60px rgba(0,0,0,.6)', background: T.glass ? 'rgba(44,44,48,.96)' : '#000' }}>
      <div style={{ width: 90, height: 8, borderRadius: 9, background: '#ffffff40', margin: '-16px auto 26px', display: T.glass ? 'block' : 'none' }} />
      <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}><Pic name="Jahmyr Gibbs" size={110} /><div><div style={{ fontSize: 40, fontWeight: 700 }}>Jahmyr Gibbs</div><div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 22, color: T.muted, marginTop: 6 }}><Pos p="RB" />DET · vs GB Sun</div></div></div>
      <div style={{ marginTop: 26 }}><Stat items={[['17.6', 'this week'], ['#4', 'at RB', T.good], ['71%', 'snaps']]} /></div>
      <div style={{ marginTop: 26 }}><Group>Last 7 games</Group><div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 160 }}>{log.map((v, i) => <div key={i} style={{ flex: 1, height: `${v * 6}px`, borderRadius: T.glass ? 10 : 0, background: v > 15 ? T.good : '#ffffff30', boxShadow: v > 15 ? glow(T, T.good, 10) : 'none' }} />)}</div></div>
      <Btn>Trade for a WR</Btn>
    </Card>
  </div>;
}
function LiveField() {
  const T = useT(), f = useCurrentFrame();
  return <div style={{ borderRadius: T.glass ? 40 : 0, overflow: 'hidden', border: T.glass ? 0 : `2px solid ${T.line}`, position: 'relative', height: 480 }}>
    <svg viewBox="420 120 900 380" width={700} height={480} preserveAspectRatio="xMidYMid slice">
      <image href={staticFile('field.webp')} width={1600} height={490} />
      <image href={staticFile(`crowd${Math.floor(f / 4) % 6}.webp`)} width={1600} height={240} />
    </svg>
    <div style={{ position: 'absolute', left: 20, top: 20 }}><Chip c={T.bad} style={{ fontSize: 18, background: '#000a' }}>● Live</Chip></div>
  </div>;
}

// one page of the app. depth = px between blocks (0 = flat); `layer` restyles each block (fades, etc.)
export const Screen = ({ page = 'home', depth = 0, n = 1, wp = 74, tab, layer = () => ({}), style }) => {
  const T = useT(), P = PAGES[page];
  const blocks = P.blocks({ n, wp });
  const at = (i, top, child) => <div key={i} style={{ position: 'absolute', left: 40, width: W - 80, top, transform: `translateZ(${i * depth}px)`, ...layer(i) }}>{child}</div>;
  return (
    <div style={{ position: 'absolute', left: -W / 2, top: -H / 2, width: W, height: H, transformStyle: depth ? 'preserve-3d' : 'flat', fontFamily: T.font, color: T.fg, ...style }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: T.glass ? 110 : 0, background: '#000', border: `6px solid ${T.glass ? '#2c2c30' : '#ffffff59'}`, overflow: 'hidden', boxShadow: '0 60px 160px rgba(0,0,0,.8)', ...layer(0) }}>
        {T.glass ? <Chalk w={W} h={H} u={22} /> : <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#ffffff22 1.5px, transparent 1.6px)', backgroundSize: '30px 30px' }} />}
      </div>
      {blocks.map(([top, el], i) => at(i + 1, top, el))}
      {P.nav !== false && at(blocks.length + 1, 1520, <Nav tab={tab ?? P.tab} />)}
    </div>
  );
};
