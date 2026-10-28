// 15-second vertical promo in the app's Terminal look. 30fps, 450 frames, six scenes that blur into each other.
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { loadFont } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily } = loadFont();
const C = { bg: '#000', fg: '#fff', muted: '#ffffff8c', line: '#ffffff45', good: '#39ff88', warn: '#ffb020', bad: '#ff3b3b' };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const glow = (c, r = 18) => `0 0 ${r}px ${c}`;

// springy pop: 0 -> 1 starting at frame `at`
const usePop = (at, damping = 12) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return spring({ frame: f - at, fps, config: { damping, mass: 0.6 } });
};

// every scene fades and un-blurs in, then zooms past the camera and blurs out
const Scene = ({ len, children }) => {
  const f = useCurrentFrame();
  const inn = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [len - 10, len], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={{ opacity: inn * (1 - out), filter: `blur(${(1 - inn) * 14 + out * 18}px)`, transform: `scale(${0.94 + inn * 0.06 + out * 0.12})` }}>
      {children}
    </AbsoluteFill>
  );
};

// the Terminal background: dot grid, two slow rings, one orbiting light
const Bg = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(#ffffff22 1.5px, transparent 1.6px)', backgroundSize: '36px 36px', backgroundPosition: `0 ${-f * 0.6}px` }} />
      <AbsoluteFill style={{ background: `radial-gradient(60% 40% at 50% ${38 + Math.sin(f / 40) * 4}%, #39ff8818, transparent 70%)` }} />
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 1300, height: 1300, translate: '-50% -50%', border: '2px dashed #ffffff1c', borderRadius: '50%', rotate: `${f * 0.15}deg` }} />
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 860, height: 860, translate: '-50% -50%', border: '2px solid #ffffff14', borderRadius: '50%', rotate: `${-f * 0.6}deg` }}>
        <div style={{ position: 'absolute', top: -6, left: '50%', width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: glow('#fff', 24) }} />
      </div>
    </AbsoluteFill>
  );
};

const Card = ({ children, style }) => (
  <div style={{ background: 'rgba(0,0,0,.78)', border: `2px solid ${C.line}`, padding: 36, ...style }}>{children}</div>
);
const Chip = ({ c, children, style }) => (
  <span style={{ border: `2px solid ${c}`, color: c, padding: '6px 14px', fontSize: 22, letterSpacing: '.12em', textTransform: 'uppercase', boxShadow: glow(c + '66', 12), ...style }}>{children}</span>
);
const H2 = ({ children }) => (
  <div style={{ fontSize: 34, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 24 }}><span style={{ color: C.muted }}>// </span>{children}</div>
);
const Cursor = () => <span style={{ opacity: Math.floor(useCurrentFrame() / 15) % 2 ? 0 : 1 }}>_</span>;
const typed = (text, f, at, perFrame = 0.7) => text.slice(0, Math.max(0, Math.floor((f - at) * perFrame)));

