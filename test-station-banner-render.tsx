import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { StationBanner, StationIcon } from './src/components/StationBanner.tsx';
import { getStationTheme } from './src/utils/radioAccents.ts';
import { Navigation } from './src/components/Navigation.tsx';
import { AjnAppearanceProvider } from './src/components/ajn-platform-redesign/AppearanceProvider.tsx';

// Station with a real logo: the logo is drawn, in the station's colours.
const withLogo = renderToStaticMarkup(<StationBanner theme={getStationTheme('radio:ch109-warm-109', '', 'https://img.example/warm.png')} title="Warm 109" subtitle="Toronto" />);
assert.match(withLogo, /<img[^>]+src="https:\/\/img\.example\/warm\.png"/);
assert.match(withLogo, /#FB7185/i); assert.match(withLogo, /linear-gradient\(135deg/); assert.match(withLogo, /Warm 109/);
// No logo: the emoji tile, no <img>, nothing invented.
const noLogo = renderToStaticMarkup(<StationIcon theme={getStationTheme('radio:ch109-christmas')} size={40} />);
assert.ok(!noLogo.includes('<img') && noLogo.includes('🎄'));

// Navigation: every destination has its own icon (no two items share one svg), and none is the old Tv/FolderArchive reuse.
const html = renderToStaticMarkup(<AjnAppearanceProvider><Navigation currentDestination="home" onNavigate={() => {}} nowPlaying={null} /></AjnAppearanceProvider>);
const mobile = html.slice(html.indexOf('id="mobile-bottom-nav"'));
const icons = [...mobile.matchAll(/<svg[^>]*class="[^"]*lucide-([a-z-]+)/g)].map((m) => m[1]);
assert.equal(icons.length, 8, `8 mobile icons, got ${icons.join(',')}`);
assert.equal(new Set(icons).size, 8, `distinct icons: ${icons.join(',')}`);
console.log('test-station-banner-render: ok', icons.join(','));
