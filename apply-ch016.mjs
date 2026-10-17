// Applies the "Home tile -> Classic TV -> land on AJN archive 1" patch to src/components/HomeView.tsx and src/EpgGuide.tsx.
// Run from the repo root:  node apply-ch016.mjs        (add --check to test without writing)
// Each edit is anchored on exact existing text. If an anchor is missing the script changes NOTHING and says which one.
import fs from 'node:fs';
const check = process.argv.includes('--check');
const edits = {
  'src/components/HomeView.tsx': [
    ['import', /import \{ HERO_POOL, PROGRAM_POOL, type ProgramTile \} from '\.\.\/data\/homeFeatures';\n/,
      (m) => m + "import { requestChannelFocus } from '../guide/focusRequest';\n"],
    ['tiles', /const tiles = useMemo\(\(\) => pickForDay\(PROGRAM_POOL, \(t\) => t\.id, dateKey, 3, 'tiles'\), \[dateKey\]\);/,
      () => `// Pinned tiles always show (they take a slot); the remaining slots rotate daily.
  const tiles = useMemo(() => {
    const pinned = PROGRAM_POOL.filter((t) => t.pinned);
    const rest = PROGRAM_POOL.filter((t) => !t.pinned);
    return [...pickForDay(rest, (t) => t.id, dateKey, Math.max(0, 3 - pinned.length), 'tiles'), ...pinned];
  }, [dateKey]);`],
    ['open', /(      saveLastView\(\{ guideId: t\.guideId \}\);\n)(      window\.dispatchEvent\(new CustomEvent\('ajn:select-guide')/,
      (m, a, b) => a + "      if (t.focusChannelId) requestChannelFocus(t.guideId, t.focusChannelId);\n" + b],
  ],
  'src/EpgGuide.tsx': [
    ['import', /import \{[^}]*\} from '\.\/guide\/channelIndex';\n/,
      (m) => m + 'import { FOCUS_EVENT, peekChannelFocus, takeChannelFocus } from "./guide/focusRequest";\n'],
    ['logic', /(  const hasMore = filtered\.rows\.length > visibleCount;\n)/,
      (m, a) => a + `
  // Land on one channel (Home tile / link): wait for this guide's schedule, clear filters that could hide it, mount its page
  // of rows, scroll it to the middle and flash it. A request for a channel that is not in the guide is dropped after 15 s.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.guideId === guideId) setFocusTick((n) => n + 1); };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [guideId]);
  useEffect(() => {
    if (!active || channels === null) return;
    const req = peekChannelFocus(guideId);
    if (!req || !numbered.some((n) => n.channel.id === req.channelId)) return;
    takeChannelFocus(guideId);
    setQuery(''); setCategory(ALL_CATEGORIES); setOnNowOnly(false); setVisibleCount(PAGE_ROWS);
    setFocusId(req.channelId);
  }, [active, channels, numbered, guideId, focusTick]);
  useEffect(() => {
    if (!focusId || deferredQuery.trim() !== '' || category !== ALL_CATEGORIES || onNowOnly) return;
    const idx = filtered.rows.findIndex((r) => r.channel.id === focusId);
    if (idx < 0) return;
    if (idx >= visibleCount) { setVisibleCount(idx + PAGE_ROWS); return; }
    const el = Array.from(document.querySelectorAll('[data-channel-id]')).find((n) => n.getAttribute('data-channel-id') === focusId);
    if (!el) return;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    setFlashId(focusId); setFocusId(null);
  }, [focusId, filtered, visibleCount, deferredQuery, category, onNowOnly]);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2500);
    return () => window.clearTimeout(t);
  }, [flashId]);
`],
    ['row', /(                data-highlight=\{channel\.highlight\}\n)/,
      (m, a) => a + "                data-channel-id={channel.id}\n"],
    ['flash', /border-b border-neutral-800 px-3\.5 \$\{channel\.highlight === 'must-listen'/,
      () => "border-b border-neutral-800 px-3.5 ${flashId === channel.id ? 'bg-amber-500/15 ring-2 ring-inset ring-amber-400/70 ' : ''}${channel.highlight === 'must-listen'"],
  ],
};
const out = {}; const problems = [];
for (const [file, list] of Object.entries(edits)) {
  if (!fs.existsSync(file)) { problems.push(`${file}: not found (run from the repo root)`); continue; }
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('focusRequest')) { console.log(`${file}: already patched, skipped`); continue; }
  for (const [name, re, fn] of list) {
    const hits = s.match(new RegExp(re.source, re.flags + (re.flags.includes('g') ? '' : 'g')));
    if (!hits || hits.length !== 1) { problems.push(`${file}: anchor "${name}" matched ${hits ? hits.length : 0} times (need exactly 1)`); continue; }
    let repl = fn;
    if (name === 'logic' && !/setOnNowOnly/.test(s)) repl = (...a) => fn(...a).replace(' setOnNowOnly(false);', '').replace(' || onNowOnly', '').replace(', onNowOnly]);', ']);');
    s = s.replace(re, repl);
  }
  out[file] = s;
}
if (problems.length) { console.error('NOTHING WRITTEN.\n' + problems.join('\n')); process.exit(1); }
for (const [file, s] of Object.entries(out)) {
  if (check) { console.log(`${file}: OK (would write ${Buffer.byteLength(s)} bytes)`); continue; }
  fs.copyFileSync(file, file + '.bak-ch016'); fs.writeFileSync(file, s);
  console.log(`${file}: patched, ${Buffer.byteLength(s)} bytes (backup: ${file}.bak-ch016)`);
}
