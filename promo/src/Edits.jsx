// Two beat-synced edits cut from the Angles shots, each copying the feel of a reference video Brody sent.
// Edit1: slow washed-out intro, white flash on the drop, then a cut on every kick (like the F-14 Jolly Rogers edit).
// Edit2: huge bold caption, slow zooms with zoom-blur crossfades, a one-word punch on the hit (like the history edit).
// Cut frames come from the songs' kick drums (ffmpeg lowpass + RMS onsets), 30fps.
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, random, Easing } from 'remotion';
import { loadFont as anton } from '@remotion/google-fonts/Anton';
import { loadFont as marker } from '@remotion/google-fonts/PermanentMarker';
import { GLASS, Look, Bg, clamp, usePop } from './theme';
import { Matchup, Play } from './Promo';
import { Screen } from './screens';
import { Flatten, Side, Fly, Orbit, Wall, Flip, Macro, Tabs, Board, Field3D, Alert, Carousel, Fan, Tour, Sheet } from './Angles';

const ANTON = anton().fontFamily, MARKER = marker().fontFamily;

// show frames [off, off+len) of a shot at timeline [at, at+len); `fx(t, len)` styles the clip from its own frame t
const Clip = ({ at, len, S, off = 0, fx }) => (
  <Sequence from={at} durationInFrames={len}>
    <ClipBody len={len} fx={fx}><Sequence from={-off}><S /></Sequence></ClipBody>
  </Sequence>
);
const ClipBody = ({ len, fx, children }) => {
  const t = useCurrentFrame();
  return <AbsoluteFill style={fx ? fx(t, len) : undefined}>{children}</AbsoluteFill>;
};

// film grain: fresh noise every frame
const Grain = ({ amount = 0.14 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ mixBlendMode: 'overlay', opacity: amount, pointerEvents: 'none' }}>
      <svg width="100%" height="100%"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f} /><feColorMatrix type="saturate" values="0" /></filter><rect width="100%" height="100%" filter="url(#g)" /></svg>
    </AbsoluteFill>
  );
};
const Flash = ({ at, len = 8, peak = 1 }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: '#fff', opacity: f < at ? 0 : interpolate(f, [at, at + len], [peak, 0], clamp), pointerEvents: 'none' }} />;
};
// handheld drift: a few slow sines, so it never repeats inside a clip
const shake = (f, amp) => `translate(${(Math.sin(f / 7.3) + Math.sin(f / 3.1) * 0.4) * amp}px, ${(Math.cos(f / 6.1) + Math.sin(f / 2.7) * 0.4) * amp}px) rotate(${Math.sin(f / 11) * amp * 0.06}deg)`;

const EndCard = ({ handle }) => {
  const f = useCurrentFrame(), p = usePop(0, 10), t = usePop(8);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 50, background: '#000' }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(#0a84ff40, transparent 65%)', transform: `scale(${p})` }} />
      <Img src={staticFile('icon-512.png')} style={{ width: 400, height: 400, borderRadius: 92, transform: `scale(${p}) rotate(${(1 - p) * -20}deg) translateY(${Math.sin(f / 10) * 8}px)` }} />
      <div style={{ fontFamily: GLASS.font, fontSize: 110, fontWeight: 800, letterSpacing: '-.03em', color: '#fff', opacity: t, transform: `translateY(${(1 - t) * 50}px)` }}>{handle || 'Fantasy'}</div>
    </AbsoluteFill>
  );
};

