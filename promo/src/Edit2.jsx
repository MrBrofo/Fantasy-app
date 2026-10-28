// Edit 2, in the style of the history edit Brody sent: words land on the kicks, slow zooms with zoom-blur crossfades,
// punch lines on the hits, and a short caption on each feature.
// Song: Brody's longer recording slowed to 0.8x (same speed and pitch as the short clip), bass boosted, starting where the
// short clip did. Frames 0-494 match the short clip; the rest follows the kicks to the "ow" chops at 31.4s, then fades.
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { loadFont as interTight } from '@remotion/google-fonts/InterTight';
import { GLASS, Look, Bg, clamp, usePop } from './theme';
import { Matchup, Play } from './Promo';
import { Screen } from './screens';
import { Side, Fly, Orbit, Wall, Flip, Macro, Tabs, Board, Field3D, Alert, Carousel, Fan, Tour, Sheet } from './Angles';
import { Grain, Flash } from './Edits';

const SANS = interTight('normal', { weights: ['800', '900'] }).fontFamily;

// a page of the app, drifting slowly toward you in a slight tilt
const page = p => () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ perspective: 1800 }}><div style={{ position: 'absolute', left: '50%', top: '50%', transform: `scale(${0.92 + f * 0.004}) rotateX(${8 - f * 0.12}deg) rotateY(${-10 + f * 0.25}deg) translateY(${40 - f * 1.5}px)` }}><Screen page={p} /></div></AbsoluteFill>;
};
const [Moves, Trades, Team, Season, AskP, League] = ['moves', 'trades', 'team', 'season', 'ask', 'league'].map(page);

// [from, to, shot, offset into it, caption, caption delay]
const CLIPS = [[0, 33, Matchup, 75], [33, 64, Board, 0], [64, 97, Macro, 60], [97, 128, Side, 60], [128, 153, Orbit, 60], [153, 186, Carousel, 40],
  [186, 215, Play, 50, 'live plays while you watch', 10], [215, 246, Sheet, 20, 'tap any player'],
  [246, 276, Tour, 0, 'whole league in one app'], [276, 301, Flip, 30, 'two looks'],
  [301, 329, Alert, 30, 'pings you when you score'], [329, 358, Fly, 50, 'live win odds'],
  [358, 379, Wall, 20], [379, 410, League, 0, null], [410, 435, Field3D, 70, 'the game drawn out live'],
  [435, 482, Moves, 0, 'tells you who to pick up'], [482, 530, Trades, 0, 'finds trades that fleece ppl'],
  [530, 577, Team, 0, 'who to start'], [577, 614, Season, 0, 'your playoff odds'],
  [614, 649, Fan, 60], [649, 703, AskP, 0, 'ask it anything about your team', 22],
  [703, 750, Orbit, 40, "finds who'll overpay"], [750, 788, Macro, 40, 'lucky or actually good'],
  [788, 838, Tabs, 10, 'all in 5 tabs'], [838, 879, Carousel, 60], [879, 908, Fly, 40], [908, 941, Wall, 60]];
const END = 941; // the ows start: end card from here, fading out with the song
export const E2_LEN = 1029;
const X = 8; // crossfade frames: each clip runs this much past its cut, under the next one fading in
const HITS = [186, 246, 270, 329, 379, 435, 649, 838, 941]; // the song's biggest hits: shake, flash, light leak
const sinceHit = f => { const h = HITS.findLast(a => a <= f); return h === undefined ? 99 : f - h; };
const ease = (f, a, b) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

