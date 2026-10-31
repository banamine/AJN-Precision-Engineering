import assert from 'node:assert/strict';
import { archiveUpstreamPathname, toArchiveUpstreamUrl, validateArchivePath } from './server/archivePathEncoding.ts';

const sample = '/download/id/a#b?c%d e/Фильм.mp4';
const checked = validateArchivePath(sample);
assert.deepEqual(checked, {
  valid: true,
  cleanPath: '/download/id/a#b?c%d e/Фильм.mp4',
});
const fixed = new URL(toArchiveUpstreamUrl(checked.cleanPath!));
assert.equal(
  fixed.pathname,
  '/download/id/a%23b%3Fc%25d%20e/%D0%A4%D0%B8%D0%BB%D1%8C%D0%BC.mp4',
);
assert.equal(fixed.hash, '');
assert.equal(fixed.search, '');

// Reproduction of the old inline construction in server.ts: a raw # became a
// fragment delimiter, truncating the upstream request path.
const oldUrl = new URL(`https://archive.org${sample}`);
assert.equal(oldUrl.pathname, '/download/id/a');
assert.equal(oldUrl.hash, '#b?c%d%20e/%D0%A4%D0%B8%D0%BB%D1%8C%D0%BC.mp4');

const rawCyrillic = '/download/id/Films/Фильм №1.mp4';
const encodedCyrillic = '/download/id/Films/%D0%A4%D0%B8%D0%BB%D1%8C%D0%BC%20%E2%84%961.mp4';
assert.equal(toArchiveUpstreamUrl(rawCyrillic), toArchiveUpstreamUrl(encodedCyrillic));
assert.equal(toArchiveUpstreamUrl('/download/id/a b.mp4'), toArchiveUpstreamUrl('/download/id/a%20b.mp4'));
assert.equal(toArchiveUpstreamUrl('/download/id/100%25.mp4'), 'https://archive.org/download/id/100%25.mp4');
assert.equal(toArchiveUpstreamUrl('/download/id/Vol...1.mp4'), 'https://archive.org/download/id/Vol...1.mp4');

const special = new URL(toArchiveUpstreamUrl("/download/id/[Part] (Live) @home & tea + O'Brien.mp4"));
assert.equal(
  special.pathname,
  "/download/id/%5BPart%5D%20(Live)%20%40home%20%26%20tea%20%2B%20O'Brien.mp4",
);

assert.equal(
  toArchiveUpstreamUrl('/download/id/clip.mp4?exact=1&start=0&end=282'),
  'https://archive.org/download/id/clip.mp4?exact=1&start=0&end=282',
);
assert.equal(
  toArchiveUpstreamUrl('/download/id/clip.mp4?t=60/90&ignore=x.mp4'),
  'https://archive.org/download/id/clip.mp4?t=60/90&ignore=x.mp4',
);
assert.equal(
  toArchiveUpstreamUrl('/download/id/name?part=2.mp4'),
  'https://archive.org/download/id/name%3Fpart%3D2.mp4',
);
assert.equal(
  archiveUpstreamPathname('/download/id/movie%3Fname.mp4?start=0&end=30'),
  '/download/id/movie%3Fname.mp4',
);
assert.equal(archiveUpstreamPathname('/download/id/a.AAC?x=1'), '/download/id/a.AAC%3Fx%3D1');

for (const path of [
  '/download/id/../secret.mp4',
  '/download/id/%2e%2e/secret.mp4',
  '/download/id/%2E/secret.mp4',
  '/download/id/a%2Fb.mp4',
  '/download/id/a%5Cb.mp4',
]) {
  assert.equal(validateArchivePath(path).valid, false, `must reject ${path}`);
}

assert.equal(
  validateArchivePath('/123/items/id/Film%20One.mp4').cleanPath,
  '/download/id/Film One.mp4',
);
assert.equal(
  validateArchivePath('/download/id/file.mp4?exact=1&start=60&end=90').cleanPath,
  '/download/id/file.mp4?exact=1&start=60&end=90',
);
assert.equal(validateArchivePath('/download/id/file.mp4?unknown=1').cleanPath, '/download/id/file.mp4?unknown=1');
assert.equal(
  toArchiveUpstreamUrl('/download/id/file.mp4?unknown=1'),
  'https://archive.org/download/id/file.mp4%3Funknown%3D1',
);
assert.equal(
  validateArchivePath('/download/id/movie%3Fname.mp4?start=0&end=30').cleanPath,
  '/download/id/movie?name.mp4?start=0&end=30',
);

console.log('archive path encoding regression: all cases passed');
