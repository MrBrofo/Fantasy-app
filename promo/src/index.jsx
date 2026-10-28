import { registerRoot, Composition } from 'remotion';
import { Promo } from './Promo';
import { Angles, ANGLES_LEN } from './Angles';
import { Edit1, E1_LEN, Edit2, E2_LEN } from './Edits';

registerRoot(() => (
  <>
    <Composition id="Promo" component={Promo} defaultProps={{ look: 'glass' }} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="PromoTerminal" component={Promo} defaultProps={{ look: 'term' }} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="Angles" component={Angles} durationInFrames={ANGLES_LEN} fps={30} width={1080} height={1920} />
    <Composition id="Edit1" component={Edit1} durationInFrames={E1_LEN} fps={30} width={1080} height={1920} />
    <Composition id="Edit2" component={Edit2} durationInFrames={E2_LEN} fps={30} width={1080} height={1920} />
  </>
));
