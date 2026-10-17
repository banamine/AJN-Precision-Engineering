import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ChannelLogo, safeLogoUrl } from './src/components/ChannelLogo';
import newsLogos from './src/data/newsLogos.json';
import fs from 'node:fs';

assert.equal(safeLogoUrl('/logos/news/cnn.png'), '/logos/news/cnn.png');
assert.equal(safeLogoUrl('https://i.imgur.com/x.png'), 'https://i.imgur.com/x.png');
for (const bad of ['http://x/a.png', '//evil/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', undefined, null]) assert.equal(safeLogoUrl(bad as any), null, String(bad));
const fb = createElement('i', { id: 'fallback' });
const withLogo = renderToStaticMarkup(createElement(ChannelLogo, { logo: '/logos/news/cnn.png', name: 'CNN', fallback: fb }));
assert.match(withLogo, /data-testid="channel-logo"/); assert.match(withLogo, /loading="lazy"/); assert.match(withLogo, /alt="CNN logo"/); assert.doesNotMatch(withLogo, /fallback/);
for (const logo of [undefined, '', 'http://insecure/a.png']) assert.match(renderToStaticMarkup(createElement(ChannelLogo, { logo, name: 'X', fallback: fb })), /id="fallback"/);
// every mapped news logo exists on disk and is a real image, not a placeholder
for (const [id, url] of Object.entries(newsLogos as Record<string, string>)) {
  const f = `public${url}`; assert.ok(fs.existsSync(f), `${id}: ${f} missing`); const n = fs.statSync(f).size;
  assert.ok(n > 3000 && n < 60_000, `${id}: unexpected logo size ${n}`);
}
assert.equal(Object.keys(newsLogos).length, 13); // 11 news + rt + rt-documentaries
console.log('channel logo regression: all passed');
