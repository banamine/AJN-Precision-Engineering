import assert from 'node:assert/strict';
import fs from 'node:fs';
import { genreForName, genreArtUrl, isMusicGroup } from './src/utils/musicGenre';
const cases: Array<[string, string]> = [
  ['slow rock','rock'],['Frank Zappa','rock'],['Eagles 1976 Live at The Summit Houston K101','rock'],['Audioslave Montreux Jazz Festival 2005 DRS 3','rock'],
  ['Moody Blues 1991 WBCN Whisky A Go Go L.A','rock'],['Electric Light Orchestra Winterland SF 1976 ksan','rock'],['Music: AC/DC - Rock Box','rock'],
  ['ZZ+Top+Eliminator+CD+Rear+Artwork','rock'],['America 7.04.78 KWST Universal Amphitheatre','rock'],['America Sigma Studios Philadelphia 1972 wmmr','rock'],
  ['Music: Jefferson Airplane - Original Album Classics 8CD Box Set','rock'],['Music: Hi-Res Masters: \'80s Rock','rock'],
  ['Smooth Jazz Chill Groove • Perfect Vibes For Any Mood','jazz'],['000624 - New York Night Jazz Smooth Saxophone Jazz Music','jazz'],['Best Of Smooth Trumpet Jazz Smooth Jazz, Trumpet Jazz','jazz'],
  ['Bob James and Earl Klugh - One On One','jazz'],['Fourplay 2010 Sumida Triphony Hall Tokyo NHK','jazz'],["Weather Report '76 RTS Montreux Jazz Festival",'jazz'],
  ["Dexter Gordon Montreux Round Midnight band '87",'jazz'],['Rockpalast Al Jarreau David Sanborn 1985 wdr','jazz'],['Santana & McLaughlin 2016 Montreux Jazz RSI','jazz'],
  ['James Taylor Montreux Jazz Festival 1988 RSR','jazz'],['Jan Akkerman Montreux Jazz Festival 1978 DRS2','jazz'],
  ['EDM Rave Dance 2019: Top 100 Hits Psy Goa Trance House','dance'],['Beautiful Vocal Trance - Progressive (2020)','dance'],['Martin in the Mix - Vocal Trance Nation 61-87','dance'],
  ['House Music Sets - Episode 16','dance'],['Dancemania Speed Collection (Dance Dance Revolution Songs)','dance'],['Spacesynth SlowMegamix 1-4 (2022)','dance'],
  ['The Dream Dance (2021)','dance'],['Chicane - Live At Palladium 22-01-2000','dance'],['Music: Booom! (The Number 1 Dance Album Best of 2000)','dance'],
  ['Legends Of Disco 80s (2022)','disco'],['Everybody Clap: Disco Party 1-4','disco'],['80- 90','disco'],
  ['All Star Country record set','country'],
  ['Café Del Mar: The Best Of Café Del Mar','easy'],['Ultimate Chillout Dreams (2018)','easy'],['The Most Relaxing New Age Music (2018)','easy'],['Oxigen Music: New Age Ambience (2016)','easy'],['Saxappeal, Vol. 1-2 (2019-2022)','easy'],
  ['Doja-cat-paint-the-town-red-official-video_202411','pop'],['Justin Timberlake - Justified','pop'],['Music: School Days - The Ultimate Collection (5CD)(2018)','pop'],
  ['Music: 00s Radio Hits (2024)','hits'],['Music: 1970 Billboard Year End Hits','hits'],['Music: The Official UK Top 100 Singles Chart (08-February-2024)','hits'],['Music: The Billboard USA Top 40 Of 2000 - 2009','hits'],
  ['Hit Movie Themes','soundtrack'],['Hollywood Great Movie Theme ʚ(2) ɞ','soundtrack'],["70's The Original Soundtrack -Various Artists",'soundtrack'],
  ['Romantic Collection - Best Erotic Songs (2010)','love'],['Music: 100 Greatest Love Songs (2024)','love'],
  ['#1a Tallis Scholars Russkaya pravoslavnaya muzyka 05','classical'],
  ['Scott Muni WNEW FM New York City 11.05.70','live'],
  ["1980's New Wave / Rock of the 80’s, Reggae - Welcome 2 the",'rock'],
  ['06.-tunnel-13','default'],['Power Play Album','default'],['Music: Loose Tracks','default'],['Music: Mixed Playlists','default'],
];
let bad = 0;
for (const [name, want] of cases) { const got = genreForName(name); if (got !== want) { bad++; console.error('MISMATCH', JSON.stringify(name), 'got', got, 'want', want); } }
assert.equal(bad, 0);
assert.equal(genreArtUrl('live'), '/genre-art/oldies.jpg');
assert.equal(genreArtUrl('rock'), '/genre-art/rock.jpg');
for (const g of ['easy','rock','pop','hits','jazz','dance','disco','country','classical','soundtrack','love','oldies','default']) assert.ok(fs.existsSync(`public/genre-art/${g}.jpg`), `missing image ${g}`);
assert.ok(isMusicGroup('Music') && !isMusicGroup('Old-Time Radio') && !isMusicGroup(null));
// every Music channel name in the saved live schedule gets a genre; report the spread
if (fs.existsSync('/tmp/s.json')) {
  const d = JSON.parse(fs.readFileSync('/tmp/s.json', 'utf8')); const spread: Record<string, number> = {};
  for (const c of d.channels) if (c.group === 'Music') { const g = genreForName(c.name); spread[g] = (spread[g] || 0) + 1; }
  console.log('live spread', spread);
}
console.log('music genre: PASS', cases.length, 'cases');
