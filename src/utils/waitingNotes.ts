/* Picks the funny waiting-room notes (src/data/waitingNotes.json). Pure and seedable so it can be unit-tested.
 * Randomised with a shuffle bag: every note is used once before any repeats, and the same note never shows twice in a row. */
export type WaitKind = 'loading' | 'seeking' | 'buffering' | 'stalled';
export interface Acronym { short: string; long: string }
export interface WaitingNotesData {
  settings: { showAfterMs: number; rotateMs: number; slowAfterMs: number; retryAfterMs: number };
  kinds: Record<string, { label: string }>;
  acronyms: Record<string, Acronym[]>;
  themes: { id: string; label: string; emoji: string; lines: string[] }[];
  slow: string[];
  quotes: string[];
}
export interface Note { text: string; emoji: string; theme: string; kind: 'line' | 'slow' | 'quote' }

/** Which wait is it? Derived from the player's real status text; null means "not a wait" (Playing, Ready, errors...). */
export function waitKindOf(status: string): WaitKind | null {
  if (/^Seeking/i.test(status)) return 'seeking';
  if (/^Network stalled/i.test(status)) return 'stalled';
  if (/^(Buffering|Reconnecting)/i.test(status)) return 'buffering';
  if (/^(Loading|Starting playback)/i.test(status)) return 'loading';
  return null;
}

export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

export interface Deck { acronym(kind: WaitKind): Acronym; next(elapsedMs: number): Note }

export function createDeck(data: WaitingNotesData, rng: Rng = Math.random): Deck {
  const lineBag: Note[] = []; let last = '';
  const acrBags = new Map<string, Acronym[]>(); let lastAcr = '';
  const slowBag: string[] = []; const quoteBag: string[] = []; let tick = 0;
  const refill = () => {
    const all = data.themes.flatMap((t) => t.lines.map((text) => ({ text, emoji: t.emoji, theme: t.id, kind: 'line' as const })));
    // interleave themes: shuffle, then a stable pass that avoids two lines of the same theme in a row where possible
    const s = shuffle(all, rng); const out: Note[] = [];
    while (s.length) { const prev = out[out.length - 1]; const i = s.findIndex((n) => !prev || n.theme !== prev.theme); out.push(...s.splice(i < 0 ? 0 : i, 1)); }
    lineBag.push(...out);
  };
  const pull = <T,>(bag: T[], src: readonly T[], same: (a: T) => boolean): T => {
    if (!bag.length) bag.push(...shuffle(src, rng));
    let i = bag.findIndex((x) => !same(x)); if (i < 0) i = 0;
    return bag.splice(i, 1)[0];
  };
  return {
    acronym(kind) {
      const pool = [...(data.acronyms[kind] ?? []), ...(data.acronyms.any ?? [])];
      const key = kind; let bag = acrBags.get(key); if (!bag) { bag = []; acrBags.set(key, bag); }
      const a = pull(bag, pool, (x) => x.short === lastAcr); lastAcr = a.short; return a;
    },
    next(elapsedMs) {
      tick++;
      const slow = elapsedMs >= data.settings.slowAfterMs && data.slow.length;
      let n: Note;
      if (slow && tick % 2 === 0) n = { text: pull(slowBag, data.slow, (x) => x === last), emoji: '⏳', theme: 'slow', kind: 'slow' };
      else if (tick % 5 === 0 && data.quotes.length) n = { text: pull(quoteBag, data.quotes, (x) => x === last), emoji: '💬', theme: 'quote', kind: 'quote' };
      else {
        if (!lineBag.length) refill();
        let i = lineBag.findIndex((x) => x.text !== last); if (i < 0) i = 0;
        n = lineBag.splice(i, 1)[0];
      }
      last = n.text; return n;
    },
  };
}