// one clip, the reference's way but lighter: a soft-edged copy behind a sharp centre, a little warmth,
// and on the way in a zoom-blur whip with trailing copies, blended like a double exposure over the last clip
const Clip = ({ at, len, S, off }) => (
  <Sequence from={at} durationInFrames={len}><Body len={len} shot={<Sequence from={-off}><S /></Sequence>} /></Sequence>
);
const Body = ({ len, shot }) => {
  const t = useCurrentFrame();
  const inn = ease(t, 0, X), out = interpolate(t, [len - X, len], [1, 0], clamp);
  const sharp = 'radial-gradient(ellipse 78% 66% at 50% 47%, #000 62%, transparent 100%)';
  return (
    <AbsoluteFill style={{ opacity: Math.min(inn, out), mixBlendMode: inn < 1 ? 'screen' : 'normal', transform: `scale(${(1.3 - inn * 0.3) * (1 + t * 0.0025)}) rotate(${(1 - inn) * 4}deg)`, filter: `blur(${(1 - inn) * 12}px) sepia(.12) saturate(.94) contrast(1.06)` }}>
      <AbsoluteFill style={{ filter: 'blur(8px)', transform: 'scale(1.05)' }}>{shot}</AbsoluteFill>
      <AbsoluteFill style={{ WebkitMaskImage: sharp, maskImage: sharp }}>{shot}</AbsoluteFill>
      {inn < 1 && [1, 2].map(k => <AbsoluteFill key={k} style={{ opacity: 0.3 / k, transform: `scale(${1 + (1 - inn) * 0.14 * k})` }}>{shot}</AbsoluteFill>)}
    </AbsoluteFill>
  );
};
// warm light leaks drifting across, flaring on each hit
const Leak = () => {
  const f = useCurrentFrame(), s = sinceHit(f), flare = s < 14 ? (1 - s / 14) * 0.3 : 0;
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: 0.08 + flare, pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: `radial-gradient(40% 30% at ${20 + Math.sin(f / 37) * 25}% ${30 + Math.cos(f / 29) * 20}%, #ff8a3c, transparent 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(35% 28% at ${80 + Math.cos(f / 31) * 20}% ${75 + Math.sin(f / 41) * 15}%, #ff3c7a, transparent 70%)` }} />
    </AbsoluteFill>
  );
};
// the big helmet faded in over the shots, like the ghosted portrait in the reference
const Ghost = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', mixBlendMode: 'screen', opacity: interpolate(f, [0, 10, 40, 54], [0, 0.14, 0.14, 0], clamp) }}>
    <Img src={staticFile('icon-512.png')} style={{ width: 1500, height: 1500, filter: 'grayscale(1) contrast(1.3)', transform: `scale(${1 + f * 0.004}) rotate(${f * 0.05}deg)` }} />
  </AbsoluteFill>;
};

// ---- text ----
// one word rising out of a slot: slides up, unblurs, letters pull in tight
const Word = ({ w, at, f }) => {
  const p = ease(f, at, at + 9);
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', padding: '0 .14em', margin: '0 -.04em' }}>
      <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 105}%)`, filter: `blur(${(1 - p) * 10}px)`, letterSpacing: `${(1 - p) * 0.25 - 0.03}em` }}>{w}</span>
    </span>
  );
};
// the intro line: words come in on the kicks
const Lines = ({ lines, words, size = 104, top = 580 }) => {
  const f = useCurrentFrame();
  let n = 0;
  return (
    <div style={{ position: 'absolute', top, width: '100%', padding: '0 60px', textAlign: 'center', fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 1.0, color: '#fff', textShadow: '0 8px 40px #000c' }}>
      {lines.map(l => <div key={l}>{l.split(' ').map(w => <Word key={w} w={w} at={words[n++]} f={f} />)}</div>)}
    </div>
  );
};
// a punch: one short line that lands hard on a hit (tracking snaps in, zooms down from big, blurs off at the end)
const Punch = ({ at, len, text, size = 170 }) => {
  const f = useCurrentFrame(), t = f - at;
  if (t < 0 || t >= len) return null;
  const p = interpolate(t, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) }), out = ease(t, len - 6, len), q = Math.min(1, p);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: `${(1 - q) * 0.3 - 0.04}em`, color: '#fff', textAlign: 'center', padding: '0 40px', transform: `scale(${1.5 - p * 0.5 + out * 0.08}) translateY(${-out * 40}px)`, filter: `blur(${(1 - q) * 18 + out * 14}px)`, opacity: 1 - out, textShadow: `${(1 - q) * -10}px 0 #ff2a5a, ${(1 - q) * 10}px 0 #2ae0ff, 0 10px 50px #000d` }}>{text}</div>
    </AbsoluteFill>
  );
};
// a feature caption, low on the screen: one short line rises in, then floats up and out before the cut
const Cap = ({ at, len, text }) => {
  const f = useCurrentFrame(), t = f - at;
  if (t < 0 || t >= len) return null;
  const b = ease(t, 2, 12), out = ease(t, len - 7, len - 1);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1600, padding: '0 60px', textAlign: 'center', opacity: 1 - out, transform: `translateY(${-out * 24}px)`, filter: `blur(${out * 8}px)`, textShadow: '0 6px 30px #000' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 66, letterSpacing: '-.025em', color: '#fff', transform: `translateY(${(1 - b) * 100}%)`, filter: `blur(${(1 - b) * 8}px)` }}>{text}</div>
      </div>
    </div>
  );
};
// the end: helmet and name, riding the ows, then fading to black with the song
const End = () => {
  const f = useCurrentFrame(), p = usePop(0, 10), n = ease(f, 8, 22), fade = ease(f, 48, 86);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 40, background: '#000', opacity: 1 - fade }}>
      <div style={{ position: 'absolute', width: 1000, height: 1000, borderRadius: '50%', background: 'radial-gradient(#0a84ff38, transparent 65%)', transform: `scale(${p * (1 + Math.sin(f / 6) * 0.04)})` }} />
      <Img src={staticFile('icon-512.png')} style={{ width: 380, height: 380, borderRadius: 88, transform: `scale(${p * (1 + f * 0.0015)}) rotate(${(1 - p) * -20}deg)` }} />
      <div style={{ overflow: 'hidden' }}><div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 140, letterSpacing: `${(1 - n) * 0.3 - 0.045}em`, color: '#fff', transform: `translateY(${(1 - n) * 100}%)`, filter: `blur(${(1 - n) * 10}px)` }}>gameday</div></div>
    </AbsoluteFill>
  );
};

