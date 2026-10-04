/* Genre tags from Archive evidence (collection ids, subjects, title). Multiple genres per item; "Uncategorized" when nothing matches.
 * Genre names match the Library categories where one exists. Pure, no Node APIs. */
const BY_COLLECTION: Array<[RegExp, string]> = [
  [/^classic_tv$/i, 'Classic TV'], [/^silent_films$/i, 'Silent Films'], [/^feature_films$/i, 'Classic Cinema'],
  [/^scifi_horror$/i, 'Sci-Fi & Horror'], [/^classic_cartoons$/i, 'Cartoons'], [/^prelinger$/i, 'Educational'],
  [/^newsandpublicaffairs$/i, 'News'], [/^oldtimeradio$/i, 'Old-Time Radio'], [/^librivoxaudio$/i, 'Audiobooks'],
  [/^(etree|GratefulDead|audio_music)$/i, 'Music'], [/^(tvnews|tvarchive)$/i, 'News'], [/^(nasa|nasaaudiocollection|spaceflight)$/i, 'Science & Space'],
];
const BY_TEXT: Array<[RegExp, string]> = [
  [/\b(western|cowboys?|gunsmoke|death valley days)\b/i, 'Western'],
  [/\b(documentar(y|ies)|docu)\b/i, 'Documentary'],
  [/\b(news|newsreel|broadcast|headlines)\b/i, 'News'],
  [/\b(cartoons?|animation|animated)\b/i, 'Cartoons'],
  [/\b(sci-?fi|science fiction|horror|monster)\b/i, 'Sci-Fi & Horror'],
  [/\b(music|concert|live at|song|album|band|orchestra)\b/i, 'Music'],
  [/\b(comedy|sitcom|stand-?up)\b/i, 'Comedy'],
  [/\b(sport|football|baseball|basketball|boxing|soccer|hockey)\b/i, 'Sports'],
  [/\b(educational|how to|tutorial|lecture|course|training film)\b/i, 'Educational'],
  [/\b(history|historical|world war|wwii|ww2|vietnam)\b/i, 'History'],
  [/\b(religio\w*|church|sermon|gospel|bible|orthodox)\b/i, 'Religion'],
  [/\b(radio show|old.?time radio|otr)\b/i, 'Old-Time Radio'],
  [/\b(audiobook|librivox)\b/i, 'Audiobooks'],
  [/\b(trailer|feature film|movie)\b/i, 'Movies'],
  [/\b(classic tv|television series|tv series)\b/i, 'Classic TV'],
];
const asList = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : String(v).split(/[;,]/)).map((x) => String(x).trim()).filter(Boolean);

export function inferGenres(input: { collection?: unknown; subject?: unknown; title?: unknown }): string[] {
  const out = new Set<string>();
  for (const c of asList(input.collection)) for (const [re, g] of BY_COLLECTION) if (re.test(c)) out.add(g);
  const text = `${asList(input.subject).join(' ; ')} ; ${String(Array.isArray(input.title) ? input.title[0] : input.title ?? '')}`;
  for (const [re, g] of BY_TEXT) if (re.test(text)) out.add(g);
  return out.size ? [...out] : ['Uncategorized'];
}
