// Long reel of 3D camera shots of the app's screen, back to back with hard cuts, to cut up by hand.
// The screen is built from flat layers (header, matchup, to-do, Ask, tab bar) that can spread apart in depth.
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig, spring, Easing } from 'remotion';
import { GLASS, TERM, Look, useT, clamp, glow, usePop, Card, Chip, H2, Bar, Rim, Bg, Chalk } from './theme';
import { Play, Matchup } from './Promo';

const W = 780, H = 1688; // the phone screen, 2x an iPhone's 390x844
const ease = Easing.inOut(Easing.cubic);
const go = (f, a, b, from, to, e = ease) => interpolate(f, [a, b], [from, to], { ...clamp, easing: e });
const ICONS = [['Home', '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>'], ['Team', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>'], ['Moves', '<path d="M12 5v14M5 12h14"/>'], ['Trades', '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'], ['More', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>']];

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

// one screen of the app, as layers. depth = px between layers (0 = flat). pass `layer` to restyle each layer (fades, etc.)
export const Screen = ({ depth = 0, tab = 0, n = 1, wp = 74, layer = () => ({}), style }) => {
  const T = useT();
  const up = s => (T.glass ? s : s.toUpperCase());
  const L = (i, top, child) => <div key={i} style={{ position: 'absolute', left: 40, width: W - 80, top, transform: `translateZ(${i * depth}px)`, ...layer(i) }}>{child}</div>;
  const row = (a, b, c) => <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 28, padding: '18px 0', borderTop: `1px solid ${T.line}` }}><span>{a}</span><Chip c={c}>{b}</Chip></div>;
  return (
    <div style={{ position: 'absolute', left: -W / 2, top: -H / 2, width: W, height: H, transformStyle: depth ? 'preserve-3d' : 'flat', fontFamily: T.font, color: T.fg, ...style }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: T.glass ? 110 : 0, background: '#000', border: `6px solid ${T.glass ? '#2c2c30' : '#ffffff59'}`, overflow: 'hidden', boxShadow: '0 60px 160px rgba(0,0,0,.8)', ...layer(0) }}>
        {T.glass ? <Chalk w={W} h={H} u={22} /> : <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(#ffffff22 1.5px, transparent 1.6px)', backgroundSize: '30px 30px' }} />}
      </div>
      {L(1, 110, <div>
        <div style={{ fontSize: 24, color: T.muted, fontWeight: 500, letterSpacing: T.glass ? 0 : '.12em' }}>{up('Sunday League')}</div>
        <div style={{ fontSize: T.glass ? 68 : 48, fontWeight: 700, letterSpacing: T.glass ? '-.02em' : '.1em', margin: '6px 0' }}>{up('My Team')}</div>
        <div style={{ fontSize: 26, color: T.muted }}>{up('6-1 · 1st place')}</div>
      </div>)}
      {L(2, 360, <Card style={{ display: 'grid', gap: 22, padding: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: T.muted, fontSize: 24 }}>{up('Week 8')}</span><Chip c={T.bad} style={{ fontSize: 20 }}>● Live</Chip></div>
        {[[up('My Team'), 112.4, T.good], [up('The Rival'), 96.8, T.fg]].map(([t, p, c]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 34 }}>{t}</b><b style={{ fontSize: 64, color: c, textShadow: glow(T, c, 20), fontVariantNumeric: 'tabular-nums' }}>{(p * n).toFixed(1)}</b></div>)}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24 }}><span style={{ color: T.muted }}>{up('Win chance')}</span><b style={{ color: T.good }}>{Math.round(wp)}%</b></div>
        <Bar w={`${wp}%`} c={T.good} />
      </Card>)}
      {L(3, 860, <div><H2 style={{ fontSize: T.glass ? 38 : 28 }}>Do this now</H2><Card style={{ padding: '10px 36px' }}>
        {row('Add R. Rice', '+4.2', T.good)}{row('Bench your TE', 'Hurt', T.warn)}{row('Trade for a WR', 'Fleece', T.good)}
      </Card></div>)}
      {L(4, 1290, <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 32 }}>
        <span style={{ fontSize: 28, fontWeight: 600 }}>Ask Claude about your team</span>
        <span style={{ background: T.glass ? T.accent : 'none', border: T.glass ? 0 : `2px solid ${T.accent}`, color: T.glass ? '#fff' : T.accent, borderRadius: 999 * +T.glass, padding: '10px 26px', fontSize: 24, fontWeight: 600 }}>{up('Ask')}</span>
      </Card>)}
      {L(5, 1520, <Nav tab={tab} />)}
    </div>
  );
};

