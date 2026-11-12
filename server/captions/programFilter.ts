// Which Archive TV-news programs the strip may use. EXPLICIT DENY-LIST of non-news genres (true crime, comedy/late-night,
// sport, travel, tech magazines). Opinion/talk programs on news channels are deliberately KEPT: they are news-channel
// programming and the card is already labelled as a caption excerpt, not a headline.
// Built from program titles seen on FOXNEWSW/CNNW/MSNOW/BBCNEWS over 4 days (2026-11-05..08): it is a hand-made list,
// not a classifier, and will need additions when new entertainment titles appear.

const NON_NEWS_TITLES: readonly RegExp[] = [
  /\bdateline\b/,
  /\breal time with bill maher\b/, /\bhave i got news for you\b/, /\bgutfeld\b/, /\bjimmy failla\b/, /\btable for five\b/,
  /\bsport\b/,
  /\btravel show\b/, /\bafrican adventure\b/,
  /\btechxplore\b/, /\btech now\b/, /\bai decoded\b/,
];

/** `title` is the program title from the Archive identifier (underscores already turned into spaces). */
export function isNewsProgramTitle(title: string): boolean {
  const t = title.toLowerCase().replace(/\s+/g, ' ').trim();
  return !NON_NEWS_TITLES.some((re) => re.test(t));
}

