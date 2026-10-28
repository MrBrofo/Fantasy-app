// 15-second vertical promo. 30fps, 450 frames, six scenes that blur into each other. `look` picks Glass or Terminal.
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { GLASS, TERM, Look, useT, clamp, glow, typed, usePop, Card, Chip, H2, Cursor, Bar, Rim, Bg, Scene } from './theme';

// 1. boot: the name comes in, ACCESS GRANTED stamp, a beam (Terminal) or a glass lens (Glass) sweeps across
const Boot = () => {
  const T = useT(), f = useCurrentFrame();
  const stamp = usePop(34, 9), name = usePop(2, 14);
  const beam = interpolate(f, [30, 46], [110, -10], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 40 }}>
      {T.glass
        ? <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: `${-0.04 + (1 - name) * 0.3}em`, filter: `blur(${(1 - name) * 20}px)`, opacity: name }}>Fantasy</div>
        : <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: '.14em', textShadow: glow(T, '#ffffff88', 30) }}><span style={{ color: T.muted }}>&gt;</span>{typed('FANTASY', f, 4, 0.45)}<Cursor /></div>}
      <div style={{ transform: `scale(${2 - stamp}) rotate(${(1 - stamp) * -8}deg)`, opacity: stamp }}>
        <Chip c={T.good} style={T.glass ? { fontSize: 38, padding: '14px 34px' } : { fontSize: 40, padding: '12px 28px', borderWidth: 3, boxShadow: `0 0 40px ${T.good}`, textShadow: `0 0 20px ${T.good}` }}>Access granted</Chip>
      </div>
      {T.glass
        ? <Rim style={{ position: 'absolute', top: 760, left: `${beam}%`, width: 260, height: 400, translate: '-50% 0', opacity: f > 30 && f < 47 ? 1 : 0 }} fill="rgba(255,255,255,.06)" />
        : <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${beam}%`, width: 6, background: T.good, boxShadow: `0 0 60px ${T.good}`, opacity: f > 30 && f < 47 ? 1 : 0 }} />}
    </AbsoluteFill>
  );
};

// 2. live matchup: scores count up, win chance bar fills
export const Matchup = () => {
  const T = useT(), f = useCurrentFrame();
  const card = usePop(2), p1 = usePop(8), p2 = usePop(14);
  const n = interpolate(f, [10, 70], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const wp = interpolate(f, [24, 80], [50, 74], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const team = (name, rec, pts, c, p, d) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transform: `translateX(${(1 - p) * (d ? 200 : -200)}px)`, opacity: p }}>
      <div><div style={{ fontSize: 44, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 26, color: T.muted, letterSpacing: T.glass ? 0 : '.1em' }}>{rec}</div></div>
      <div style={{ fontSize: 96, fontWeight: 800, color: c, textShadow: glow(T, c, 24), fontVariantNumeric: 'tabular-nums' }}>{(pts * n).toFixed(1)}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70 }}>
      <Card style={{ transform: `translateY(${(1 - card) * 300}px) scale(${0.8 + card * 0.2})`, opacity: card, display: 'grid', gap: 40, borderColor: '#ffffff59' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: T.glass ? 28 : 22, letterSpacing: T.glass ? 0 : '.2em', color: T.muted }}>{T.glass ? 'Week 8' : 'WEEK 8'}</span>
          <Chip c={T.bad} style={{ opacity: Math.floor(f / 21) % 2 ? 0.25 : 1 }}>● Live</Chip>
        </div>
        {team(T.glass ? 'My Team' : 'MY TEAM', '6-1', 112.4, T.good, p1, 0)}
        <div style={{ height: 2, background: T.line }} />
        {team(T.glass ? 'The Rival' : 'THE RIVAL', '5-2', 96.8, T.fg, p2, 1)}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, marginBottom: 14 }}>
            <span style={{ color: T.muted, letterSpacing: T.glass ? 0 : '.12em' }}>{T.glass ? 'Win chance' : 'WIN CHANCE'}</span>
            <b style={{ color: T.good, textShadow: glow(T, T.good) }}>{Math.round(wp)}%</b>
          </div>
          <Bar w={`${wp}%`} c={T.good} />
        </div>
      </Card>
    </AbsoluteFill>
  );
};

// 3. a live play on the Blender field: deep pass, spiral, touchdown. Field math is the app's gcField camera.
const k = z => 1 / (0.075309 + 0.00064582 * z);
const pt = (x, z, up = 0) => { const s = k(z); return [800 + (x - 60) * s, 402.79 + (s - 13.2787) * 72.0 - up * 0.868 * s]; };
export const Play = () => {
  const T = useT(), f = useCurrentFrame();
  const t = interpolate(f, [14, 62], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const arc = t => 2 + Math.sin(t * Math.PI) * 16 - t * 1.5;
  const x = 62 + t * 52, z = 30 - t * 10;
  const ball = pt(x, z, arc(t)), shadow = pt(x, z), ahead = pt(x + 1, z - 0.2, arc(Math.min(1, t + 0.02)));
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
          <polygon points={ez} fill={T.good} opacity={td ? 0.35 + Math.sin(f / 3) * 0.1 : 0} />
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
        <Chip c={T.bad} style={{ opacity: Math.floor(f / 21) % 2 ? 0.25 : 1 }}>● Live play</Chip>
        <div style={{ marginTop: 30, fontSize: 34, color: T.muted, letterSpacing: T.glass ? 0 : '.1em' }}>{typed(T.glass ? '3rd & 7 · Deep left' : '3RD & 7 · DEEP LEFT', f, 0, 1.2)}</div>
      </div>
      {td && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 380, gap: 26 }}>
          <AbsoluteFill style={{ background: T.good, opacity: interpolate(f, [62, 70], [0.5, 0], clamp) }} />
          <div style={{ fontSize: T.glass ? 140 : 132, fontWeight: 800, color: T.good, letterSpacing: T.glass ? '-.03em' : '.06em', textShadow: T.glass ? '0 10px 40px rgba(0,0,0,.6)' : `0 0 40px ${T.good}, 0 0 90px ${T.good}`, transform: `scale(${tdPop})` }}>{T.glass ? 'Touchdown' : 'TOUCHDOWN'}</div>
          <div style={{ transform: `translateY(${(1 - ptsPop) * 80}px)`, opacity: ptsPop }}><Chip c={T.good} style={{ fontSize: 36 }}>+6.0 pts · your WR</Chip></div>
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
export const Moves = () => {
  const T = useT(), f = useCurrentFrame(), fleece = usePop(44, 8);
  const bar = (at, w) => interpolate(f, [at, at + 25], [0, w], { ...clamp, easing: Easing.out(Easing.cubic) }) + '%';
  const up = s => (T.glass ? s : s.toUpperCase());
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70, gap: 30 }}>
      <Row at={0}><H2>Pickup plan</H2></Row>
      <Row at={4}><Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 34 }}><span style={{ color: T.good }}>{up('+ Add')}</span> R. Rice<div style={{ fontSize: 26, color: T.muted, marginTop: 8 }}><span style={{ color: T.bad }}>{up('− Drop')}</span> bench RB</div></div>
        <Chip c={T.good}>+4.2 / wk</Chip>
      </Card></Row>
      <Row at={14}><H2>Trade ideas</H2></Row>
      <Row at={18}><Card style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 32 }}><span>{up('You give')}</span><span style={{ color: T.muted }}>TE · 9.1</span></div>
        <Bar w={bar(24, 45)} c={T.warn} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 32 }}><span>{up('You get')}</span><span style={{ color: T.muted }}>WR · 14.6</span></div>
        <Bar w={bar(30, 78)} c={T.good} />
        <div style={{ textAlign: 'right', transform: `scale(${fleece})` }}><Chip c={T.good} style={{ fontSize: 30 }}>Fleece</Chip></div>
      </Card></Row>
      <Row at={30}><Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 30 }}>{up('Buy low · Sell high')}</span>
        <span style={{ display: 'flex', gap: 14 }}><Chip c={T.good}>Buy</Chip><Chip c={T.bad}>Sell</Chip></span>
      </Card></Row>
    </AbsoluteFill>
  );
};

// 5. Ask Claude: the question types, the answer streams in
export const Ask = () => {
  const T = useT(), f = useCurrentFrame(), box = usePop(0);
  const q = 'who should i start at flex?';
  const a = 'Start Rice. 18 touches last 2 games and a weak run defense. Bench your TE: 9% of targets.';
  const inner = { border: T.glass ? 0 : `2px solid ${T.line}`, background: T.glass ? '#ffffff0f' : 'none', borderRadius: T.glass ? 28 : 0 };
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 70 }}>
      <Card style={{ transform: `scale(${0.85 + box * 0.15})`, opacity: box, display: 'grid', gap: 30 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Ask Claude about your team</div>
        <div style={{ ...inner, padding: '24px 26px', fontSize: 32 }}>{!T.glass && <span style={{ color: T.muted }}>&gt; </span>}{typed(q, f, 4, 1.4)}{f < 30 && <Cursor />}</div>
        <div style={{ ...inner, border: T.glass ? 0 : `2px solid ${T.good}66`, padding: '26px 28px', fontSize: 31, lineHeight: 1.55, minHeight: 250, boxShadow: T.glass ? 'none' : `0 0 30px #39ff8833`, opacity: f > 26 ? 1 : 0 }}>
          {typed(a, f, 28, 3)}{f > 26 && <Cursor />}
        </div>
        {T.glass && <div style={{ justifySelf: 'end', background: T.accent, color: '#fff', borderRadius: 999, padding: '16px 40px', fontSize: 30, fontWeight: 600 }}>Ask</div>}
      </Card>
    </AbsoluteFill>
  );
};