// a 3D stage: perspective camera, the world's origin in the middle of the frame
const Stage = ({ persp = 1800, origin = '50% 50%', children, style }) => (
  <AbsoluteFill style={{ perspective: persp, perspectiveOrigin: origin, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', ...style }}>{children}</div>
  </AbsoluteFill>
);
const useCount = (a = 10, b = 70) => {
  const f = useCurrentFrame();
  return { n: go(f, a, b, 0, 1, Easing.out(Easing.quad)), wp: go(f, a + 14, b + 10, 50, 74) };
};

// 1. flatten: the screen faces you, tips back until it lies flat, then its layers lift off it as the camera glides over
const Flatten = () => {
  const f = useCurrentFrame(), c = useCount(0, 50);
  const rx = go(f, 20, 90, 0, 62), rz = go(f, 60, 150, 0, -28), lift = go(f, 80, 140, 0, 70), ty = go(f, 20, 150, 0, 120);
  return <Stage style={{ transform: `translateY(${ty}px) scale(${go(f, 0, 150, 0.95, 1.12)}) rotateX(${rx}deg) rotateZ(${rz}deg)` }}><Screen depth={lift} {...c} /></Stage>;
};

// 2. side: edge-on, a thin slab of layers, then it swings round to face you with a little overshoot
const Side = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), c = useCount(40, 100);
  const s = spring({ frame: f - 30, fps, config: { damping: 11, mass: 1.2 } });
  const ry = 86 - f * 0.15 - s * 86, depth = interpolate(s, [0, 1], [45, 4]);
  return <Stage persp={1500} style={{ transform: `rotateY(${ry}deg) rotateX(${(1 - s) * 8}deg) scale(${0.9 + s * 0.05})` }}><Screen depth={depth} {...c} /></Stage>;
};

// 3. fly-through: the layers spread far apart and the camera flies forward through each one into the screen
const Fly = () => {
  const f = useCurrentFrame(), c = useCount(0, 60), P = 1200, D = 520;
  const cam = go(f, 0, 175, -2200, 1500, Easing.inOut(Easing.sin));
  // a layer fades as it reaches the camera, so it blooms past instead of filling the frame
  const layer = i => { const near = i * D + cam; return { opacity: interpolate(near, [P - 380, P - 60], [1, 0], clamp), filter: `blur(${interpolate(near, [P - 500, P - 60], [0, 8], clamp)}px)` }; };
  const bloom = go(f, 140, 180, 0, 1);
  return (
    <AbsoluteFill>
      <Stage persp={P} style={{ transform: `translateZ(${cam}px) rotateZ(${f * 0.08}deg) rotateY(${Math.sin(f / 40) * 6}deg)` }}><Screen depth={D} layer={layer} {...c} /></Stage>
      <AbsoluteFill style={{ background: 'radial-gradient(circle, #0a84ff, transparent 70%)', opacity: bloom * 0.6 }} />
    </AbsoluteFill>
  );
};

// 4. exploded orbit: layers float apart and the camera swings around them
const Orbit = () => {
  const f = useCurrentFrame(), c = useCount(10, 70);
  const depth = go(f, 0, 50, 0, 150, Easing.out(Easing.back(1.4)));
  return <Stage persp={2000} style={{ transform: `scale(.82) rotateX(${18 + Math.sin(f / 50) * 6}deg) rotateY(${go(f, 0, 150, -42, 38)}deg)` }}><Screen depth={depth} {...c} /></Stage>;
};

