# AJN Resource Contract

## Source of truth

The AJN audio/video resource catalog is published at:

`https://rss.alexjones.media/`

The original AJN Resource Hub defines these five RSS/HTML pairs:

| ID | Media | HTML | RSS |
|---|---|---|---|
| `Alex` | video | `https://rss.alexjones.media/Alex.html` | `https://rss.alexjones.media/Alex.xml` |
| `WarRoom` | video | `https://rss.alexjones.media/WarRoom.html` | `https://rss.alexjones.media/WarRoom.xml` |
| `SundayLive` | video | `https://rss.alexjones.media/SundayLive.html` | `https://rss.alexjones.media/SundayLive.xml` |
| `AJNHourlyVideo` | video | `https://rss.alexjones.media/AJNHourlyVideo.html` | `https://rss.alexjones.media/AJNHourlyVideo.xml` |
| `AJNHourlyAudio` | audio | `https://rss.alexjones.media/AJNHourlyAudio.html` | `https://rss.alexjones.media/AJNHourlyAudio.xml` |

## Precision Engineering API

- `GET /api/ajn/resources` — returns the authoritative catalog.
- `GET /api/ajn/resources/:feedId` — fetches and normalizes one live RSS feed.
- `GET /api/ajn/status` — probes all five RSS feeds and reports real item counts, latency, and failures.

## Normalized item contract

```ts
interface AjnFeedItem {
  id: string;
  feedId: AjnFeedId;
  title: string;
  url: string;
  mediaType: 'video' | 'audio';
  publishedAt?: string;
  description?: string;
  duration?: string;
  thumbnailUrl?: string;
  metadata: Record<string, string>;
}
```

## Design rules

1. `rss.alexjones.media` is the authoritative AJN feed source.
2. Archive.org discovery remains an independent archive/library source.
3. The server fetches RSS to avoid browser CORS dependence.
4. Feed IDs are allowlisted; arbitrary URLs cannot be supplied to the AJN endpoint.
5. Feed requests have a 20-second server-side timeout.
6. `/api/ajn/status` uses real upstream responses; no synthetic telemetry is permitted.
