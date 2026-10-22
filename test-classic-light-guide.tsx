import React from 'react';
import { createRoot } from 'react-dom/client';
import EpgGuide from './src/EpgGuide';
import { createClassicLightFixture } from './test-classic-light-guide-fixture';
import './src/index.css';

declare global {
  interface Window {
    __classicLightPlayed?: { src: string; title: string; channelId?: string; programId?: string };
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing browser fixture root');
createRoot(root).render(
  <EpgGuide
    guideId="classic-tv"
    active
    onSelectProgram={(src, title, _channelName, _mediaType, channelId, _guideId, programId) => {
      window.__classicLightPlayed = { src, title, channelId, programId };
    }}
  />,
);
