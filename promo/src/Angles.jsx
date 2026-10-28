// Long reel of 3D camera shots of the app's screen, back to back with hard cuts, to cut up by hand.
// The screen is built from flat layers (header, matchup, to-do, Ask, tab bar) that can spread apart in depth.
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig, spring, Easing } from 'remotion';
import { GLASS, TERM, Look, useT, clamp, glow, usePop, Card, Chip, H2, Bar, Rim, Bg, Chalk } from './theme';
import { Play, Matchup } from './Promo';

import { Screen, Nav, PAGE_NAMES } from './screens';
const ease = Easing.inOut(Easing.cubic);
const go = (f, a, b, from, to, e = ease) => interpolate(f, [a, b], [from, to], { ...clamp, easing: e });

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
  return <Stage style={{ transform: `translateY(${ty}px) scale(${go(f, 0, 150, 0.95, 1.12)}) rotateX(${rx}deg) rotateZ(${rz}deg)` }}><Screen page="team" depth={lift} {...c} /></Stage>;
};

// 2. side: edge-on, a thin slab of layers, then it swings round to face you with a little overshoot
const Side = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), c = useCount(40, 100);
  const s = spring({ frame: f - 30, fps, config: { damping: 11, mass: 1.2 } });
  const ry = 86 - f * 0.15 - s * 86, depth = interpolate(s, [0, 1], [45, 4]);
  return <Stage persp={1500} style={{ transform: `rotateY(${ry}deg) rotateX(${(1 - s) * 8}deg) scale(${0.9 + s * 0.05})` }}><Screen page="moves" depth={depth} {...c} /></Stage>;
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
  return <Stage persp={2000} style={{ transform: `scale(.82) rotateX(${18 + Math.sin(f / 50) * 6}deg) rotateY(${go(f, 0, 150, -42, 38)}deg)` }}><Screen page="trades" depth={depth} {...c} /></Stage>;
};

// 5. wall: a tilted wall of screens, both looks and every tab, sliding past
const Wall = () => {
  const f = useCurrentFrame();
  const cells = [];
  for (let r = -3; r <= 3; r++) for (let q = -2; q <= 2; q++) cells.push([q, r]);
  return (
    <Stage persp={2400} style={{ transform: `rotateX(48deg) rotateZ(-26deg) translate(${-f * 2.2}px, ${f * 6 - 500}px)` }}>
      {cells.map(([q, r]) => {
        const term = (q + r + 10) % 3 === 0, page = PAGE_NAMES[(q * 3 + r + 30) % PAGE_NAMES.length];
        return <div key={q + ',' + r} style={{ position: 'absolute', transform: `translate(${q * 860 + (r % 2) * 430}px, ${r * 1780}px)` }}>
          <Look t={term ? TERM : GLASS}><Screen page={page} /></Look>
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
      <div style={face}><Look t={GLASS}><Screen page="league" {...c} /></Look></div>
      <div style={{ ...face, transform: 'rotateY(180deg)' }}><Look t={TERM}><Screen page="league" {...c} /></Look></div>
    </Stage>
  );
};

// 7. macro: way in close on the matchup card, rack focus, slow push across the numbers
const Macro = () => {
  const f = useCurrentFrame(), c = useCount(0, 110);
  const focus = go(f, 0, 30, 18, 0, Easing.out(Easing.cubic));
  return (
    <AbsoluteFill style={{ filter: `blur(${focus}px)` }}>
      <Stage persp={1400} style={{ transform: `scale(3.1) rotateX(14deg) rotateY(${go(f, 0, 150, -24, -8)}deg) translate(${go(f, 0, 150, -60, 120)}px, ${go(f, 0, 150, 170, 280)}px)` }}><Screen page="season" depth={12} {...c} /></Stage>
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
      <Screen page="live" depth={30} />
      <div style={{ position: 'absolute', left: -380, top: -800, width: 760, transform: `translateZ(${220 * drop}px) translateY(${(1 - drop) * -500}px)`, opacity: drop }}>
        <Rim radius={44} fill="rgba(40,40,44,.82)"><div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 28, fontFamily: T.font, color: '#fff' }}>
          <Img src={staticFile('icon-192.png')} style={{ width: 88, height: 88, borderRadius: 22 }} />
          <div><div style={{ fontSize: 30, fontWeight: 700 }}>Touchdown · +6.0 pts</div><div style={{ fontSize: 26, color: T.muted }}>Your WR scored. You're up 15.6.</div></div>
        </div></Rim>
      </div>
    </Stage>
  );
};

// 12. carousel: every page on a ring, turning past the camera
const Carousel = () => {
  const f = useCurrentFrame(), N = PAGE_NAMES.length, R = 1350;
  return (
    <Stage persp={2200} style={{ transform: `translateY(-100px) translateZ(-3400px) rotateX(-14deg) rotateY(${-f * 0.9}deg)` }}>
      {PAGE_NAMES.map((p, i) => <div key={p} style={{ position: 'absolute', transform: `rotateY(${i * 360 / N}deg) translateZ(${R}px)`, backfaceVisibility: 'hidden' }}><Screen page={p} /></div>)}
    </Stage>
  );
};

// 13. deck: all the pages stacked like cards, then fanned out
const Fan = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), N = PAGE_NAMES.length;
  const s = spring({ frame: f - 20, fps, config: { damping: 13, mass: 1.1 } }), slide = go(f, 90, 150, 0, 1);
  return (
    <Stage persp={2400} style={{ transform: `translateY(380px) scale(.5) rotateX(${go(f, 0, 150, 26, 14)}deg)` }}>
      {PAGE_NAMES.map((p, i) => { const k = i - (N - 1) / 2; return (
        <div key={p} style={{ position: 'absolute', transformOrigin: '0 900px', transform: `translateX(${k * 380 * slide}px) rotateZ(${k * 9 * s * (1 - slide)}deg) translateZ(${i * 6}px) translateY(${-Math.abs(k) * 30 * slide}px)` }}><Screen page={p} /></div>
      ); })}
    </Stage>
  );
};

