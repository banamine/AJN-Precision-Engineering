/** Display-time wording rule (owner, 2026-11-18): the app never shows the word "archive"; it says "library".
 *  Pure text rewrite for what a person SEES. Never applied to URLs, ids, file paths or stored data. */
function caseLike(orig: string, lower: string): string {
  if (orig.length > 1 && orig === orig.toUpperCase()) return lower.toUpperCase();
  if (orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()) return lower[0].toUpperCase() + lower.slice(1);
  return lower;
}
/** "the library" is capitalized only at the start of a sentence (or all-caps text). */
function theLibrary(m: string, offset: number, whole: string): string {
  if (m.length > 3 && m === m.toUpperCase()) return 'THE LIBRARY';
  const before = whole.slice(0, offset).trimEnd();
  return before === '' || /[.!?:]$/.test(before) ? 'The library' : 'the library';
}
export function libraryWording(text: string): string {
  if (!text || !/archive/i.test(text)) return text;
  let out = text;
  // phrase rules carry their own replacement text with a group reference; handle them explicitly
  out = out.replace(/\bthe Internet Archive\b/gi, (m, off: number, s: string) => theLibrary(m, off, s));
  out = out.replace(/\bInternet Archive\b/gi, (m, off: number, s: string) => theLibrary(m, off, s));
  out = out.replace(/\bArchive\.org\b/gi, (m, off: number, s: string) => theLibrary(m, off, s));
  out = out.replace(/\bMedia Archive Library\b/gi, (m) => caseLike(m, 'media library'));
  out = out.replace(/\bArchive Library\b/gi, (m) => caseLike(m, 'library'));
  out = out.replace(/\b(hourly (?:broadcast )?)(archives)\b/gi, (_m, a: string, b: string) => a + caseLike(b, 'recordings'));
  out = out.replace(/\barchived\b/gi, (m) => caseLike(m, 'recorded'));
  out = out.replace(/\b(not available|available|found|stored) on Archive\b/gi, (_m, a: string) => `${a} in the library`);
  out = out.replace(/\b(by|from|to|of) Archive\b/gi, (_m, a: string) => `${a} the library`);
  out = out.replace(/\barchives\b/gi, (m) => caseLike(m, 'libraries'));
  out = out.replace(/\barchive\b/gi, (m) => caseLike(m, 'library'));
  return out;
}
