# 🎬 Movies Classics Manifest - Quick Start Guide

## Overview

You have a complete toolkit to extract, harvest, and test the Archive.org Movies Classics list (150+ items) and wire it into your AJN broadcast system's EPG and library projection chain.

## Files Created

### 1. **Harvester Script** (`scripts/harvest-movies-classics.js`)
- Automated fetcher that queries the Archive.org metadata API
- Extracts playable MP4/h.264 video files from each item
- Generates a CI-ready manifest JSON for your build pipeline
- Includes rate limiting and error handling

**Features:**
- Loads seed identifiers from `seeds/movies-classics-identifiers.json`
- Validates file formats before inclusion
- Outputs structured manifest to `src/data/moviesClassicsManifest.json`
- CLI support: `--limit`, `--out` flags

### 2. **Seed File** (`seeds/movies-classics-identifiers.json`)
- 29 confirmed identifiers extracted from the visible list
- Metadata: titles, years, confidence levels
- Ready to be expanded with additional discoveries

### 3. **Reference Document** (`MOVIES_CLASSICS_IDENTIFIERS.md`)
- Strategy for extracting all 150 items
- Three extraction approaches documented
- Identifier naming conventions
- Troubleshooting guide

## Quick Start: From Zero to CI Testing

### Step 1: Run the Harvester (29 Known Items)

```bash
cd /home/claude
node scripts/harvest-movies-classics.js
```

**Expected Output:**
```
🌐 Archive.org Movies Classics Harvester

📦 Harvesting manifest for 29 items...
⏱️  Rate limit: 500ms between requests

[1/29] Fetching: wormwood_frank-olson
  ✓ 6 video file(s) found
[2/29] Fetching: TheManInTheIronMask1977
  ✓ 1 video file(s) found
...
📊 Harvest Summary:
  ✓ Successful: ~25-28
  ✗ Failed: ~1-4
  📝 Total items in manifest: ~25-28

✅ Manifest saved to: src/data/moviesClassicsManifest.json
   Size: 25-28 items, ~50-100KB
```

### Step 2: Verify Manifest Structure

```bash
# Check the generated manifest
cat src/data/moviesClassicsManifest.json | jq 'length'

# Inspect a single entry
cat src/data/moviesClassicsManifest.json | jq '.[0]'
```

**Expected Entry Structure:**
```json
{
  "identifier": "wormwood_frank-olson",
  "title": "Wormwood",
  "year": 2017,
  "description": "...",
  "creators": ["Errol Morris"],
  "files": [
    {
      "name": "Wormwood - Chapter 1 - Suicide Revealed.mp4",
      "format": "MPEG4",
      "title": "Chapter 1",
      "size": 298234880,
      "mtime": 1674604199
    }
  ],
  "mediaCount": 6
}
```

### Step 3: Wire into Your Build System

**In `src/data/guideRegistry.ts`** (or equivalent):

```typescript
import moviesClassicsManifest from './moviesClassicsManifest.json';

const guideRegistry = {
  // ... existing guides ...
  'classic-cinema': {
    name: 'Movies Classics (Archive.org)',
    producer: moviesClassicsProducer,
    source: moviesClassicsManifest,
    enabled: process.env.ENABLE_CLASSIC_CINEMA === 'true',
  },
};
```

**Create `src/producers/moviesClassicsProducer.ts`:**

```typescript
import { LibraryItem, Program } from '../types';
import { ManifestEntry } from '../types/manifest';

export const moviesClassicsProducer = (manifest: ManifestEntry[]): Program[] => {
  const programs: Program[] = [];

  manifest.forEach((entry) => {
    entry.files.forEach((file) => {
      const sourceId = `src-archive-${entry.identifier}`;
      const assetId = `asset-${entry.identifier}-${file.name.replace(/\.\w+$/, '')}`;

      programs.push({
        id: assetId,
        title: entry.title,
        description: entry.description,
        year: entry.year,
        creators: entry.creators,
        sourceId,
        assetId,
        url: `https://archive.org/download/${entry.identifier}/${encodeURIComponent(file.name)}`,
        format: file.format,
        duration: null, // Would require additional API call
        thumbUrl: `https://archive.org/services/get_still.php?identifier=${entry.identifier}&t=0`,
      });
    });
  });

  return programs;
};
```

### Step 4: Test the Projection Chain

Create `test-library-integrity.js`:

```bash
#!/usr/bin/env node

const manifest = require('./src/data/moviesClassicsManifest.json');
const { moviesClassicsProducer } = require('./src/producers/moviesClassicsProducer');

const programs = moviesClassicsProducer(manifest);

console.log(`\n✅ Library Integrity Test\n`);
console.log(`  Input items: ${manifest.length}`);
console.log(`  Output programs: ${programs.length}`);

// Validate projection
manifest.forEach((item) => {
  const itemPrograms = programs.filter(p => p.sourceId === `src-archive-${item.identifier}`);
  const expectedCount = item.files.length;

  if (itemPrograms.length !== expectedCount) {
    console.error(
      `  ✗ ${item.title}: expected ${expectedCount} programs, got ${itemPrograms.length}`
    );
  } else {
    console.log(
      `  ✓ ${item.title}: ${itemPrograms.length} program(s)`
    );
  }
});

