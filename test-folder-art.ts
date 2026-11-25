import assert from 'node:assert';
import { parseDownloadPath, pickImages, folderOf } from './server/folderArt.ts';
assert.deepEqual(parseDownloadPath('/download/id.7z/A/B/t.mp3'), { id: 'id.7z', file: 'A/B/t.mp3' });
assert.equal(parseDownloadPath('/download/x/../y'), null);
assert.equal(parseDownloadPath('/etc/passwd'), null);
assert.equal(folderOf('A/B/t.mp3'), 'A/B');
const idx = new Map([['A/B', [{ name: 'z.jpg', size: 50000 }, { name: 'cover.jpg', size: 9000 }, { name: 'a.png', size: 70000 }, { name: 'b.png', size: 1e5 }]], ['A', [{ name: 'parent.jpg', size: 9999 }]]]);
assert.deepEqual(pickImages(idx, 'A/B/t.mp3'), { folder: 'A/B', names: ['cover.jpg', 'b.png', 'a.png'] });
assert.deepEqual(pickImages(idx, 'A/B/CD1/t.mp3'), { folder: 'A/B', names: ['cover.jpg', 'b.png', 'a.png'] }); // parent hop
assert.equal(pickImages(idx, 'A/B/CD1/CD2/t.mp3'), null);        // never searches further up
assert.equal(pickImages(new Map([['', [{ name: 'root.jpg', size: 9999 }]]]), 'x.mp3'), null); // item root is never used
console.log('PASS folder-art');
