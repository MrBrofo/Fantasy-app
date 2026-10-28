// The app's two dark looks as video building blocks: Glass (iOS style) and Terminal (mono, square, glow).
import { createContext, useContext } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { loadFont as mono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as inter } from '@remotion/google-fonts/Inter';

export const GLASS = { glass: true, font: inter().fontFamily, fg: '#fff', muted: 'rgba(235,235,245,.6)', line: 'rgba(84,84,88,.65)', card: 'rgba(30,30,33,.85)', good: '#30d158', warn: '#ff9f0a', bad: '#ff453a', accent: '#0a84ff', r: 52 };
export const TERM = { glass: false, font: mono().fontFamily, fg: '#fff', muted: '#ffffff8c', line: '#ffffff45', card: 'rgba(0,0,0,.78)', good: '#39ff88', warn: '#ffb020', bad: '#ff3b3b', accent: '#39ff88', r: 0 };
const Ctx = createContext(GLASS);
export const Look = ({ t, children }) => <Ctx.Provider value={t}>{children}</Ctx.Provider>;
export const useT = () => useContext(Ctx);

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
// Terminal glows; Glass stays flat unless `soft` asks for a faint halo
export const glow = (T, c, r = 18, soft) => (T.glass ? (soft ? `0 0 ${r}px ${c}66` : 'none') : `0 0 ${r}px ${c}`);
export const typed = (text, f, at, perFrame = 0.7) => text.slice(0, Math.max(0, Math.floor((f - at) * perFrame)));

// springy pop: 0 -> 1 starting at frame `at`
export const usePop = (at, damping = 12) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return spring({ frame: f - at, fps, config: { damping, mass: 0.6 } });
};

export const Card = ({ children, style }) => {
  const T = useT();
  return <div style={{ background: T.card, borderRadius: T.r, border: T.glass ? 0 : `2px solid ${T.line}`, padding: T.glass ? 40 : 36, ...style }}>{children}</div>;
};
export const Chip = ({ c, children, style }) => {
  const T = useT();
  return T.glass
    ? <span style={{ background: c + '29', color: c, borderRadius: 999, padding: '8px 20px', fontSize: 24, fontWeight: 600, ...style }}>{children}</span>
    : <span style={{ border: `2px solid ${c}`, color: c, padding: '6px 14px', fontSize: 22, letterSpacing: '.12em', textTransform: 'uppercase', boxShadow: `0 0 12px ${c}66`, ...style }}>{children}</span>;
};
export const H2 = ({ children, style }) => {
  const T = useT();
  return T.glass
    ? <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-.01em', marginBottom: 20, ...style }}>{children}</div>
    : <div style={{ fontSize: 34, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 24, ...style }}><span style={{ color: T.muted }}>// </span>{children}</div>;
};
export const Cursor = () => {
  const T = useT(), f = useCurrentFrame();
  return T.glass ? null : <span style={{ opacity: Math.floor(f / 15) % 2 ? 0 : 1 }}>_</span>;
};
export const Bar = ({ w, c, h }) => {
  const T = useT();
  return <div style={{ height: h ?? (T.glass ? 12 : 6), borderRadius: 99 * +T.glass, background: '#ffffff1a', overflow: 'hidden' }}><div style={{ height: '100%', width: w, borderRadius: 'inherit', background: c, boxShadow: glow(T, c, 16) }} /></div>;
};

// Glass rim: a 2px gradient frame, brightest top-left and bottom-right, around an almost clear fill (the app's ::before rim)
export const Rim = ({ children, style, fill = 'rgba(20,20,22,.55)', radius = 999 }) => (
  <div style={{ padding: 2, borderRadius: radius, background: 'linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,255,255,.18) 20%,rgba(255,255,255,0) 45%,rgba(255,255,255,0) 60%,rgba(255,255,255,.2) 82%,rgba(255,255,255,.6))', boxShadow: '0 12px 40px rgba(0,0,0,.4)', ...style }}>
    <div style={{ borderRadius: radius, background: fill, height: '100%' }}>{children}</div>
  </div>
);

// ---- backgrounds ----
const Rings = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(#ffffff22 1.5px, transparent 1.6px)', backgroundSize: '36px 36px', backgroundPosition: `0 ${-f * 0.6}px` }} />
      <AbsoluteFill style={{ background: `radial-gradient(60% 40% at 50% ${38 + Math.sin(f / 40) * 4}%, #39ff8818, transparent 70%)` }} />
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 1300, height: 1300, translate: '-50% -50%', border: '2px dashed #ffffff1c', borderRadius: '50%', rotate: `${f * 0.15}deg` }} />
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 860, height: 860, translate: '-50% -50%', border: '2px solid #ffffff14', borderRadius: '50%', rotate: `${-f * 0.6}deg` }}>
        <div style={{ position: 'absolute', top: -6, left: '50%', width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 0 24px #fff' }} />
      </div>
    </AbsoluteFill>
  );
};