// ================= Edit 1 =================
const HelmetClose = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <Img src={staticFile('icon-512.png')} style={{ width: 1300, height: 1300, objectFit: 'cover', transform: `scale(${1.1 + f * 0.004}) rotate(${-4 + f * 0.08}deg) translateX(${-80 + f * 1.2}px)`, filter: 'blur(1px)' }} />
    </AbsoluteFill>
  );
};
// the drop: name comes up in a thin box, like the squadron title in the reference
const Title = () => {
  const f = useCurrentFrame(), w = interpolate(f, [2, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', background: '#000' }}>
      <div style={{ padding: '18px 40px', border: '3px solid #fff', clipPath: `inset(0 ${(1 - w) * 50}% 0 ${(1 - w) * 50}%)`, fontFamily: GLASS.font, fontSize: 84, fontWeight: 800, letterSpacing: '.18em', color: '#fff' }}>FANTASY</div>
      <div style={{ marginTop: 26, fontFamily: GLASS.font, fontSize: 30, letterSpacing: '.5em', color: '#ffffffaa', opacity: w }}>WEEK 8</div>
    </AbsoluteFill>
  );
};
// hand-drawn "W" and a circle, like the scribbled COOL in the reference
const Doodle = () => {
  const f = useCurrentFrame(), d = n => interpolate(f, [n, n + 10], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={1080} height={1920} fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M170 1260 Q300 1150 520 1170 Q860 1190 900 1300 Q930 1420 540 1440 Q180 1450 160 1330 Q155 1280 230 1230" pathLength={1} strokeDasharray={1} strokeDashoffset={d(2)} />
        <path d="M330 1560 L380 1720 L430 1600 L480 1720 L530 1560" pathLength={1} strokeDasharray={1} strokeDashoffset={d(10)} />
        <path d="M600 1700 Q700 1640 720 1520" pathLength={1} strokeDasharray={1} strokeDashoffset={d(16)} />
        <path d="M690 1555 L722 1515 L752 1560" pathLength={1} strokeDasharray={1} strokeDashoffset={d(22)} />
      </svg>
    </AbsoluteFill>
  );
};
const DROP = 159;
const E1 = [[0, 55, Macro, 20], [55, 110, Board, 10], [110, 159, HelmetClose, 0], [159, 182, Title, 0],
  [182, 194, Play, 40], [194, 209, Play, 52], [209, 225, Play, 62], [225, 236, Play, 72], [236, 251, Flip, 35], [251, 267, Carousel, 20],
  [267, 282, Fly, 45], [282, 302, Fly, 62], [302, 320, Tour, 44], [320, 341, Fan, 30], [341, 362, Fan, 100], [362, 384, Orbit, 50],
  [384, 405, Sheet, 28], [405, 425, Side, 25], [425, 441, Wall, 40], [441, 457, Alert, 36], [457, 478, Field3D, 60], [478, 499, Tabs, 15],
  [499, 521, Tour, 132], [521, 541, Flatten, 70], [541, 562, Macro, 90], [562, 594, EndCard, 0]];
export const E1_LEN = 594;

export const Edit1 = () => {
  const f = useCurrentFrame(), intro = f < DROP;
  // every cut after the drop punches in a little
  const cut = E1.findLast(([a]) => a <= f)?.[0] ?? 0, punch = intro ? 1 : interpolate(f - cut, [0, 5], [1.1, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  return (
    <Look t={GLASS}>
      <AbsoluteFill style={{ background: '#000', fontFamily: GLASS.font, color: '#fff' }}>
        <AbsoluteFill style={{ transform: `${shake(f, intro ? 6 : 3)} scale(${punch * 1.04})`, filter: intro ? 'saturate(.3) contrast(1.15) brightness(1.1)' : 'saturate(.9) contrast(1.12)' }}>
          <Bg />
          {E1.map(([a, b, S, off]) => <Clip key={a} at={a} len={b - a} S={S} off={off} />)}
          <AbsoluteFill style={{ background: '#fff', opacity: intro ? 0.16 : 0.04 }} />
        </AbsoluteFill>
        <Sequence from={209} durationInFrames={27}><Doodle /></Sequence>
        {f >= 182 && f < 562 && <Img src={staticFile('icon-192.png')} style={{ position: 'absolute', left: 50, top: 80, width: 120, height: 120, borderRadius: '50%', border: '4px solid #fff', boxShadow: '0 4px 20px #000' }} />}
        <AbsoluteFill style={{ background: 'radial-gradient(transparent 55%, #000c)' }} />
        <Grain amount={intro ? 0.22 : 0.14} />
        <Flash at={DROP} len={10} />
        {[209, 320, 425, 521].map(a => <Flash key={a} at={a} len={5} peak={0.4} />)}
        <Audio src={staticFile('ref/song1.m4a')} />
      </AbsoluteFill>
    </Look>
  );
};

// ================= Edit 2 =================
const LeagueZoom = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill><div style={{ position: 'absolute', left: '50%', top: '50%', transform: `scale(${1.05 + f * 0.006}) translateY(${-120 + f * 2}px)` }}><Screen page="league" /></div></AbsoluteFill>;
};
const HIT = 186;
const E2 = [[0, 33, Matchup, 75], [33, 64, Board, 0], [64, 97, Macro, 60], [97, 128, Side, 60], [128, 153, Orbit, 60], [153, 186, Carousel, 40],
  [186, 215, Play, 50], [215, 246, Sheet, 20], [246, 276, Tour, 0], [276, 301, Flip, 30], [301, 329, Alert, 30], [329, 358, Fly, 50],
  [358, 379, Wall, 20], [379, 410, LeagueZoom, 0], [410, 435, Field3D, 70]];
export const E2_LEN = 494;
const X = 6; // crossfade frames: each clip runs this much past its cut, under the next one fading in

// zoom-blur in, slow push the whole time, fade out under the next clip
const whip = (t, len) => {
  const inn = interpolate(t, [0, X], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }), out = interpolate(t, [len - X, len], [1, 0], clamp);
  return { opacity: Math.min(inn, out), transform: `scale(${(1.28 - inn * 0.28) * (1 + t * 0.0025)}) rotate(${(1 - inn) * 3}deg)`, filter: `blur(${(1 - inn) * 22}px) sepia(.22) saturate(.85) contrast(1.08)` };
};
const Caption = ({ lines, size = 96 }) => (
  <div style={{ position: 'absolute', top: 640, width: '100%', padding: '0 50px', textAlign: 'center', fontFamily: ANTON, fontSize: size, lineHeight: 1.02, color: '#fff', textTransform: 'uppercase', textShadow: '0 5px 0 #000, 0 0 30px #000a', WebkitTextStroke: '2px #000' }}>
    {lines.map(l => <div key={l}>{l}</div>)}
  </div>
);

export const Edit2 = ({ handle = '@fantasy.' }) => {
  const f = useCurrentFrame();
  const punch = interpolate(f, [HIT, HIT + 4], [1.6, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  return (
    <Look t={GLASS}>
      <AbsoluteFill style={{ background: '#000', fontFamily: GLASS.font, color: '#fff' }}>
        <Bg />
        {E2.map(([a, b, S, off], i) => <Clip key={a} at={a} len={b - a + (i < E2.length - 1 ? X : 0)} S={S} off={off} fx={whip} />)}
        <AbsoluteFill style={{ background: 'radial-gradient(transparent 45%, #000d)' }} />
        {f >= 6 && f < HIT && <Caption lines={['Rivals trying to take', 'your waivers, fleece', 'and conquer.']} />}
        {f >= HIT && f < HIT + 22 && <div style={{ transform: `scale(${punch})` }}><Caption lines={['Win it all.']} size={150} /></div>}
        <Flash at={HIT} len={6} peak={0.9} />
        <Sequence from={435} durationInFrames={24}><EndCard /></Sequence>
        {f >= 459 && <AbsoluteFill style={{ background: '#000', justifyContent: 'center', alignItems: 'center', fontFamily: GLASS.font, fontSize: 92, fontWeight: 500, opacity: interpolate(f, [459, 465], [0, 1], clamp) }}>{handle}</AbsoluteFill>}
        <Grain amount={0.1} />
        <Audio src={staticFile('ref/song2.m4a')} />
      </AbsoluteFill>
    </Look>
  );
};
