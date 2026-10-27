# 🚀 Movies Classics Implementation Checklist

## Phase 1: Immediate (Today) ✅ **START HERE**

- [ ] **Understand Current State**
  - [ ] Read `QUICK_REFERENCE.md` (2 min)
  - [ ] Skim `EXTRACTION_SUMMARY.md` (3 min)
  - [ ] Review generated manifest: `cat src/data/moviesClassicsManifest.json | jq 'length'`

- [ ] **Validate Setup**
  ```bash
  # Verify manifest exists and has 29 items
  node -e "const m = require('./src/data/moviesClassicsManifest.json'); console.log(\`✓ Manifest: \${m.length} items\`)"
  ```

- [ ] **Test Mock Generator**
  ```bash
  # Re-generate to confirm it works
  node scripts/generate-mock-manifest.js
  ```

- [ ] **Run Library Integrity Test**
  ```bash
  # Create this file first (template below)
  node test-library-integrity.js
  ```

---

## Phase 2: This Week (Expand Seed Data)

### Option A: Manual Scrolling (Low Tech, Thorough) — **RECOMMENDED**
- [ ] Continue scrolling the Archive.org list in your browser
- [ ] For each visible title, click to verify the identifier in the URL
- [ ] Add 20-25 new identifiers to `seeds/movies-classics-identifiers.json`
- [ ] Update with year, description, creators where visible
- [ ] Re-run mock generator: `node scripts/generate-mock-manifest.js`
- [ ] Verify new items appear in manifest

**Time:** 30-45 minutes for ~50 total identifiers

### Option B: Browser Automation (Fast, Requires Setup) — **FASTER**
- [ ] Install Puppeteer: `npm install puppeteer`
- [ ] Create `scripts/extract-all-identifiers.js` (template below)
- [ ] Run extraction: `node scripts/extract-all-identifiers.js`
- [ ] Validate output: `wc -l discovered-identifiers.txt`
- [ ] Merge into seed file: Update `seeds/movies-classics-identifiers.json`
- [ ] Re-run mock generator

**Time:** 10-15 minutes setup, 5 minutes execution

---

## Phase 3: Integration (Next 1-2 Weeks)

### 3a: Create Producer Function
- [ ] Create `src/producers/moviesClassicsProducer.ts`:

```typescript
import { Program } from '../types';
import moviesClassicsManifest from '../data/moviesClassicsManifest.json';

export const moviesClassicsProducer = (): Program[] => {
  return moviesClassicsManifest.flatMap((entry: any) =>
    entry.files.map((file: any) => ({
      id: `archive-${entry.identifier}-${file.name}`,
      title: entry.title || entry.identifier,
      year: entry.year,
      description: entry.description,
      creators: entry.creators,
      sourceId: `archive-${entry.identifier}`,
      assetId: `asset-${entry.identifier}-${file.name}`,
      url: `https://archive.org/download/${entry.identifier}/${encodeURIComponent(file.name)}`,
      thumbUrl: `https://archive.org/services/get_still.php?identifier=${entry.identifier}&t=0`,
      format: file.format,
      duration: null,
    }))
  );
};
```

- [ ] Add TypeScript types if needed (Program interface)
- [ ] Test function: `node -e "const p = require('./src/producers/moviesClassicsProducer'); console.log(p.moviesClassicsProducer().length)"`

### 3b: Wire into Registry
- [ ] Open `src/data/guideRegistry.ts` (or equivalent)
- [ ] Import producer: `import { moviesClassicsProducer } from '../producers/moviesClassicsProducer'`
- [ ] Add entry:
```typescript
'classic-cinema': {
  name: 'Archive.org Classics',
  description: 'Classic films from Archive.org Movies Classics collection',
  producer: moviesClassicsProducer,
  enabled: process.env.ENABLE_CLASSIC_CINEMA === 'true',
}
```

### 3c: Update Build System
- [ ] Add to `package.json` scripts:
```json
{
  "scripts": {
    "harvest:movies-classics": "node scripts/generate-mock-manifest.js",
    "test:library-integrity": "node test-library-integrity.js",
    "test:movies-classics": "npm run harvest:movies-classics && npm run test:library-integrity"
  }
}
```

- [ ] Create/update CI pipeline (GitHub Actions template in QUICKSTART)
- [ ] Test locally: `npm run build`

### 3d: Test Full Chain
- [ ] Run build: `npm run build`
- [ ] Verify no errors
- [ ] Check output artifact for manifest inclusion
- [ ] Test in staging environment

---

## Phase 4: Expansion to Full 150 Items (Sprint 2+)

- [ ] Expand `seeds/movies-classics-identifiers.json` to 75+ items
- [ ] Continue scrolling or use automation to reach 120-140 items
- [ ] Run mock generator with full list
- [ ] Validate expanded manifest
- [ ] Re-deploy with full 150-item manifest

---

## Production Deployment (When Ready)

### On a Machine with Direct IA Access (not behind cloud proxy)

```bash
# Install if needed
npm install

# Run real harvester against live Archive.org API
node scripts/harvest-movies-classics.js --out ./src/data/moviesClassicsManifest.json

# Verify real file metadata was extracted
cat src/data/moviesClassicsManifest.json | jq '.[0].files[0]'
# Should show: name, format, size, mtime (not mock data)

# Deploy
npm run build
npm run deploy
```

---

## Code Templates

### Template: test-library-integrity.js

```javascript
#!/usr/bin/env node

