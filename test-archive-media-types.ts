import assert from 'node:assert/strict';
import { archiveProxyContentType } from './server/archiveMediaTypes.ts';
assert.equal(archiveProxyContentType('/download/x/a.m4a', 'application/octet-stream'), 'audio/mp4');
assert.equal(archiveProxyContentType('/download/x/a.AAC?x=1', 'application/octet-stream; charset=x'), 'audio/aac');
assert.equal(archiveProxyContentType('/download/x/a.mp3', 'application/octet-stream'), 'application/octet-stream');
assert.equal(archiveProxyContentType('/download/x/a.m4a', 'audio/mpeg'), 'audio/mpeg');
assert.equal(archiveProxyContentType('/download/x/a.m4a', null), null);
console.log('archive proxy content-type correction: all passed');
