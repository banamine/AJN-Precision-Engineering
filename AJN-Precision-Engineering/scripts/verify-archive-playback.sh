#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
BBB="/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"

echo "== 1. BBB bounded range =="
curl -fsS -D /tmp/ajn-bbb-headers \
  -H 'Range: bytes=0-1023' \
  "${BASE}/api/archive/proxy?path=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("'"$BBB"'"))')" \
  -o /tmp/ajn-bbb.bin
cat /tmp/ajn-bbb-headers
wc -c /tmp/ajn-bbb.bin

echo
echo "== 2. BBB open-ended continuation =="
curl -fsS -D /tmp/ajn-bbb-cont-headers \
  -H 'Range: bytes=2097152-' \
  "${BASE}/api/archive/proxy?path=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("'"$BBB"'"))')" \
  -o /tmp/ajn-bbb-cont.bin
cat /tmp/ajn-bbb-cont-headers
wc -c /tmp/ajn-bbb-cont.bin

echo
echo "== 3. News sources =="
curl -fsS "${BASE}/api/news/archive/sources" | python3 -m json.tool

echo
echo "PASS: transport and source endpoints responded."