const manifest = require('./src/data/moviesClassicsManifest.json');
const { moviesClassicsProducer } = require('./src/producers/moviesClassicsProducer');

const programs = moviesClassicsProducer();

console.log('\n✅ Library Integrity Test\n');
console.log(`  Manifest entries: ${manifest.length}`);
console.log(`  Generated programs: ${programs.length}`);

// Validate each entry projects correctly
manifest.forEach((item) => {
  const itemPrograms = programs.filter(p => p.sourceId === `archive-${item.identifier}`);
  const expectedCount = item.files.length;

  if (itemPrograms.length !== expectedCount) {
    console.error(`  ✗ ${item.title}: expected ${expectedCount}, got ${itemPrograms.length}`);
  } else {
    console.log(`  ✓ ${item.title}: ${itemPrograms.length} program(s)`);
  }
});

// Validate assetId uniqueness
const assetIds = new Set();
let duplicates = 0;
programs.forEach((p) => {
  if (assetIds.has(p.assetId)) {
    duplicates++;
  }
  assetIds.add(p.assetId);
});

console.log(`\n  Unique assetIds: ${assetIds.size}`);
if (duplicates > 0) {
  console.error(`  ✗ Found ${duplicates} duplicate assetIds!`);
} else {
  console.log(`  ✓ All assetIds unique`);
}

console.log('\n✅ All tests passed!\n');
```

### Template: scripts/extract-all-identifiers.js (Puppeteer)

```javascript
#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');

const LIST_URL = 'https://archive.org/details/@infobattalion/lists/5/movies-classics';

(async () => {
  console.log('\n🤖 Extracting all identifiers from Movies Classics list...\n');

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(LIST_URL, { waitUntil: 'networkidle2' });

  let identifiers = new Set();
  let scrollCount = 0;
  let lastHeight = 0;

  while (true) {
    // Extract all visible identifiers
    const newIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/details/"]'))
        .map(a => a.href.match(/\/details\/([^/?]+)/)?.[1])
        .filter(Boolean);
    });

    newIds.forEach(id => identifiers.add(id));
    console.log(`[Scroll ${++scrollCount}] Found ${newIds.length} items (${identifiers.size} total unique)`);

    // Scroll
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1000);

    // Check if we've reached the end
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) {
      console.log('\n✅ Reached end of list\n');
      break;
    }
    lastHeight = newHeight;
  }

  // Save results
  const results = Array.from(identifiers);
  fs.writeFileSync('discovered-identifiers.txt', results.join('\n'));
  console.log(`📝 Saved ${results.length} identifiers to discovered-identifiers.txt\n`);

  await browser.close();
})();
```

---

## Verification Checkpoints

| Checkpoint | Command | Expected |
|------------|---------|----------|
| **Manifest exists** | `ls -lh src/data/moviesClassicsManifest.json` | ~12KB file |
| **Has 29 items** | `jq 'length' src/data/moviesClassicsManifest.json` | `29` |
| **Sample entry** | `jq '.[0]' src/data/moviesClassicsManifest.json` | Valid JSON object |
| **File structure** | `jq '.[0].files[0]' src/data/moviesClassicsManifest.json` | name, format, title, size |
| **Producer works** | `node -e "const p=require('./src/producers/moviesClassicsProducer'); console.log(p.moviesClassicsProducer().length)"` | Number > 0 |
| **Registry wired** | `grep -n 'classic-cinema' src/data/guideRegistry.ts` | Found entry |
| **Build passes** | `npm run build 2>&1 \| grep -i error` | No errors |

---

## Rollback Plan

If something breaks:

1. **Revert manifest:**
   ```bash
   git checkout src/data/moviesClassicsManifest.json
   ```

2. **Regenerate from backup:**
   ```bash
   node scripts/generate-mock-manifest.js
   ```

3. **Check seed file:**
   ```bash
   cat seeds/movies-classics-identifiers.json | jq '.identifiers | length'
   ```

4. **Revert registry:**
   ```bash
   git checkout src/data/guideRegistry.ts
   ```

---

## Success Criteria

✅ **Phase 1 Complete When:**
- [ ] `src/data/moviesClassicsManifest.json` exists with 29 items
- [ ] `node scripts/generate-mock-manifest.js` runs without errors
- [ ] Library integrity test passes

✅ **Phase 2 Complete When:**
- [ ] Seed file expanded to 50-75 identifiers
- [ ] Mock generator produces manifest with 50-75 items
- [ ] No duplicate assetIds

✅ **Phase 3 Complete When:**
- [ ] `moviesClassicsProducer` function creates Program[]
- [ ] Producer is wired into `guideRegistry`
- [ ] `npm run build` succeeds
- [ ] EPG displays films from manifest
- [ ] Playback works end-to-end

✅ **Phase 4 Complete When:**
- [ ] All 150 identifiers discovered and validated
- [ ] Real harvester generates manifest (from direct IA access)
- [ ] Deployed to production
- [ ] Daily playback metrics show usage

---

## Support References

| Question | Document |
|----------|----------|
| What was done? | `EXTRACTION_SUMMARY.md` |
| How do I integrate? | `MOVIES_CLASSICS_QUICKSTART.md` |
| What identifiers? | `seeds/movies-classics-identifiers.json` |
| How to expand? | `MOVIES_CLASSICS_IDENTIFIERS.md` |
| Quick status? | `QUICK_REFERENCE.md` |

---

**Start with Phase 1 → Immediate section.** Everything is ready to go.
