import assert from 'node:assert/strict';
import { CITY_CATEGORIES, LICENSE_OK, subScore, createCityPhotoService, photoFromPage, pickPhoto } from './cityPhotos';

const page = (o: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({ title: 'File:Skyline.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/960px-Skyline.jpg', width: 4000, height: 2000, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Skyline.jpg', extmetadata: { LicenseShortName: { value: meta.lic ?? 'CC BY 4.0' }, Artist: { value: meta.artist ?? '<a href="x">Jane &amp; Co</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' } }, ...o }] });
// licence allowlist: exact identifiers
for (const ok of ['CC0', 'CC0 1.0', 'Public domain', 'PD-USGov', 'CC BY 4.0', 'CC BY 2.0', 'CC BY 3.0 us']) assert.ok(LICENSE_OK.test(ok), ok);
for (const bad of ['CC BY-SA 4.0', 'CC BY-NC 4.0', 'GFDL', 'Fair use', '', 'CC BY', 'Attribution']) assert.ok(!LICENSE_OK.test(bad), bad);
assert.equal(photoFromPage(page())?.author, 'Jane & Co');
assert.equal(photoFromPage(page({}, { lic: 'CC BY-SA 4.0' })), null);
assert.equal(photoFromPage(page({ width: 1000 })), null, 'too small');
assert.equal(photoFromPage(page({ width: 2000, height: 2000 })), null, 'not landscape');
assert.equal(photoFromPage(page({ mime: 'image/png' })), null);
assert.equal(photoFromPage(page({}, { artist: '' })), null, 'attribution licence needs an author');
assert.equal(photoFromPage(page({}, { lic: 'Public domain', artist: '' }))?.author, 'Public domain');
// deterministic pick
const L = [1, 2, 3, 4, 5].map((i) => ({ ...photoFromPage(page())!, pageUrl: `https://commons.wikimedia.org/wiki/File:${i}.jpg` }));
assert.equal(pickPhoto(L, 'a', 'miami', '2026-11-23'), pickPhoto(L, 'a', 'miami', '2026-11-23'));
assert.equal(pickPhoto([], 'a', 'miami', 'd'), null);
assert.equal(Object.keys(CITY_CATEGORIES).length, 12);
assert.equal(CITY_CATEGORIES.miami.category, 'Miami, Florida');
assert.ok(subScore('Chicago skyline') < subScore('Photographs of Chicago') && subScore('Cityscapes of Quebec City') === 0 && subScore('Politics of Boston') === -1);

(async () => {
  let calls = 0, mode: 'ok' | 'empty' | 'fail' = 'ok';
  const f = async (url: string) => {
    calls++; await new Promise((r) => setTimeout(r, 5));
    if (mode === 'fail') return { ok: false, status: 503, text: async () => '' };
    const u = new URL(url);
    if (u.searchParams.get('list') === 'categorymembers') return { ok: true, status: 200, text: async () => JSON.stringify({ query: { categorymembers: [{ title: 'Category:Skyline of Miami' }, { title: 'Category:Maps of Miami' }] } }) };
    const pages = mode === 'empty' ? [] : [page(), page({}, { lic: 'CC BY-SA 4.0' })].map((p, i) => ({ ...p, title: `File:${i}.jpg`, imageinfo: [{ ...p.imageinfo[0], descriptionurl: `https://commons.wikimedia.org/wiki/File:${i}.jpg` }] }));
    return { ok: true, status: 200, text: async () => JSON.stringify({ query: { pages } }) };
  };
  const svc = createCityPhotoService(f);
  const now = new Date('2026-11-23T12:00:00Z');
  // simultaneous misses share one lookup (1 subcat call + 2 category calls)
  const rs = await Promise.all([svc.get('miami', 's1', now), svc.get('miami', 's2', now), svc.get('miami', 's3', now)]);
  const lookupCalls = calls; assert.ok(lookupCalls >= 3); assert.ok(rs.every((r) => r.status === 'ok' && r.candidates === 1 && r.photo));
  await svc.get('miami', 's9', now); assert.equal(calls, lookupCalls, 'cached');
  const solo = createCityPhotoService(f); const before = calls; await solo.get('miami', 'x', now); assert.equal(calls - before, lookupCalls, 'three simultaneous requests cost the same as one');
  assert.equal((await svc.get('nope', 's', now)).status, 'error');
  mode = 'empty'; const s2 = createCityPhotoService(f); assert.equal((await s2.get('boston', 's', now)).status, 'empty');
  mode = 'fail'; const s3 = createCityPhotoService(f); const bad = await s3.get('toronto', 's', now); assert.equal(bad.status, 'error'); assert.equal(bad.photo, null);
  console.log('cityPhotos ok');
})();
