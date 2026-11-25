import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';

// AppearanceProvider imports skin .css files for the bundler; plain Node cannot load them, so serve an empty module.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('.css')) return { url: new URL(spec, ctx.parentURL).href + '?stub', shortCircuit: true, format: 'module' };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.includes('.css?stub')) return { format: 'module', source: 'export default {};', shortCircuit: true };
    return next(url, ctx);
  },
});
const { StationBanner, StationIcon } = await import('./src/components/StationBanner.tsx');
const { getStationTheme } = await import('./src/utils/radioAccents.ts');
const { Navigation } = await import('./src/components/Navigation.tsx');
const { AjnAppearanceProvider } = await import('./src/components/ajn-platform-redesign/AppearanceProvider.tsx');

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
// The redesigned mobile dock shows 5 destinations; the rule that matters is that none share an icon.
assert.ok(icons.length >= 5, `at least 5 mobile icons, got ${icons.join(',')}`);
assert.equal(new Set(icons).size, icons.length, `distinct icons: ${icons.join(',')}`);
console.log('test-station-banner-render: ok', icons.join(','));
