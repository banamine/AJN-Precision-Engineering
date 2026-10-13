# Live Radio Contract

## Station Record Fields
- `id`: string, must begin with `radio:` (e.g. `radio:us-kexp`)
- `name`: string, station name
- `country`: `'US' | 'CA'`
- `region`: optional string (state/province)
- `city`: optional string
- `district`: optional string (display only)
- `timeZone`: optional IANA zone (e.g. `America/Toronto`); set only when derived from a real place, never guessed; drives the local-time label
- `callSign`: optional string
- `format`: optional string (kept for the guide; the directory prefers `genres`)
- `description`: optional string, one line, max 160 chars (shown in the directory)
- `genres`: optional string[], max 5 (directory chips and search; falls back to `[format]`)
- `language`: optional `'en' | 'fr' | 'es' | 'other'`
- `streamUrl`: string, https URL
- `streamType`: `'mp3' | 'aac' | 'hls' | 'icy'`
- `homepage`: optional string
- `logo`: optional string
- `enabled`: boolean
- `verifiedAt`: optional string (required for station to be admitted)
- `corsVerified`: optional boolean (true only after a real-browser check; enables the signal meter)
- `inGuide`: optional boolean; `false` = directory only (not a guide channel). Absent = in the guide. Every real station is `inGuide:false` as of 2026-10-13
- `uuid`: optional string, upstream directory id (radio-browser stationuuid)

## Rules
1. **HTTPS Only**: `streamUrl` must start with `https://`. Insecure `http://` streams are rejected.
2. **Played Direct**: Audio streams play direct in browser audio element; never proxied.
3. **Identifier Prefix**: Every station ID must start with `radio:`. Duplicate IDs are rejected.
4. **Verified Before Shown**: `verifiedAt` is required; unverified stations are rejected ("not verified").
5. **No Invented Schedules**: Exactly one program per channel covering the 24h day; title matches station name.
6. **Station Sources**: the 4 verified test stations (client-visible, they carry the signal-meter flag) are in `src/data/liveRadioSources.json`. The bulk directory (~2.3k US + Canada stations, `inGuide:false`) is `server/data/liveRadioDirectory.json`: SERVER-ONLY, never import it from `src/`. Both are validated once per process and merged.
7. **verifiedAt on bulk records** means a server-side header probe on 2026-10-13 (HTTP 200/206 + audio/mpeg or audio/aac). It is NOT a play test. Stations that stay silent are reported by the owner and removed from the file.

## Directory (Audio & Podcasts page)
- Button "Live Radio directory" under the guide opens the directory panel (search, country, state/province, city, genre chips, favorites, paging, station-local time).
- Data: `GET /api/live-radio/stations?q=&country=&region=&city=&genre=&ids=&page=&pageSize=` (default 24, max 100). Lists only valid + verified + enabled stations. Facets: `countries` and `genres` (top 30) cover all shown stations; `regions` follow the selected country; `cities` appear once a region is chosen.
- Play: through the app's one player, programId `<station id>:live:d0` (same id the guide uses).
- HLS stations are listed with a disabled play button ("HLS streams are not supported yet"): the app has no hls.js.
- Favorites on this panel are saved in this browser only (`ajn-live-radio-favorites-v1`); not cloud-synced.
- Scale: the guide has NO Live Radio rows: every station, the 4 test stations included, is directory only. Adding them to the guide would shift every station number and exceed the guide size budget.
- Local time: shown only for records with a `timeZone` (about 3 in 4 stations); the rest show no time rather than a guess.

Curated list 2026-10-13: KEXP, WUKY, CiTR, CJAD shown; WRFL, CBC Radio One hidden (not verified).
Bulk list 2026-10-13: 2,284 stations (243 Canada, 2,041 US) from the owner's station-directory demo, https + MP3/AAC only (http, HLS and OGG were excluded).
