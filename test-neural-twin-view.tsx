import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NeuralTwinView } from './src/components/NeuralTwinView';
import { NEURONS, LOBES } from './src/neural/topology';

const html = renderToStaticMarkup(<NeuralTwinView />);
assert.match(html, /App Health Neural Twin/);
assert.match(html, /data-testid="neural-check-digest"/); assert.match(html, /data-testid="neural-jingle"/);
for (const n of NEURONS) assert.ok(html.includes(`data-testid="neuron-${n.id}"`), n.id);
assert.equal((html.match(/data-testid="neuron-/g) ?? []).length, 32);
for (const l of LOBES) assert.ok(html.includes(l.label.replace(/&/g, '&amp;')), l.label);
assert.ok((html.match(/NOT WIRED/g) ?? []).length >= 15, 'unwired parts are labelled');
assert.ok(!/Math\.random/.test(html));
console.log('neural twin view ok');
import { readFileSync } from 'node:fs';
const nav = readFileSync('./src/components/Navigation.tsx', 'utf8');
assert.equal((nav.match(/id: 'dev', label: 'NEURAL TWIN'/g) ?? []).length, 2, 'Neural Twin is in the desktop More menu and the mobile More sheet');
console.log('nav entries ok');
// scene controls: lobe chips (All + 7), auto-orbit toggle that starts off, 460px canvas fallback
assert.match(html, /data-testid="lobe-all"/);
for (const l of LOBES) assert.ok(html.includes(`data-testid="lobe-${l.id}"`), `chip ${l.id}`);
assert.match(html, /data-testid="neural-auto-orbit"[^>]*aria-pressed="false"/);
assert.ok(html.includes('h-[460px]'), 'taller canvas');
console.log('scene controls ok');
