import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelLogo } from './src/components/ChannelLogo';
import { LazyThumb } from './src/components/LazyThumb';
import { Thumb } from './src/components/Thumb';
import { thumbnailLaneStats } from './src/utils/thumbnailLane';

declare global {
  interface Window {
    __thumbnailLaneStats: typeof thumbnailLaneStats;
  }
}

window.__thumbnailLaneStats = thumbnailLaneStats;

function Fixture() {
  const [showLazy, setShowLazy] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1>Synthetic thumbnail lane fixture</h1>
      <div data-testid="logo-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 48px)', gap: 8 }}>
        {Array.from({ length: 40 }, (_, index) => (
          <ChannelLogo
            key={index}
            logo={`/__synthetic/image/${index}`}
            name={`Synthetic channel ${index}`}
            fallback={<span>fallback</span>}
          />
        ))}
      </div>
      <button type="button" data-testid="media-probe" onClick={() => void fetch('/__synthetic/media')}>Issue synthetic media request</button>
      <button type="button" data-testid="start-lazy" onClick={() => setShowLazy(true)}>Start lazy thumbnail</button>
      <button type="button" data-testid="start-failure" onClick={() => setShowFailure(true)}>Start forced failure</button>
      {showLazy && <LazyThumb input={{ guideId: 'science-documentaries' }} title="Synthetic lazy item" className="h-12 w-20" />}
      {showFailure && <Thumb input={{ guideId: 'classic-tv' }} title="Synthetic Failure" className="h-12 w-20" />}
      <div style={{ marginTop: 2_000 }}>
        <LazyThumb input={{ guideId: 'live-tv' }} title="Offscreen thumbnail" className="h-12 w-20" />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
