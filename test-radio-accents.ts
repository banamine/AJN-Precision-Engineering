import assert from 'node:assert/strict';
import { STATION_CHANNELS, getStationTheme, stationGradient, deriveThemeColor } from './src/utils/radioAccents.ts';
import { RADIO_GROUPS } from './src/utils/radioGroups.ts';
import { rememberStationArt, getStationArt, isRadioId } from './src/utils/stationArt.ts';

// Every station in a group has a configured, distinct accent and a deep theme colour.
const ids = RADIO_GROUPS.flatMap((g) => g.members.map((m) => m.id));
for (const id of ids) assert.ok(STATION_CHANNELS.some((c) => c.id === id), `${id} is in STATION_CHANNELS`);
assert.equal(new Set(STATION_CHANNELS.map((c) => c.accentColor)).size, STATION_CHANNELS.length, 'accent colours are distinct');
for (const c of STATION_CHANNELS) { assert.match(c.accentColor, /^#[0-9A-F]{6}$/i); assert.match(c.themeColor, /^#[0-9A-F]{6}$/i); assert.ok(c.name && c.iconEmoji); }

// Theme: accent, themeColor, icon only when the logo is https.
const t = getStationTheme('radio:ch109-warm-109', '', 'https://img.example/warm.png');
assert.equal(t.accentColor, '#FB7185'); assert.equal(t.color, t.accentColor); assert.equal(t.themeColor, '#3F1620'); assert.equal(t.icon, 'https://img.example/warm.png'); assert.equal(t.name, 'Warm 109');
assert.equal(getStationTheme('radio:ch109-warm-109', '', 'http://insecure/x.png').icon, undefined, 'no http logos');
assert.equal(getStationTheme('radio:ch109-warm-109').icon, undefined, 'no logo, no invented icon');
// Unknown station: stable colour from its id, derived dark theme colour.
const u1 = getStationTheme('radio:rb-unknown-1', 'Some FM'); const u2 = getStationTheme('radio:rb-unknown-1', 'Some FM');
assert.deepEqual(u1, u2); assert.match(u1.themeColor, /^#[0-9a-f]{6}$/i); assert.equal(u1.themeColor, deriveThemeColor(u1.accentColor));
assert.match(stationGradient(t), /^linear-gradient\(135deg, #3F1620 0%/);

// Logo registry: https only, radio ids only, newest wins.
assert.ok(isRadioId('radio:x') && !isRadioId('cnn'));
rememberStationArt([{ id: 'radio:a', logo: 'https://img/a.png' }, { id: 'radio:b', logo: 'http://img/b.png' }, { id: 'cnn', logo: 'https://img/c.png' }, { id: 'radio:d' }]);
assert.equal(getStationArt('radio:a'), 'https://img/a.png');
assert.equal(getStationArt('radio:b'), undefined); assert.equal(getStationArt('cnn'), undefined); assert.equal(getStationArt('radio:d'), undefined);
rememberStationArt([{ id: 'radio:a', logo: 'https://img/a2.png' }]);
assert.equal(getStationArt('radio:a'), 'https://img/a2.png');
console.log(`test-radio-accents: ok (${STATION_CHANNELS.length} configured stations)`);
