export const NTD_EAST_URL = 'https://ntd02.akamaized.net/HD-NY/index.m3u8';
export const NTD_HDLA_URL = 'https://synthetic.example/ntd-west-hdla.m3u8';
export const NTD_RAKUTEN_URL = 'https://synthetic.example/ntd-english-rakuten.m3u8';
export const NTD_PINNED_NEW_IDS = new Set([
  'live-ntdtv-asia-pacific',
  'live-ntdtv-canada',
  'live-ntdtv-canada-west',
  'live-ntdtv-china',
  'live-ntdtv-english-1080',
  'live-ntdtv-english-720',
  'live-ntdtv-english-uk',
  'live-ntdtv-west',
]);

export const LIVE_TV_BASE_COUNT = 1504;
export const LIVE_TV_EXPECTED_COUNT = 1512;
export const NTD_EXPECTED_COUNT = 11;

/** A synthetic 1,504-entry source fixture with the three reported NTD rows. */
export function buildLiveTvNtdFixture(): string {
  const rows = ['#EXTM3U'];
  for (let i = 0; i < LIVE_TV_BASE_COUNT - 3; i++) {
    const id = String(i + 1).padStart(4, '0');
    rows.push(`#EXTINF:-1 tvg-id="fixture-${id}" group-title="Entertainment",Fixture Channel ${id}`);
    rows.push(`https://synthetic.example/channels/${id}.m3u8`);
  }
  rows.push(`#EXTINF:-1 tvg-id="NTDTVEast" tvg-logo="https://upstream.example/east.png" group-title="General;News",NTD TV (1080p)`);
  rows.push(NTD_EAST_URL);
  rows.push(`#EXTINF:-1 tvg-id="NTDTVWest720" group-title="General;News",NTD TV West (720p)`);
  rows.push(NTD_HDLA_URL);
  rows.push(`#EXTINF:-1 tvg-id="NTDTVEnglish" group-title="General;News",NTD TV English`);
  rows.push(NTD_RAKUTEN_URL);
  return rows.join('\n');
}