// 5. wall: a tilted wall of screens, both looks and every tab, sliding past
const Wall = () => {
  const f = useCurrentFrame();
  const cells = [];
  for (let r = -3; r <= 3; r++) for (let q = -2; q <= 2; q++) cells.push([q, r]);
  return (
    <Stage persp={2400} style={{ transform: `rotateX(48deg) rotateZ(-26deg) translate(${-f * 2.2}px, ${f * 6 - 500}px)` }}>
      {cells.map(([q, r]) => {
        const term = (q + r + 10) % 3 === 0;
        return <div key={q + ',' + r} style={{ position: 'absolute', transform: `translate(${q * 860 + (r % 2) * 430}px, ${r * 1780}px)` }}>
          <Look t={term ? TERM : GLASS}><Screen tab={(q + r + 10) % 5} /></Look>
        </div>;
      })}
    </Stage>
  );
};

// 6. look flip: Glass on the front, Terminal on the back, it flips over and back
const Flip = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), c = useCount(0, 50);
  const a = spring({ frame: f - 40, fps, config: { damping: 13 } }), b = spring({ frame: f - 100, fps, config: { damping: 13 } });
  const ry = (a + b) * 180, face = { position: 'absolute', backfaceVisibility: 'hidden', transformStyle: 'preserve-3d' };
  return (
    <Stage persp={2200} style={{ transform: `scale(.92) rotateY(${ry}deg) rotateX(${Math.sin(ry * Math.PI / 180) * 10}deg)` }}>
      <div style={face}><Look t={GLASS}><Screen {...c} /></Look></div>
      <div style={{ ...face, transform: 'rotateY(180deg)' }}><Look t={TERM}><Screen {...c} /></Look></div>
    </Stage>
  );
};

// 7. macro: way in close on the matchup card, rack focus, slow push across the numbers
const Macro = () => {
  const f = useCurrentFrame(), c = useCount(0, 110);
  const focus = go(f, 0, 30, 18, 0, Easing.out(Easing.cubic));
  return (
    <AbsoluteFill style={{ filter: `blur(${focus}px)` }}>
      <Stage persp={1400} style={{ transform: `scale(3.1) rotateX(14deg) rotateY(${go(f, 0, 150, -24, -8)}deg) translate(${go(f, 0, 150, -60, 120)}px, ${go(f, 0, 150, 170, 280)}px)` }}><Screen depth={12} {...c} /></Stage>
    </AbsoluteFill>
  );
};

// 8. tab bar close-up: the glass bubble springs from tab to tab and the page swaps above it
const PAGES = [['My Team', [['112.4', 'good'], ['74% to win', 'good']]], ['Lineup', [['QB · 22.1', 'good'], ['TE · Hurt', 'warn']]], ['Pickup plan', [['+ R. Rice', 'good'], ['− bench RB', 'bad']]], ['Trade ideas', [['WR for TE', 'good'], ['Fleece', 'good']]], ['Settings', [['Glass', 'accent'], ['Terminal', 'good']]]];
const Tabs = () => {
  const T = useT(), f = useCurrentFrame(), { fps } = useVideoConfig();
  const tab = [0, 1, 2, 3].reduce((t, i) => t + spring({ frame: f - 18 - i * 30, fps, config: { damping: 11, mass: 0.7 } }), 0);
  const page = Math.round(tab), [title, rows] = PAGES[page], swap = spring({ frame: f - 18 - (page - 1) * 30 - 4, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 70 }}>
      <div style={{ width: 900, transform: `translateY(${page ? (1 - swap) * 60 : 0}px)`, opacity: page ? swap : 1 }}>
        <Card style={{ display: 'grid', gap: 26 }}><H2 style={{ margin: 0 }}>{title}</H2>
          {rows.map(([t, c]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 40, padding: '14px 0', borderTop: `1px solid ${T.line}` }}><span>{t}</span><Chip c={T[c]} style={{ fontSize: 28 }}>●</Chip></div>)}
        </Card>
      </div>
      <div style={{ transform: `scale(1.4) perspective(1600px) rotateX(${go(f, 0, 150, 30, 8)}deg)` }}><Nav tab={tab} /></div>
    </AbsoluteFill>
  );
};