// 14. tour: one phone, swiping through every page
const Tour = () => {
  const f = useCurrentFrame(), N = PAGE_NAMES.length, per = 22;
  const i = Math.min(N - 1, Math.floor(f / per)), e = i < N - 1 ? go(f % per, 12, per, 0, 1, Easing.inOut(Easing.quad)) : 0;
  const one = (p, x) => <div style={{ position: 'absolute', left: 390 + x, top: 844 }}><Screen page={p} /></div>;
  return (
    <Stage persp={2000} style={{ transform: `scale(.95) rotateY(${Math.sin(f / 45) * 14}deg) rotateX(${Math.cos(f / 60) * 6}deg)` }}>
      <div style={{ position: 'absolute', left: -390, top: -844, width: 780, height: 1688, borderRadius: 110, overflow: 'hidden' }}>
        {one(PAGE_NAMES[i], -e * 820)}
        {i < N - 1 && one(PAGE_NAMES[i + 1], (1 - e) * 820)}
      </div>
    </Stage>
  );
};

// 15. player card: the sheet slides up over the lineup, the phone tilted
const Sheet = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const p = spring({ frame: f - 30, fps, config: { damping: 15, mass: 0.9 } });
  const layer = i => (i === 4 ? { opacity: p } : i === 5 ? { transform: `translateZ(${p * 60}px) translateY(${(1 - p) * 1300}px)` } : {});
  return <Stage persp={1800} style={{ transform: `scale(.9) rotateX(${go(f, 0, 150, 18, 6)}deg) rotateY(${go(f, 0, 150, 20, -10)}deg)` }}><Screen page="player" depth={4} layer={layer} /></Stage>;
};

export const SHOTS = [[Flatten, 150], [Side, 150], [Fly, 180], [Tour, 220], [Orbit, 150], [Carousel, 200], [Wall, 180], [Fan, 160], [Flip, 160], [Sheet, 130], [Macro, 150], [Tabs, 150], [Board, 150], [Field3D, 180], [Alert, 150]];
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
