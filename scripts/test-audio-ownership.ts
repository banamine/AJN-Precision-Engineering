import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "server"];
const ALLOWED = new Set([path.normalize("src/use-audio-normalization.ts")]);
const PATTERNS = [
  { label: "AudioContext constructor", regex: /new\s+(?:(?:window)\.)?(?:AudioContext|webkitAudioContext)\s*\(/g },
  { label: "MediaElementSource creator", regex: /\.createMediaElementSource\s*\(/g },
];

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let constructors = 0;
let sourceNodes = 0;
const violations: Array<{ file: string; line: number; kind: string; text: string }> = [];

for (const file of ROOTS.flatMap(filesUnder)) {
  const relative = path.normalize(file);
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split("\n");

  for (const { label, regex } of PATTERNS) {
    for (const match of source.matchAll(regex)) {
      const index = match.index ?? 0;
      const line = source.slice(0, index).split("\n").length;
      if (label === "AudioContext constructor") constructors += 1;
      else sourceNodes += 1;

      if (!ALLOWED.has(relative)) {
        violations.push({
          file: relative,
          line,
          kind: label,
          text: (lines[line - 1] ?? match[0]).trim(),
        });
      }
    }
  }
}

console.log("=== AJN AUDIO OWNERSHIP ===");
console.log(`Scanned roots: ${ROOTS.join(", ")}`);
console.log(`AudioContext constructors: ${constructors}`);
console.log(`MediaElementSource creators: ${sourceNodes}`);

if (violations.length) {
  console.error(`Violations: ${violations.length}`);
  for (const v of violations) {
    console.error(`FAIL: ${v.file}:${v.line} [${v.kind}]\n  ${v.text}`);
  }
  process.exit(1);
}

console.log("Violations: 0");
console.log("PASS");
