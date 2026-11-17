# Weather page drop-in
Menu: top bar "More" drop-down, new last item WEATHER (under Neural Twin). Mobile "More" sheet too. Opens #weather.
Data: Open-Meteo (no key), fetched in the browser, 5-day forecast, saved place kept in this browser (ajn.weather.place.v1). Errors shown plainly; no fake numbers.
Place: search by city or "Use my location" (browser asks permission).
Backdrops: public/weather-bg/*.jpg = 24 of the 48 pack pictures at 640x360 (0.68 MB total), mapped from weather codes in src/utils/weather.ts (one table). Missing picture = plain dark panel.
Licence of the backdrop photos is unconfirmed (see claude/AJN_Icons_Logos_Weather_Investigation_2026-11-16.md). Delete public/weather-bg/ to run without them.
Files: NEW src/utils/weather.ts, src/components/WeatherView.tsx, public/weather-bg/*.jpg (24), test-weather.ts
       EDIT src/types.ts (+'weather'), src/App.tsx (+hash, +lazy view), src/components/Navigation.tsx (+2 menu items, +CloudSun), src/nav/lastView.ts (+'weather')
Test: npx tsx test-weather.ts

v2 (after Gemini mock-up review, 2026-11-16)
- Photo only when a forecast is ready (no photo for no-place, loading, error).
- All text sitting directly on the photo is now the light text colour: measured over the real backdrops, the dimmer grey fell to 2.8:1 (needs 4.5:1); light text is 5.3:1 or better; text on the day cards is 6.8:1 or better.
- "Rain chance" renamed "Precip. chance" (the number covers snow too).
- Buttons are 44px tall; Search is the orange button; search row stacks on phones; last day card spans the row on phones.
- Location/search problems show in amber; hints added for first visit and for search results.

## v3 (Weather page upgrades)
Changed files only: src/utils/weather.ts, src/components/WeatherView.tsx, test-weather.ts (the other v2 files are unchanged).
- °F·mph / °C·km/h switch (remembered; first-visit default is °F for en-US browsers, °C otherwise). Values are kept in Celsius/km/h and converted for display, so the switch needs no new request.
- Failed refresh keeps the last real forecast for the same place, labelled "OUT OF DATE" with its time. No saved forecast = the plain error, nothing invented.
- Plain background / Photo background toggle (remembered).
- Collapsible "Next 12 hours" (hourly data from Open-Meteo; if it is malformed the section is simply hidden).
- Remembered in this browser only: ajn.weather.prefs.v1, ajn.weather.last.v1 (plus the existing ajn.weather.place.v1).

## v4 (search fixes, from the first Builder test)
Changed files vs v3: src/utils/weather.ts, src/components/WeatherView.tsx, test-weather.ts.
- Place search now understands "Victoria BC canada", "Victoria, TX", "victoria usa": it searches the city name, then uses the state/province/country words (with US/Canada abbreviations) to pick and order the matches. If no extra word matches, all choices are still shown.
- Autocomplete: matches appear about 0.3 s after typing stops (older requests are cancelled); Enter or Search runs it immediately.
- Search is a lit cockpit button (ck-key is-latched); results are cockpit row buttons; the input is lighter.

## v5 (Weather Deck: alerts + airport reports; also fixes the blind "Failed to fetch")
New files: src/utils/fetchJson.ts, src/utils/alerts.ts, src/utils/aviation.ts, src/components/WeatherAlerts.tsx, src/components/WeatherAirport.tsx, server/routes/aviationWeather.ts, test-aviation.ts.
Changed: src/components/WeatherView.tsx, src/utils/weather.ts, test-weather.ts, server.ts (TWO lines only, below).
server.ts, if you prefer to edit by hand instead of replacing the file:
  1. after `import { registerAffiliateListingRoute } from './server/routes/affiliateListing.js';` add
     `import { registerAviationRoutes } from './server/routes/aviationWeather.js';`
  2. after the line `registerAffiliateListingRoute(app);` add
     `registerAviationRoutes(app); // /api/aviation/metar|taf for the Weather page (cached 60 s)`
  (it must stay ABOVE the catch-all `app.use('/api', ... 404)` near the end; that is where the existing line already sits.)
What it does:
- Network errors now name the host and the likely cause, and a bare "Failed to fetch" is retried once after 2.5 s. HTTP errors show their status.
- Official US alerts (NWS, direct from the browser): slim severity strip, only when real alerts exist; non-US places show "US only · not available here"; a failed check says "could not be checked" with a Retry key (never reads as all clear).
- Nearest airport (METAR) + 24 h flight-category ribbon (TAF) through our own /api/aviation route, because aviationweather.gov refuses browser calls. Route: validated numbers/airport codes only, 60 s cache, serves a flagged-stale copy for up to 10 min if the upstream fails, never more than 60 upstream calls a minute.
- "Measured at KDEN 41°F · forecast model 43°F" line, only when both are real and the report is under 90 minutes old.
- Three source chips with ages. Each source fails on its own.
- Cut after Gemini's review: sun arc and wind dial (it called them its weakest ideas). Hourly stays collapsed.
Check after publishing: https://<your app>/api/aviation/metar?lat=39.74&lon=-104.99 should return JSON with "ok":true and a "data" list of airports.

## v6 — Canada (Environment Canada warnings + AQHI) and two fixes
Drop in over v5 (files only; no images, no server change).
- NEW src/utils/ecan.ts, NEW src/components/WeatherAirQuality.tsx, NEW test-ecan.ts
- CHANGED src/components/WeatherView.tsx, WeatherAlerts.tsx, WeatherAirport.tsx, src/utils/alerts.ts
- Alerts: US places use NWS; Canadian places use Environment Canada (api.weather.gc.ca, browser-direct, small bbox query). If NWS answers 404/400 for a Canadian point, EC is used.
- New card: Air Quality Health Index (nearest station, risk word + colour, "OLD READING" after 3 h).
- Fix: VFR chip/ribbon were orange (theme remaps named green) -> explicit hex colours.
- Fix: calm wind showed "0° 0 kt" -> "Calm".
- Unverified: red/orange EC warning colour mapping (only statements and yellow warnings seen live); EC licence text (check attribution rules before publishing).
- Test: node --experimental-strip-types on test-ecan.ts (imports need .ts extensions).
