/* Browser harness for the deck's mini panels (MiniRotator) inside a deck-card-width box. Runner: test-mini-panels.mjs. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MiniRotator } from './src/components/MiniRotator';
import './src/index.css';
import './src/radio.css';

const badge = new URLSearchParams(location.search).has('badge');
const long = 'A very long sample episode title that has to stay inside the small box and never spill past the edge of the card at all';
const panels = [
  { key: 'now', label: 'Now playing', content: <div><strong className="line-clamp-2" data-testid="t">{long}</strong><button className="ck-key ck-key--sm" data-testid="inner-btn">-15s</button></div> },
  { key: 'next', label: 'Up next', content: <div>{[1, 2, 3].map((n) => <div key={n} className="truncate">06:0{n} {long}</div>)}</div> },
  { key: 'digest', label: 'Daily Digest', content: <div>{long}</div> },
  { key: 'alerts', label: 'Alerts', content: <div>No new alert hits.</div>, badge },
];
const w = Number(new URLSearchParams(location.search).get('w') || 420);
createRoot(document.getElementById('root')!).render(<div style={{ width: w, padding: 8 }}><MiniRotator panels={panels} /><input aria-label="outside" data-testid="outside" /></div>);
