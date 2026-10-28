import { registerRoot, Composition } from 'remotion';
import { Promo } from './Promo';

registerRoot(() => (
  <Composition id="Promo" component={Promo} durationInFrames={450} fps={30} width={1080} height={1920} />
));
