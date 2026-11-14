# TV Guide Genre Pills Expansion & Copper Styling Plan (revised)

Expand the TV Guide category bar from five coarse pills into a multi-genre bar: **Comedy, Drama, Sci-Fi, Action & Adventure, Crime & Mystery, Horror & Thriller, War & History, Family & Kids**, alongside the existing **Cartoons, Westerns, Soap Operas** and the **Classic TV** catch-all. Pills wrap onto multiple rows and use warm amber/copper styling.

## Confirmed decisions (unchanged)
1. Expanded genre set as above.
2. Multi-genre matching: a channel appears under every genre it matches.
3. Wrapping multi-row pill layout (no horizontal scroll strip).
4. Warm amber/copper pill styling (active, hover, focus ring).

## Revisions made in review
- **Show-info coverage.** `showInfo.json` has 104 shows but only 11 are linked to channel ids, so an id-only lookup would leave most Classic TV channels uncategorized. Genre resolution now runs, in order: (1) show-info by channel id, (2) show-info by normalized title ("The Jeffersons (complete TV series)" and "Taxi — All Seasons" reduce to "jeffersons" and "taxi"), (3) a small curated table for well-known series missing from showInfo.json, (4) conservative name keywords (western, crime, sitcom, ...). Anything unmatched stays under **Classic TV**.
- **Pill ids stay compatible with saved choices.** Ids are the folded label (`westerns`, `cartoons`, `soap operas`, `classic tv`, `action & adventure`...), not new slugs like `soap-operas`, so existing saved per-guide filters keep working. A saved id with no channels still falls back to All (existing behavior).
- **Scope of enrichment.** Genres are added only to channels in the Classic TV, Westerns, Cartoons and Soap Operas groups. Other guides (News, Movies, Radio, ...) keep their own group pills unchanged, so there is no regression.
- **Raw tag mapping.** Romance -> Drama; Espionage -> Crime & Mystery; Fantasy -> Sci-Fi; Supernatural -> Horror & Thriller; Sports and Nature add no pill.
- **Ordering.** All first, then genres by count (ties alphabetical), **Classic TV always last** (not count-sorted) and only shown if uncategorized channels remain.
- **Counts.** Pill counts can sum to more than the channel total; All stays the exact total.
- **Touch targets.** Coarse-pointer screens get a taller pill (min-h-9, larger text).
- **Fixed** the broken architecture diagram (below).

## Architecture
```
Guide channels (id, name, group) ──┐
showInfo.json (genres, by id/title)─┼─► genreBuckets.categoriesOf(channel) -> pills[]
Curated titles + name keywords ─────┘            (cached per channel object)
                                                   │
channelIndex.categoryCounts(list) -> pills with deduplicated counts (Classic TV last)
channelIndex.filterChannels(list, index, query, category, onlyIf)
   category matches if ANY of the channel's pills has that id; then search + On-now apply
                                                   │
EpgGuide pill bar: flex-wrap, aria-pressed, data-category, amber/copper styling
```
Station numbers (001..N), search, On now, saved filter prefs `{category, onNow}` are unchanged.

## Files (drop-in)
- `src/guide/genreBuckets.ts` (new): buckets, show-info/title/keyword resolution.
- `src/guide/channelIndex.ts`: `categoryCounts` and `filterChannels` use multi-genre membership; `categoryOf` kept.
- `src/EpgGuide.tsx`: pill bar markup/classes only (wrap + amber/copper).
- `test-guide-channel-index.ts`: updated and extended.

## Verification (run by the user)
1. `npx tsx test-guide-channel-index.ts` -> expect `[guide-channel-index] PASS ...`
2. `npm run typecheck`
3. Open Classic TV guide: pills wrap, All = full count, clicking Comedy lists only comedy channels with their original station numbers, Comedy + search + On now combine, a channel such as Taxi appears under both Comedy and Drama.
4. Reload: last pill is restored; switch to Cable TV/Movies: their pills look as before, with the new styling.
