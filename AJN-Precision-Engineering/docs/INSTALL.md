# AJN Archive + News Playback Drop-In

## Scope

This package adds one authoritative Archive media path:

```text
Archive discovery
  -> metadata
  -> actual MP4 derivative
  -> /api/archive/proxy
  -> native <video>
```

It supports:

- FOX: `TV-FOXNEWSW`
- CNN: `TV-CNNW`
- MSNBC: `TV-MSNBCW`
- BBC: `TV-BBCNEWS`

The resolver never fabricates `{identifier}.mp4`.

## Install

Copy these files into the project:

```text
server/archiveNewsResolver.ts
server/routes/archiveProxy.ts
server/routes/archiveNews.ts
src/services/ArchiveNewsClient.ts
scripts/apply-archive-news-dropin.mjs
```

Then run:

```bash
node scripts/apply-archive-news-dropin.mjs
npm run lint
npm run build
npm run start
```

## Transport contract

The proxy:

- forwards browser `Range` exactly
- has no artificial 2 MiB clamp
- preserves `206`, `Content-Range`, and `Content-Length`
- refuses HTML/JSON upstream responses as media
- accepts `/download/...` and `/NN/items/...`
- preserves Archive clipping query strings
- does not manufacture a `206` response when Archive returns `200`

## Important

This package is intentionally not a replacement for the existing five-destination UI or scheduler. It supplies the corrected media/news transport and resolver path.

After installation, the guide/player must use `ArchiveNewsClient.playUrl(item)` or the returned `proxyUrl` for Archive programs. A program without `state: PLAYABLE` must not be sent to `<video>`.
