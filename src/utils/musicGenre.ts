/* Genre picture for a music channel that has no usable cover. Pure; first matching rule wins.
 * Pictures live in public/genre-art/<file>. "live" has no picture of its own yet and shares the "oldies" one. */
export type MusicGenre = 'easy' | 'rock' | 'pop' | 'hits' | 'jazz' | 'dance' | 'disco' | 'country' | 'classical' | 'soundtrack' | 'love' | 'live' | 'oldies' | 'default';

const RULES: ReadonlyArray<readonly [MusicGenre, RegExp]> = [
  ['soundtrack', /movie theme|soundtrack|hollywood|film score/i],
  ['love', /love song|romantic|erotic/i],
  ['classical', /tallis|orthodox|motet|choral|classical|symphon|pravoslavn/i],
  ['dance', /\bedm\b|rave|trance|house music|dancemania|dance|spacesynth|dream dance|chicane|booom/i],
  ['hits', /billboard|top 40|top 100|year[- ]end|chart|radio hits|\bhits\b/i],
  ['rock', /audioslave|\beagles\b|moody blues|zappa|electric light orchestra|\bzz\b|ac\/dc|jefferson airplane|slow rock|^america\b|\brock\b/i],
  ['jazz', /jazz|saxophone|trumpet|montreux|bob james|klugh|fourplay|weather report|dexter gordon|jarreau|sanborn/i],
  ['disco', /disco|everybody clap|^80-?\s*90/i],
  ['country', /country/i],
  ['easy', /chill|relax|new age|caf[eé] del mar|ambien|saxappeal|easy listening/i],
  ['pop', /doja|timberlake|school days|\bpop\b/i],
  ['live', /kwst|k101|wnew|wmmr|ksan|wbcn|rockpalast|live at|amphitheat/i],
  ['oldies', /\b19[5-8]\d\b|\b[5-8]0'?s\b|new wave|oldies/i],
];

export function genreForName(name?: string | null): MusicGenre {
  const n = String(name ?? '');
  for (const [genre, re] of RULES) if (re.test(n)) return genre;
  return 'default';
}

const FILE: Record<MusicGenre, string> = {
  easy: 'easy', rock: 'rock', pop: 'pop', hits: 'hits', jazz: 'jazz', dance: 'dance', disco: 'disco', country: 'country',
  classical: 'classical', soundtrack: 'soundtrack', love: 'love', live: 'oldies', oldies: 'oldies', default: 'default',
};
export const genreArtUrl = (g: MusicGenre): string => `/genre-art/${FILE[g]}.jpg`;

/** Genre art applies to music channels only (Archive "Music" group or an audio channel whose group says music). */
export function isMusicGroup(group?: string | null): boolean { return /^music$/i.test(String(group ?? '').trim()); }
