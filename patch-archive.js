const fs = require('fs');
let code = fs.readFileSync('archive-discovery.ts', 'utf8');

// Replace https://archive.org with http://archive.org
code = code.replace(/https:\/\/archive\.org/g, 'http://archive.org');

// Add console.logs for metrics and remove the NightOfTheLivingDead fallback
const searchRegex = /catch \(e\) \{\n\s+console\.warn\("Archive search failed, using fallback:", e\);\n\s+return \[\n\s+\{ identifier: "NightOfTheLivingDead".*?\n\s+\{ identifier: "HisGirlFriday1940".*?\n\s+\];\n\s+\}/s;
code = code.replace(searchRegex, `catch (e) {\n    console.warn("Archive search failed:", e);\n    return [];\n  }`);

const buildChannelStart = code.indexOf('const rawAssets: MediaAsset[] = [];');
code = code.substring(0, buildChannelStart) + 
  `console.log(\`[Archive Discovery] Searching for: \${query}\`);\n  console.log(\`[Archive Discovery] Found \${docs.length} Solr results\`);\n  let filesInspected = 0;\n  ` +
  code.substring(buildChannelStart);

// Update filesInspected
code = code.replace('const files = meta.files || [];', 'const files = meta.files || [];\n      filesInspected += files.length;');

const fallbackRegex = /\/\/ Fallback for demonstration since archive API is unreachable\n\s+if \(doc\.identifier === "NightOfTheLivingDead"\) \{.*?\n\s+\}/s;
code = code.replace(fallbackRegex, '');

const dedupeStart = code.indexOf('// Deduplicate and prioritize');
code = code.substring(0, dedupeStart) + 
  `\n  console.log(\`[Archive Discovery] Inspected \${filesInspected} total files across \${docs.length} items\`);\n  console.log(\`[Archive Discovery] Found \${rawAssets.length} playable MP4 representations\`);\n\n  ` +
  code.substring(dedupeStart);

const playlistStart = code.indexOf('const playlist = deduplicated.slice(0, maxAssets);');
code = code.substring(0, playlistStart) + 
  `console.log(\`[Archive Discovery] Deduplicated to \${deduplicated.length} distinct distinct assets (removed \${rawAssets.length - deduplicated.length} duplicates)\`);\n  ` +
  code.substring(playlistStart);

fs.writeFileSync('archive-discovery.ts', code);
