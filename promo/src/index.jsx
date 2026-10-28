import { registerRoot, Composition } from 'remotion';
import { Promo } from './Promo';
import { Angles, ANGLES_LEN } from './Angles';

registerRoot(() => (
  <>
    <Composition id="Promo" component={Promo} defaultProps={{ look: 'glass' }} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="PromoTerminal" component={Promo} defaultProps={{ look: 'term' }} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="Angles" component={Angles} durationInFrames={ANGLES_LEN} fps={30} width={1080} height={1920} />
  </>
));
