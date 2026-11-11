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