// 9. chalkboard: the coach's board lies flat like a field and the camera skims across it, the matchup card hovering above
const Board = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage persp={1400} style={{ transform: `translateY(200px) rotateX(58deg) rotateZ(${go(f, 0, 150, -8, 8)}deg) translateY(${go(f, 0, 150, 300, -500)}px)` }}>
        <div style={{ position: 'absolute', left: -1400, top: -2200, width: 2800, height: 4400, backgroundImage: 'linear-gradient(#ffffff10 2px, transparent 2px)', backgroundSize: '100% 220px' }}>
          <Chalk w={2800} h={4400} u={70} lanes={[0.2, 0.4, 0.6, 0.8]} />
        </div>
      </Stage>
      <AbsoluteFill style={{ transform: `perspective(1800px) rotateX(16deg) translateY(${-380 + Math.sin(f / 20) * 16}px) scale(.82)` }}><Matchup /></AbsoluteFill>
    </AbsoluteFill>
  );
};

// 10. the live play on a floating screen that swings in space
const Field3D = () => {
  const f = useCurrentFrame();
  return (
    <Stage persp={2000} style={{ transform: `scale(${go(f, 0, 180, 0.7, 0.88)}) rotateY(${go(f, 0, 180, -34, 14)}deg) rotateX(${go(f, 0, 180, 16, 4)}deg)` }}>
      <div style={{ position: 'absolute', left: -540, top: -960, width: 1080, height: 1920, borderRadius: 60, overflow: 'hidden', border: '6px solid #2c2c30', boxShadow: '0 80px 200px #000' }}><Play /></div>
    </Stage>
  );
};

// 11. alert: the screen tilts in space and a glass notification drops in front of it
const Alert = () => {
  const T = useT(), f = useCurrentFrame(), drop = usePop(36, 11);
  return (
    <Stage persp={1800} style={{ transform: `scale(.86) rotateX(${go(f, 0, 150, 22, 12)}deg) rotateY(${go(f, 0, 150, -28, -14)}deg)` }}>
      <Screen depth={30} />
      <div style={{ position: 'absolute', left: -380, top: -800, width: 760, transform: `translateZ(${220 * drop}px) translateY(${(1 - drop) * -500}px)`, opacity: drop }}>
        <Rim radius={44} fill="rgba(40,40,44,.82)"><div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 28, fontFamily: T.font, color: '#fff' }}>
          <Img src={staticFile('icon-192.png')} style={{ width: 88, height: 88, borderRadius: 22 }} />
          <div><div style={{ fontSize: 30, fontWeight: 700 }}>Touchdown · +6.0 pts</div><div style={{ fontSize: 26, color: T.muted }}>Your WR scored. You're up 15.6.</div></div>
        </div></Rim>
      </div>
    </Stage>
  );
};

export const SHOTS = [[Flatten, 150], [Side, 150], [Fly, 180], [Orbit, 150], [Wall, 180], [Flip, 160], [Macro, 150], [Tabs, 150], [Board, 150], [Field3D, 180], [Alert, 150]];
export const ANGLES_LEN = SHOTS.reduce((a, [, n]) => a + n, 0);

export const Angles = () => {
  let at = 0;
  return (
    <Look t={GLASS}>
      <AbsoluteFill style={{ fontFamily: GLASS.font, color: '#fff' }}>
        <Bg />
        {SHOTS.map(([S, len], i) => { const from = at; at += len; return <Sequence key={i} from={from} durationInFrames={len}><S /></Sequence>; })}
      </AbsoluteFill>
    </Look>
  );
};