// Glass background, like the app: a coach's chalkboard with plays running in three lanes, each a third of a play behind the last.
// O's line up, routes grow with a runner on the tip, X's follow, a blue pass arcs to one receiver.
const ROUTES = [[[0, -16]], [[0, -3], [6, -9]], [[0, -8], [5, -15]], [[0, -7], [-5, -7]], [[0, -9], [1, -7]], [[0, -8], [-5, -14]], [[0, -8], [7, -8]]];
const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const ease = x => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const along = (p, f) => {
  const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1])), total = seg.reduce((a, b) => a + b, 0);
  let left = f * total;
  for (let i = 0; i < seg.length; i++) { if (left <= seg[i]) { const k = seg[i] ? left / seg[i] : 0; return [...p.slice(0, i + 1), [p[i][0] + (p[i + 1][0] - p[i][0]) * k, p[i][1] + (p[i + 1][1] - p[i][1]) * k]]; } left -= seg[i]; }
  return p;
};
const PLAY = 165; // frames, 5.5s like the app
const ChalkPlay = ({ lane, f, w, h, u }) => {
  const cycle = Math.floor(f / PLAY), s = (f % PLAY) / 30, r = rng(lane * 7919 + cycle * 104729 + 1);
  const c = 12 * u + r() * (w - 24 * u), y0 = h * lane;
  const path = (x, y, steps, fl) => [[x, y], ...steps.map(([dx, dy]) => [x + dx * u * fl, y + dy * u])];
  const runners = [[c - 12 * u, 1], [c + 12 * u, -1], [c + 8 * u, -1], [c - 5 * u, 1]].map(([x, fl]) => path(x, y0, ROUTES[Math.floor(r() * ROUTES.length)], fl));
  const qb = [c, y0 + 3.5 * u], d = runners.map(p => [p[0][0] + (r() - 0.5) * 3 * u, y0 - (6 + r() * 5) * u]), to = Math.floor(r() * 4);
  const fade = Math.max(0, Math.min(1, s / 0.4, (5.5 - s) / 0.9)), g = ease((s - 0.5) / 2.2), b = ease((s - 1.7) / 1.1);
  const end = along(runners[to], ease((1.7 + 1.1 - 0.5) / 2.2)).at(-1), ctl = [(qb[0] + end[0]) / 2, Math.min(qb[1], end[1]) - 5 * u];
  const at = k => [(1 - k) ** 2 * qb[0] + 2 * (1 - k) * k * ctl[0] + k * k * end[0], (1 - k) ** 2 * qb[1] + 2 * (1 - k) * k * ctl[1] + k * k * end[1]];
  const arc = [qb]; for (let k = 0.05; k <= b; k += 0.05) arc.push(at(k));
  const ball = at(b), pts = p => p.map(q => q.join(',')).join(' ');
  return (
    <g opacity={fade} fill="none" strokeWidth={3} strokeLinecap="round">
      {[-2, -1, 0, 1, 2].map(i => <circle key={i} cx={c + i * 2 * u} cy={y0} r={u * 0.5} stroke="rgba(255,255,255,.3)" />)}
      <circle cx={qb[0]} cy={qb[1]} r={u * 0.5} stroke="rgba(255,255,255,.3)" />
      {runners.map((p, i) => { const q = along(p, g), tip = q.at(-1); return <g key={i}><polyline points={pts(q)} stroke="rgba(255,255,255,.28)" /><circle cx={tip[0]} cy={tip[1]} r={u * 0.32} fill="#fff" opacity={0.8} style={{ filter: 'drop-shadow(0 0 8px #fff)' }} /></g>; })}
      {d.map(([x, y], i) => { const t = along(runners[i], g).at(-1), X = x + (t[0] - x) * 0.45 * g, Y = y + (t[1] - y) * 0.3 * g, k = u * 0.45; return <path key={i} d={`M${X - k} ${Y - k}L${X + k} ${Y + k}M${X + k} ${Y - k}L${X - k} ${Y + k}`} stroke="rgba(255,255,255,.22)" />; })}
      {b > 0 && <><polyline points={pts(arc)} stroke="rgba(10,132,255,.6)" strokeDasharray="6 12" /><ellipse cx={ball[0]} cy={ball[1]} rx={u * 0.34} ry={u * 0.22} fill="#fff" transform={`rotate(-34 ${ball[0]} ${ball[1]})`} style={{ filter: 'drop-shadow(0 0 14px #0a84ff)' }} /></>}
    </g>
  );
};
export const Chalk = ({ w = 1080, h = 1920, u = 30, lanes = [0.3, 0.6, 0.9] }) => {
  const f = useCurrentFrame();
  return (
    <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
      {lanes.map((l, i) => <ChalkPlay key={i} lane={l} f={f + PLAY - i * 55} w={w} h={h} u={u} />)}
    </svg>
  );
};

export const Bg = () => {
  const T = useT();
  return T.glass ? <AbsoluteFill style={{ background: '#000' }}><Chalk /></AbsoluteFill> : <Rings />;
};

// every scene fades and un-blurs in, then zooms past the camera and blurs out
export const Scene = ({ len, children }) => {
  const f = useCurrentFrame();
  const inn = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [len - 10, len], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={{ opacity: inn * (1 - out), filter: `blur(${(1 - inn) * 14 + out * 18}px)`, transform: `scale(${0.94 + inn * 0.06 + out * 0.12})` }}>
      {children}
    </AbsoluteFill>
  );
};
