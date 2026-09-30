import { parseM3u as parseGuideM3u } from '../guideRegistry.ts';
import { parseM3uEntries as parseClassicM3u } from '../server/sources/classicM3u.ts';

interface Fixture {
  name: string;
  text: string;
}

const BASELINE = `#EXTM3U
#EXTINF:-1 tvg-id="fox-news" tvg-name="Fox News" tvg-logo="https://archive.org/services/img/FOXNEWSW" group-title="News",Fox News
/download/FOXNEWSW_20260903_060000_Hannity/FOXNEWSW_20260903_060000_Hannity.mp4?start=0&end=300
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="https://archive.org/services/img/CNNW" group-title="News",CNN
/download/CNNW_20260925_000000_Anderson_Cooper_360/CNNW_20260925_000000_Anderson_Cooper_360.mp4?exact=1&start=0&end=282
#EXTINF:-1 tvg-id="nasa-audio-vault" tvg-name="NASA Spaceflight Audio" group-title="Aerospace & Science",NASA Spaceflight Audio
/download/Apollo11AudioHighlights/Apollo11Highlights.mp3`;

const fixtures: Fixture[] = [
  { name: 'baseline-initial-playlist-fragment', text: BASELINE },
  {
    name: 'single-quoted-attributes',
    text: `#EXTM3U
#EXTINF:12 tvg-id='single-id' tvg-name='Single Name' group-title='News',Single Name
https://example.org/single.mp4`,
  },
  {
    name: 'empty-attributes',
    text: `#EXTM3U
#EXTINF:12 tvg-id="" tvg-name="" group-title="",Empty Attributes
https://example.org/empty-attrs.mp4`,
  },
  {
    name: 'decimal-duration',
    text: `#EXTM3U
#EXTINF:12.5 tvg-id="decimal" group-title="Test",Decimal Duration
https://example.org/decimal.mp4`,
  },
  {
    name: 'crlf',
    text: `#EXTM3U\r\n#EXTINF:-1 tvg-id="crlf" group-title="Test",CRLF Entry\r\nhttps://example.org/crlf.mp4\r\n`,
  },
  {
    name: 'utf8-bom',
    text: '\uFEFF#EXTM3U\n#EXTINF:-1 tvg-id="bom" group-title="Test",BOM Entry\nhttps://example.org/bom.mp4\n',
  },
  {
    name: 'extvlcopt-between-extinf-and-url',
    text: `#EXTM3U
#EXTINF:-1 tvg-id="vlc" group-title="Test",VLC Metadata
#EXTVLCOPT:http-referrer=https://example.org/
https://example.org/vlc.mp4`,
  },
  {
    name: 'missing-title',
    text: `#EXTM3U
#EXTINF:-1 tvg-id="no-title" group-title="Test",
https://example.org/no-title.mp4`,
  },
  {
    name: 'missing-url',
    text: `#EXTM3U
#EXTINF:-1 tvg-id="no-url" group-title="Test",No URL
#EXTVLCOPT:http-user-agent=Audit`,
  },
  {
    name: 'duplicate-tvg-id',
    text: `#EXTM3U
#EXTINF:-1 tvg-id="dup" group-title="Test",First Duplicate
https://example.org/first.mp4
#EXTINF:-1 tvg-id="dup" group-title="Test",Second Duplicate
https://example.org/second.mp4`,
  },
  {
    name: 'url-with-spaces',
    text: `#EXTM3U
#EXTINF:-1 tvg-id="spaces" group-title="Test",URL With Spaces
https://example.org/path with spaces/file.mp4`,
  },
  {
    name: 'missing-header',
    text: `#EXTINF:-1 tvg-id="no-header" group-title="Test",No Header
https://example.org/no-header.mp4`,
  },
  {
    name: 'malformed-header',
    text: `#EXTM3U-BROKEN
#EXTINF:-1 tvg-id="bad-header" group-title="Test",Malformed Header
https://example.org/bad-header.mp4`,
  },
];

function comparable(entries: readonly {
  title: string;
  url: string;
  duration?: number;
  groupTitle?: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
}[]): string {
  return JSON.stringify(entries.map((entry) => ({
    title: entry.title,
    url: entry.url,
    duration: entry.duration,
    groupTitle: entry.groupTitle,
    tvgId: entry.tvgId,
    tvgName: entry.tvgName,
    tvgLogo: entry.tvgLogo,
  })));
}

function compact(entries: readonly {
  title: string;
  url: string;
  duration?: number;
  groupTitle?: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
}[]): string {
  return JSON.stringify(entries);
}

console.log('# M3U Parser Differential Audit');
console.log('');
console.log('| Fixture | Parser A count | Parser B count | Equal normalized output | Parser A | Parser B |');
console.log('|---|---:|---:|:---:|---|---|');

for (const fixture of fixtures) {
  const parserA = parseGuideM3u(fixture.text);
  const parserB = parseClassicM3u(fixture.text);
  const equal = comparable(parserA) === comparable(parserB);
  console.log(
    `| ${fixture.name} | ${parserA.length} | ${parserB.length} | ${equal ? 'yes' : 'no'} | \`${compact(parserA).replaceAll('|', '\\\\|')}\` | \`${compact(parserB).replaceAll('|', '\\\\|')}\` |`,
  );
}