export const Edit2 = () => {
  const f = useCurrentFrame(), s = sinceHit(f);
  const kick = s < 12 ? (1 - s / 12) : 0;
  const shakeHit = `translate(${Math.sin(f * 2.7) * kick * 18}px, ${Math.cos(f * 3.3) * kick * 14}px) scale(${1 + kick * 0.03})`;
  return (
    <Look t={GLASS}>
      <AbsoluteFill style={{ background: '#000', fontFamily: SANS, color: '#fff', overflow: 'hidden' }}>
        <AbsoluteFill style={{ transform: shakeHit }}>
          <Bg />
          {CLIPS.map(([a, b, S, off], i) => <Clip key={a} at={a} len={b - a + (i < CLIPS.length - 1 ? X : 0)} S={S} off={off} />)}
          <Sequence from={276} durationInFrames={54}><Ghost /></Sequence>
          <Sequence from={838} durationInFrames={54}><Ghost /></Sequence>
          <AbsoluteFill style={{ background: 'rgba(255,150,60,.05)', mixBlendMode: 'soft-light' }} />
          <AbsoluteFill style={{ background: 'radial-gradient(transparent 55%, #000a)' }} />
          <AbsoluteFill style={{ background: 'linear-gradient(transparent 66%, #000d 90%)' }} />
          <Leak />
          {f >= 3 && f < 182 && <Lines lines={['my league really', 'thought they could', 'fleece me']} words={[3, 9, 17, 27, 33, 47, 64, 73]} />}
          <Punch at={186} len={24} text="not today" />
          <Punch at={379} len={30} text="6-1 btw" />
          <Punch at={649} len={22} text="it even has ai" size={120} />
          <Punch at={838} len={38} text="gameday" size={190} />
          {CLIPS.filter(c => c[4]).map(([a, b, , , text, d = 0]) => <Cap key={a} at={a + d} len={b - a - d} text={text} />)}
        </AbsoluteFill>
        <Sequence from={END}><End /></Sequence>
        {HITS.map(a => <Flash key={a} at={a} len={6} peak={[186, 379, 649, 838].includes(a) ? 0.75 : 0.35} />)}
        <Grain amount={0.07} />
        <Audio src={staticFile('ref/song2long.m4a')} />
      </AbsoluteFill>
    </Look>
  );
};
