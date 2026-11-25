import assert from 'node:assert/strict';
import { isExtensionNoise } from './src/utils/extensionNoise.ts';

assert.equal(isExtensionNoise(null), false, 'null stack is not extension noise');
assert.equal(isExtensionNoise(undefined), false, 'undefined stack is not extension noise');
assert.equal(isExtensionNoise('Error: failed\n    at Object.<anonymous> (/src/App.tsx:10:5)'), false, 'app stack is not extension noise');
assert.equal(isExtensionNoise('Error: failed\n    at n.value (chrome-extension://hoklmmgfnpapgjgcpechhaamimifchmp/frame_ant/frame_ant.js:2:17820)'), true, 'chrome-extension stack is recognized');
assert.equal(isExtensionNoise('Error: failed\n    at foo (moz-extension://abc123/background.js:10:1)'), true, 'moz-extension stack is recognized');
assert.equal(isExtensionNoise('Error: failed\n    at bar (safari-extension://xyz/script.js:5:2)'), true, 'safari-extension stack is recognized');

console.log('test-extension-noise: ok');
