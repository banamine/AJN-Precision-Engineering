# Movies Classics List - Identifier Reference

**Source:** https://archive.org/details/@infobattalion/lists/5/movies-classics  
**Total Items:** 150  
**Last Updated:** 2026-09-20

## Strategy for Extracting All 150 Identifiers

Archive.org list pages load content dynamically. The most reliable approach:

### Option 1: Use the Harvester Script (Recommended)
The harvester script (`scripts/harvest-movies-classics.js`) accepts a seed list of identifiers and automatically:
1. Fetches metadata from the IA API for each identifier
2. Extracts playable MP4/h.264 files
3. Generates a CI-ready manifest

**To expand the seed list:**
1. Manually discover identifiers by clicking on items in the list
2. Note the `identifier` value in the URL (`/details/{IDENTIFIER}`)
3. Add to `KNOWN_IDENTIFIERS` array in the harvester script
4. Run: `node scripts/harvest-movies-classics.js`

### Option 2: Browser Automation
Use Selenium, Puppeteer, or Playwright to:
1. Navigate to the list page
2. Scroll to load all items
3. Extract `href` attributes from item links
4. Parse identifiers from URLs

### Option 3: Archive.org Advanced Search
Query the IA API using the user's collection metadata (if available):
```bash
curl -s "https://archive.org/advancedsearch.php?q=collection:feature_films&output=json" \
  | jq '.response.docs[] | .identifier'
```

## Currently Known Identifiers (Visible in List)

These identifiers have been confirmed by visiting the detail pages:

```json
[
  "wormwood_frank-olson",           // Wormwood (2017)
  "TheManInTheIronMask1977",        // The Man In The Iron Mask (1977)
  "HolidayInn1942Colorized",        // Holiday Inn 1942 *colorized
  "TheDeadlyMantis1957",            // The Deadly Mantis 1957
  "m-1931",                         // M (1931)
  "thedeatskiss_the_death_kiss",    // The Death Kiss
  "bandofoutsiders",                // Band Of Outsiders (1964)
  "TheGayDeceivers1969",            // The Gay Deceivers 1969
  "GoneWithTheWest",                // Gone with the West
  "DoomsdayMachine1972",            // Doomsday Machine (1972)
  "ManInTheAttic",                  // Man in the Attic
  "BorderPatrol1937",               // Border Patrol (1937)
  "SkyMoviesTonightEpisode05",      // Sky Movies 05/2007 | The Hitchhiker's Guide to the Galaxy (2005)
  "SuddenFear1952",                 // Sudden Fear (1952)
  // Additional items to be discovered...
]
```

## Next Steps

1. **Run the harvester with known identifiers:**
   ```bash
   node scripts/harvest-movies-classics.js
   ```

2. **Expand the seed list** by discovering more identifiers from the list UI

3. **Test the manifest** against your CI pipeline:
   ```bash
   npm run build
   npm run test:epg-identity
   ```

4. **Use the integrity test** to verify the projection chain:
   ```bash
   node test-library-integrity.js
   ```

## Identifier Naming Conventions

Archive.org uses various identifier formats:
- **Slug-based:** `wormwood_frank-olson` (descriptive slugs)
- **Year-suffix:** `TheDeadlyMantis1957` (title + year)
- **Generic:** `m-1931` (short + year)
- **Underscored:** `bandofoutsiders` (title slug)
- **Descriptive:** `thedeatskiss_the_death_kiss` (title + alt)

The harvester normalizes these and extracts playable files regardless of naming.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 on identifier | Check URL `/details/{id}` manually in browser |
| No video files found | Item may be text/audio only; verify in browser |
| Rate limit errors | Increase `REQUEST_DELAY` in harvester script |
| Manifest too large | Use `--limit N` flag or batch process |

---

**For the full 150-item harvest, use the browser automation approach or expand the known identifiers list through manual discovery.**