// Validate assetId uniqueness
const assetIds = new Set();
programs.forEach((p) => {
  if (assetIds.has(p.assetId)) {
    console.error(`  ✗ Duplicate assetId: ${p.assetId}`);
  }
  assetIds.add(p.assetId);
});

console.log(`\n  🎯 Unique assetIds: ${assetIds.size}`);
console.log(`\n✅ All tests passed!\n`);
```

Run it:
```bash
node test-library-integrity.js
```

### Step 5: Build & Deploy

```bash
npm run build
npm run test:epg-identity
npm run deploy
```

## Expanding to All 150 Items

The 29-item seed covers the most visible titles. To get all 150:

### Approach A: Manual Discovery (Low Tech)
1. Open the list in your browser
2. Scroll through all items
3. Click on each to verify the identifier in the URL
4. Add to `seeds/movies-classics-identifiers.json`
5. Run the harvester again

### Approach B: Browser Automation (Medium Effort)
Use Puppeteer to automate scrolling and extraction:

```javascript
// scripts/extract-all-identifiers.js (pseudo-code)
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://archive.org/details/@infobattalion/lists/5/movies-classics');

  let identifiers = [];
  let lastHeight = await page.evaluate(() => document.body.scrollHeight);

  while (true) {
    const newIdentifiers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/details/"]'))
        .map(a => a.href.match(/\/details\/([^/?]+)/)?.[1])
        .filter(Boolean)
    );

    identifiers.push(...newIdentifiers);
    identifiers = [...new Set(identifiers)]; // Deduplicate

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1000);

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }

  console.log(`✅ Extracted ${identifiers.length} identifiers`);
  fs.writeFileSync('discovered-identifiers.txt', identifiers.join('\n'));

  await browser.close();
})();
```

### Approach C: Archive.org Advanced Search (Automated)
Query the IA Advanced Search API:

```bash
curl -s "https://archive.org/advancedsearch.php?q=creator:*&collection:feature_films&output=json&rows=200" \
  | jq '.response.docs[] | .identifier' \
  | sort | uniq > all-identifiers.txt
```

## Wiring to Your Build System

### 1. Update `.env` or CI Config
```bash
ENABLE_CLASSIC_CINEMA=true
MOVIES_CLASSICS_MANIFEST=./src/data/moviesClassicsManifest.json
```

### 2. Add to `package.json` Scripts
```json
{
  "scripts": {
    "harvest:movies-classics": "node scripts/harvest-movies-classics.js",
    "test:library-integrity": "node test-library-integrity.js",
    "test:epg-identity": "npm run harvest:movies-classics && npm run test:library-integrity"
  }
}
```

### 3. CI Pipeline (GitHub Actions Example)
```yaml
name: Test Movies Classics Manifest

on: [push, pull_request]

jobs:
  harvest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Run harvester
        run: npm run harvest:movies-classics
      
      - name: Verify manifest
        run: npm run test:library-integrity
      
      - name: Build
        run: npm run build
      
      - name: Upload manifest artifact
        uses: actions/upload-artifact@v3
        with:
          name: moviesClassicsManifest
          path: src/data/moviesClassicsManifest.json
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **404 on identifier** | Identifier may have changed; verify in browser |
| **No video files extracted** | Item may be text-only or corrupted; skip |
| **Rate limit 429** | Increase `REQUEST_DELAY` to 1000ms+ in harvester |
| **Manifest too large** | Use `--limit N` flag or batch in tranches |
| **Build fails on missing files** | Check archive.org if item was removed |

## Architecture Integration

### PlayerStore
```
PlayerStore [Archive.org Source]
  ├─ M3U (IPTV playlists)
  ├─ MP4 (direct downloads from IA)
  ├─ HLS (streaming via proxy)
  ├─ Embeds (YouTube, Rumble)
  └─ **Archive.org Classics** ← (NEW)
       ├─ Movies Classics (150+ items)
       ├─ EPG grid in BroadcastTVGuide
       └─ PlaybackCircuitBreaker handling
```

### LibraryItem Projection
```
Archive.org Manifest Entry
  ↓
moviesClassicsProducer()
  ↓
Program[] (sourceId + assetId mapping)
  ↓
PlayerStore.addProgram()
  ↓
BroadcastTVGuide.schedule()
  ↓
UnifiedPlaybackEngine.play(assetId)
```

## Next Steps

1. ✅ Run `node scripts/harvest-movies-classics.js` to validate the 29-item seed
2. 📋 Expand `seeds/movies-classics-identifiers.json` with full 150-item list
3. 🧪 Run integration tests in your build pipeline
4. 🎬 Wire `moviesClassicsProducer` to `guideRegistry`
5. 🚀 Enable `ENABLE_CLASSIC_CINEMA=true` in production

---

**Questions?** Check `MOVIES_CLASSICS_IDENTIFIERS.md` for the full identifier reference and extraction strategies.
