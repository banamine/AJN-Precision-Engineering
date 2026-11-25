import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OnAirCaptions, { archivePathOf } from './OnAirCaptions';
import { parseProgramRef } from '../news/captions/captionTrack';

const id = 'CNNW_20261120_050000_CNN_Newsroom';
const path = `/download/${id}/${id}.mp4`;
assert.equal(archivePathOf(`/api/archive/proxy?path=${encodeURIComponent(path)}`), path);
assert.equal(parseProgramRef(archivePathOf(`/api/archive/proxy?path=${encodeURIComponent(path)}`))?.id, id);
assert.equal(archivePathOf(undefined), undefined);
assert.equal(archivePathOf(path), path);
// A non-news file is not a TV News program: captions stay off.
assert.equal(parseProgramRef(archivePathOf('/api/archive/proxy?path=%2Fdownload%2Fx%2Fa.mp4')), null);

const h = (s: any) => renderToStaticMarkup(createElement(OnAirCaptions, { state: s }));
assert.equal(h({ phase: 'off' }), '');
assert.match(h({ phase: 'none' }), /No captions for this clip/);
assert.match(h({ phase: 'error', reason: 'plan HTTP 502' }), /plan HTTP 502/);
const ready = h({ phase: 'ready', kind: 'cc5', label: 'Broadcast closed captions', current: { start: 1, end: 3, text: 'Good evening.' }, before: [{ start: 0, end: 1, text: 'Earlier line.' }], waiting: false });
assert.match(ready, /Broadcast closed captions/); assert.match(ready, /Good evening\./); assert.match(ready, /Earlier line\./);
console.log('onAirCaptions OK');
