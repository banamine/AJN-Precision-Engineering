# Verification Gate

## Phase 1: transport

```bash
BASE=http://localhost:3000 bash scripts/verify-archive-playback.sh
```

Expected:

```text
206
Content-Type: video/mp4
Content-Length: 1024
Content-Range: bytes 0-1023/...
```

For the continuation request:

```text
206
Content-Type: video/mp4
Content-Range: bytes 2097152-.../...
```

The downloaded byte count must equal the declared `Content-Length`.

## Phase 2: source resolution

```bash
curl -sS http://localhost:3000/api/news/archive/fox?rows=5 | jq '.playable | map({identifier,filename,state})'
curl -sS http://localhost:3000/api/news/archive/cnn?rows=5 | jq '.playable | map({identifier,filename,state})'
curl -sS http://localhost:3000/api/news/archive/msnbc?rows=5 | jq '.playable | map({identifier,filename,state})'
curl -sS http://localhost:3000/api/news/archive/bbc?rows=5 | jq '.playable | map({identifier,filename,state})'
```

Every returned item must have:

```text
state = PLAYABLE
filename ends with .mp4
proxyUrl is non-empty
```

## Phase 3: browser

Test in this order:

1. Big Buck Bunny.
2. FOX known-good item.
3. CNN.
4. MSNBC.
5. BBC.
6. Seek forward.
7. Wait 30-60 seconds.
8. Switch to another program.
9. Confirm previous media is cleaned up.

Required browser evidence:

```text
readyState >= 3
currentTime advances
video.error = null
actual video frame visible
```