// 1. boot: type the name, ACCESS GRANTED stamp, a beam sweeps across
const Boot = () => {
  const f = useCurrentFrame();
  const stamp = usePop(34, 9);
  const beam = interpolate(f, [30, 46], [110, -10], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 40 }}>
      <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: '.14em', textShadow: glow('#ffffff88', 30) }}>
        <span style={{ color: C.muted }}>&gt;</span>{typed('FANTASY', f, 4, 0.45)}<Cursor />
      </div>
      <div style={{ transform: `scale(${2 - stamp}) rotate(${(1 - stamp) * -8}deg)`, opacity: stamp }}>
        <Chip c={C.good} style={{ fontSize: 40, padding: '12px 28px', borderWidth: 3, boxShadow: glow(C.good, 40), textShadow: glow(C.good, 20) }}>Access granted</Chip>
      </div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${beam}%`, width: 6, background: C.good, boxShadow: glow(C.good, 60), opacity: f > 30 && f < 47 ? 1 : 0 }} />
    </AbsoluteFill>
  );
};

// 2. live matchup: scores count up, win chance bar fills
const Matchup = () => {
  const f = useCurrentFrame();
  const card = usePop(2);
  const n = interpolate(f, [10, 70], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const wp = interpolate(f, [24, 80], [50, 74], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const team = (name, rec, pts, c, d) => {
    const p = usePop(8 + d);
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transform: `translateX(${(1 - p) * (d ? 200 : -200)}px)`, opacity: p }}>
        <div><div style={{ fontSize: 44, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 24, color: C.muted, letterSpacing: '.1em' }}>{rec}</div></div>
        <div style={{ fontSize: 96, fontWeight: 800, color: c, textShadow: glow(c, 24), fontVariantNumeric: 'tabular-nums' }}>{(pts * n).toFixed(1)}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70 }}>
      <Card style={{ transform: `translateY(${(1 - card) * 300}px) scale(${0.8 + card * 0.2})`, opacity: card, display: 'grid', gap: 40, borderColor: '#ffffff59' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 22, letterSpacing: '.2em', color: C.muted }}>WEEK 8</span>
          <Chip c={C.bad} style={{ opacity: Math.floor(f / 21) % 2 ? 0.25 : 1 }}>● Live</Chip>
        </div>
        {team('MY TEAM', '6-1', 112.4, C.good, 0)}
        <div style={{ height: 2, background: C.line }} />
        {team('THE RIVAL', '5-2', 96.8, C.fg, 6)}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, marginBottom: 14 }}>
            <span style={{ color: C.muted, letterSpacing: '.12em' }}>WIN CHANCE</span>
            <b style={{ color: C.good, textShadow: glow(C.good) }}>{Math.round(wp)}%</b>
          </div>
          <div style={{ height: 6, background: '#ffffff1a' }}><div style={{ height: '100%', width: `${wp}%`, background: C.good, boxShadow: glow(C.good, 16) }} /></div>
        </div>
      </Card>
    </AbsoluteFill>
  );
};

// 3. a live play on the Blender field: deep pass, spiral, touchdown. Field math is the app's gcField camera.
const k = z => 1 / (0.075309 + 0.00064582 * z);
const pt = (x, z, up = 0) => { const s = k(z); return [800 + (x - 60) * s, 402.79 + (s - 13.2787) * 72.0 - up * 0.868 * s]; };
const Play = ({ len }) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [14, 62], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const x = 62 + t * 52, z = 30 - t * 10, up = 2 + Math.sin(t * Math.PI) * 16 - t * 1.5;
  const ball = pt(x, z, up), shadow = pt(x, z), ahead = pt(x + 1, z - 0.2, 2 + Math.sin(Math.min(1, t + 0.02) * Math.PI) * 16 - t * 1.5);
  const angle = Math.atan2(ahead[1] - ball[1], ahead[0] - ball[0]) * 180 / Math.PI;
  const bw = k(z) * 1.3 / 60, frame = Math.floor(f * 0.9) % 16;
  const td = f >= 62, tdPop = usePop(62, 8), ptsPop = usePop(70);
  // camera follows the ball across the field, then punches in on the end zone
  const camX = interpolate(ball[0], [600, 1500], [600, 1250], clamp), zoom = 2.1 + (td ? tdPop * 0.25 : 0);
  const shake = td ? Math.sin(f * 2.3) * Math.max(0, 1 - (f - 62) / 18) * 14 : 0;
  const ez = [pt(110, 0), pt(120, 0), pt(120, 53.3), pt(110, 53.3)].map(p => p.join(',')).join(' ');
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <div style={{ position: 'absolute', left: 540 + shake, top: 760, transform: `scale(${zoom}) translate(${-camX}px, -280px)`, transformOrigin: '0 0' }}>
        <svg width={1600} height={490} style={{ overflow: 'visible' }}>
          <image href={staticFile('field.webp')} width={1600} height={490} />
          <image href={staticFile(`crowd${Math.floor(f / 4) % 6}.webp`)} width={1600} height={240} />
          <polygon points={ez} fill={C.good} opacity={td ? 0.35 + Math.sin(f / 3) * 0.1 : 0} />
          <ellipse cx={shadow[0]} cy={shadow[1]} rx={k(z) * 0.6} ry={k(z) * 0.2} fill="#000" opacity={0.35} />
          <g transform={`translate(${ball[0]} ${ball[1]}) rotate(${angle})`} opacity={td && f > 70 ? 0 : 1}>
            <svg x={-120 * bw} y={-80 * bw} width={240 * bw} height={160 * bw} viewBox={`${frame * 240} 0 240 160`}>
              <image href={staticFile('spin.webp')} width={3840} height={160} />
            </svg>
          </g>
        </svg>
      </div>
      <AbsoluteFill style={{ background: 'linear-gradient(#000 0%, transparent 22%, transparent 70%, #000 100%)' }} />
      <div style={{ position: 'absolute', top: 260, width: '100%', textAlign: 'center' }}>
        <Chip c={C.bad} style={{ opacity: Math.floor(f / 21) % 2 ? 0.25 : 1 }}>● Live play</Chip>
        <div style={{ marginTop: 30, fontSize: 34, color: C.muted, letterSpacing: '.1em' }}>{typed('3RD & 7 · DEEP LEFT', f, 0, 1.2)}</div>
      </div>
      {td && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 380, gap: 26 }}>
          <AbsoluteFill style={{ background: C.good, opacity: interpolate(f, [62, 70], [0.5, 0], clamp) }} />
          <div style={{ fontSize: 132, fontWeight: 800, color: C.good, letterSpacing: '.06em', textShadow: `${glow(C.good, 40)}, ${glow(C.good, 90)}`, transform: `scale(${tdPop})` }}>TOUCHDOWN</div>
          <div style={{ transform: `translateY(${(1 - ptsPop) * 80}px)`, opacity: ptsPop }}><Chip c={C.good} style={{ fontSize: 36 }}>+6.0 pts · your WR</Chip></div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// 4. moves and trades: cards cascade in
const Row = ({ at, children }) => {
  const p = usePop(at, 13);
  return <div style={{ transform: `translateX(${(1 - p) * 700}px) rotate(${(1 - p) * 4}deg)`, opacity: p }}>{children}</div>;
};
const Moves = () => {
  const f = useCurrentFrame();
  const bar = (at, w, c) => interpolate(f, [at, at + 25], [0, w], { ...clamp, easing: Easing.out(Easing.cubic) }) + '%';
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70, gap: 30 }}>
      <Row at={0}><H2>Pickup plan</H2></Row>
      <Row at={4}><Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 34 }}><span style={{ color: C.good }}>+ ADD</span> R. Rice<div style={{ fontSize: 26, color: C.muted, marginTop: 8 }}><span style={{ color: C.bad }}>− DROP</span> bench RB</div></div>
        <Chip c={C.good}>+4.2 / wk</Chip>
      </Card></Row>
      <Row at={14}><H2>Trade ideas</H2></Row>
      <Row at={18}><Card style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 32 }}><span>YOU GIVE</span><span style={{ color: C.muted }}>TE · 9.1</span></div>
        <div style={{ height: 8, background: '#ffffff1a' }}><div style={{ height: '100%', width: bar(24, 45), background: C.warn, boxShadow: glow(C.warn) }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 32 }}><span>YOU GET</span><span style={{ color: C.muted }}>WR · 14.6</span></div>
        <div style={{ height: 8, background: '#ffffff1a' }}><div style={{ height: '100%', width: bar(30, 78), background: C.good, boxShadow: glow(C.good) }} /></div>
        <div style={{ textAlign: 'right', transform: `scale(${usePop(44, 8)})` }}><Chip c={C.good} style={{ fontSize: 30 }}>Fleece</Chip></div>
      </Card></Row>
      <Row at={30}><Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 30 }}>BUY LOW · SELL HIGH</span>
        <span style={{ display: 'flex', gap: 14 }}><Chip c={C.good}>Buy</Chip><Chip c={C.bad}>Sell</Chip></span>
      </Card></Row>
    </AbsoluteFill>
  );
};

// 5. Ask Claude: the question types, the answer streams in
const Ask = () => {
  const f = useCurrentFrame();
  const q = 'who should i start at flex?';
  const a = 'Start Rice. 18 touches last 2 games and a weak run defense. Bench your TE: 9% of targets.';
  const box = usePop(0);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70 }}>
      <Card style={{ transform: `scale(${0.85 + box * 0.15})`, opacity: box, display: 'grid', gap: 30 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Ask Claude about your team</div>
        <div style={{ border: `2px solid ${C.line}`, padding: '24px 26px', fontSize: 32 }}><span style={{ color: C.muted }}>&gt; </span>{typed(q, f, 4, 1.4)}{f < 30 && <Cursor />}</div>
        <div style={{ border: `2px solid ${C.good}66`, padding: '26px 28px', fontSize: 31, lineHeight: 1.55, minHeight: 250, boxShadow: glow('#39ff8833', 30), opacity: f > 26 ? 1 : 0 }}>
          {typed(a, f, 28, 3)}{f > 26 && <Cursor />}
        </div>
      </Card>
    </AbsoluteFill>
  );
};

// 6. outro: helmet pops in on a glow, name, cursor
const Outro = () => {
  const f = useCurrentFrame();
  const p = usePop(0, 9), t = usePop(10);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 50 }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(#39ff8840, transparent 65%)', transform: `scale(${p})` }} />
      <Img src={staticFile('icon-512.png')} style={{ width: 420, height: 420, borderRadius: 96, transform: `scale(${p}) rotate(${(1 - p) * -25}deg) translateY(${Math.sin(f / 10) * 8}px)`, boxShadow: glow('#39ff8866', 60) }} />
      <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: '.14em', opacity: t, transform: `translateY(${(1 - t) * 60}px)`, textShadow: glow('#ffffff88', 30) }}>FANTASY<Cursor /></div>
    </AbsoluteFill>
  );
};

const SCENES = [[Boot, 0, 66], [Matchup, 60, 96], [Play, 150, 108], [Moves, 252, 96], [Ask, 342, 72], [Outro, 408, 42]];

export const Promo = () => (
  <AbsoluteFill style={{ fontFamily, color: C.fg }}>
    <Bg />
    {SCENES.map(([S, from, len], i) => (
      <Sequence key={i} from={from} durationInFrames={len}>
        {i === SCENES.length - 1 ? <S /> : <Scene len={len}><S len={len} /></Scene>}
      </Sequence>
    ))}
  </AbsoluteFill>
);