// 6. outro: helmet pops in on a glow, name
const Outro = () => {
  const T = useT(), f = useCurrentFrame();
  const p = usePop(0, 9), t = usePop(10);
  const halo = T.glass ? '#0a84ff40' : '#39ff8840';
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 50 }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: `radial-gradient(${halo}, transparent 65%)`, transform: `scale(${p})` }} />
      <Img src={staticFile('icon-512.png')} style={{ width: 420, height: 420, borderRadius: 96, transform: `scale(${p}) rotate(${(1 - p) * -25}deg) translateY(${Math.sin(f / 10) * 8}px)`, boxShadow: `0 0 60px ${halo}` }} />
      <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: T.glass ? '-.03em' : '.14em', opacity: t, transform: `translateY(${(1 - t) * 60}px)`, textShadow: glow(T, '#ffffff88', 30) }}>{T.glass ? 'Fantasy' : 'FANTASY'}<Cursor /></div>
    </AbsoluteFill>
  );
};

const SCENES = [[Boot, 0, 66], [Matchup, 60, 96], [Play, 150, 108], [Moves, 252, 96], [Ask, 342, 72], [Outro, 408, 42]];

export const Promo = ({ look }) => {
  const T = look === 'term' ? TERM : GLASS;
  return (
    <Look t={T}>
      <AbsoluteFill style={{ fontFamily: T.font, color: T.fg }}>
        <Bg />
        {SCENES.map(([S, from, len], i) => (
          <Sequence key={i} from={from} durationInFrames={len}>
            {i === SCENES.length - 1 ? <S /> : <Scene len={len}><S /></Scene>}
          </Sequence>
        ))}
      </AbsoluteFill>
    </Look>
  );
};
