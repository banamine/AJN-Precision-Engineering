/* Browser harness: the source prism at phone width. Runner: test-prism-compact.mjs. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SourcePrism3D, type AudioSourceType } from './src/components/SourcePrism3D';
import './src/index.css';
import './src/radio.css';
const w = Number(new URLSearchParams(location.search).get('w') || 340);
function App() { const [s, setS] = useState<AudioSourceType>('radio'); return <div style={{ width: w, padding: 6 }}><SourcePrism3D activeSource={s} onSelectSource={setS} nowPlaying={null} /></div>; }
createRoot(document.getElementById('root')!).render(<App />);
