import React from 'react';
import { createRoot } from 'react-dom/client';
import EpgGuide from './src/EpgGuide';
import './src/index.css';

declare global {
  interface Window {
    __audioLightPlayed?: { src: string; title: string; channelId?: string; programId?: string };
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing browser fixture root');
const header = document.createElement('h1');
header.textContent = 'DEMO — synthetic audio schedule';
header.className = 'px-4 py-2 text-sm font-bold text-neutral-100';
root.before(header);
createRoot(root).render(
  <EpgGuide
    guideId="audio-podcasts"
    active
    onSelectProgram={(src, title, _channelName, _mediaType, channelId, _guideId, programId) => {
      window.__audioLightPlayed = { src, title, channelId, programId };
    }}
  />,
);
