# NEWS CUBE

## Scope

NEWS CUBE is a read-only view over the Daily News Digest. It is not a news
ingestion service, player, schedule, library category, or second media pipeline.
The current feed contains headlines and links only; the adapter never sets
`mediaReference`.

## Source and update behavior

- Default JSON: `https://banamine.github.io/Daily-News-Digest-/data/current/data.json`
- Override: `VITE_NEWS_DIGEST_URL`
- A visible tab revalidates every 10 minutes with `cache: no-store`. Polling pauses
  while the tab is hidden. Retry is user initiated after a failed request.
- The 10-minute interval is a refresh cadence, not a client/server storage cache;
  News Cube keeps no feed snapshot beyond the current page's in-memory state.
- A failed refresh leaves the last good in-memory snapshot on screen.
- If new records arrive while the user is rotating, dragging, or reading a detail
  card, the current allocation stays fixed. “New stories available” applies the
  pending snapshot on click.
- `last_updated` comes from the digest. The page warns when it is more than 36
  hours old or unusable.
- Article data is held only in page memory. There is no News Cube localStorage,
  IndexedDB, server cache, or server-side purge. A reload fetches the feed again.

## Admission and allocation

`toCubeArticles` validates titles and HTTP(S) source links, strips only known
tracking parameters, rejects the digest's documented `alexjoneslive.com/story-N`
fallback pattern, deduplicates by ID and then normalized URL, parses the RFC-822
`published` field, and keeps ages from 0 to 48 hours with at most 10 minutes of
future skew. Missing or invalid dates and out-of-window dates are excluded and
counted. `images.unsplash.com` is treated as no article image.

Summaries are plain text only. The adapter strips complete and cut-off HTML tags,
decodes supported named and numeric entities, removes the “appeared first on”
footer, and returns an empty summary when cleaned text is only a bare URL or a
repeat of the title and publisher. This covers Google News link snippets and
truncated WordPress footer markup; no source string is rendered as HTML.

The current adapter does not use `category` as a topic. Publisher filtering is
limited to `feedId`/publisher identity. Newest-first items fill six faces with
six slots each (36 total); unused slots are empty, not generated stories.

## Cube and accessibility

All News Cube page text inherits `overflow-wrap: anywhere`; panel-canvas drawing
also breaks unspaced long tokens to fit each card.

The route is lazy-loaded, and Three.js is pinned to `0.180.0`; it is in the News
Cube route chunk rather than the main entry chunk. One visible WebGL canvas is
used. Text is drawn with canvas text from validated article strings. Article
images are loaded with anonymous CORS only for a face being prepared for viewing;
failed or CORS-tainted images leave the text card in place.

Rotation is off by default. Face buttons, drag, arrow keys, and the optional
auto-rotate toggle use the same `beginCubeNavigation` path. Navigation pauses
cube-originated playback, closes the detail card, and changes face; reduced-motion
preference disables auto-rotation and makes face changes immediate. The List view
is the keyboard/mobile fallback and exposes all 36 slots with real source links.
Enter opens the first available article on the focused cube face; Escape closes
the detail card.

## Playback boundary

The current feed contains no audio or video and the adapter does not synthesize
media fields. The detail card says “No audio/video for this story.” The
`playbackBridge` provides a stale-request guard and blocks Archive-hosted media
when the existing Archive health state is `down` or `unreachable_from_here`.
If a later feed supplies `mediaReference`, the bridge pauses the existing
authoritative player before delegating to App's existing playback entry point.
It creates no media element and does not change HLS teardown behavior.

## Limits / not done

- The digest is updated daily, not continuously; the 10-minute refresh only
  discovers a newly published JSON file.
- The source may contain old or unparseable dates, stock images, duplicate items,
  and documented fallback stories. The adapter counts and excludes these.
- There is no server-side 48-hour deletion. The 48-hour window is applied at read
  time; no News Cube cache is retained.
- No media playback is available from the current feed.
- Three.js/WebGL behavior on physical devices and browser-specific GPU drivers
  still needs real-device verification.
