#!/usr/bin/env bash
# Real-network Archive outage drill.
#
# Runs the real server, blackholes archive.org locally (hosts entry -> 127.0.0.1, so
# connections are refused while every other host stays reachable) and checks that
# outage mode behaves end to end: ok -> down, control check reachable, non-Archive
# routes unaffected, then recovery once access is restored. Needs root (edits /etc/hosts);
# the hosts file is always restored on exit. Never contacts archive.org during the outage.
#
# Usage: sudo scripts/archive-outage-drill.sh      (expects dist/server.cjs from `npm run build`)
set -u
PORT="${DRILL_PORT:-8099}"
BASE="http://127.0.0.1:${PORT}"
HOSTS_BAK="$(mktemp)"
LOG="${DRILL_LOG:-/tmp/archive-outage-drill.log}"
FAIL=0
SERVER_PID=""

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; FAIL=1; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]])}catch{console.log("")}})' "$1"; }
status_field() { curl -s -m 5 "${BASE}/api/archive/status" | field "$1"; }
wait_for() { # name, field, wanted, timeout_s
  local end=$((SECONDS + $4))
  while [ $SECONDS -lt $end ]; do
    [ "$(status_field "$2")" = "$3" ] && { pass "$1 (${2}=${3})"; return 0; }
    sleep 3
  done
  fail "$1: ${2} never became ${3} within ${4}s (last: $(curl -s -m 5 "${BASE}/api/archive/status"))"; return 1
}
cleanup() {
  cp "$HOSTS_BAK" /etc/hosts 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$HOSTS_BAK"
}
trap cleanup EXIT

[ -f dist/server.cjs ] || { echo "dist/server.cjs missing: run npm run build"; exit 2; }
cp /etc/hosts "$HOSTS_BAK"

NODE_ENV=production PORT="$PORT" node dist/server.cjs > "$LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -sf -m 2 "${BASE}/api/health" >/dev/null && break; sleep 1; done
curl -sf -m 2 "${BASE}/api/health" >/dev/null || { fail "server did not start (see $LOG)"; exit 1; }

echo "127.0.0.1 archive.org www.archive.org" >> /etc/hosts
[ "$(status_field state)" = "ok" ] && pass "starts in state ok" || fail "starts in state ok (got $(status_field state))"

for i in 1 2 3 4; do for f in a b; do
  code=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "${BASE}/api/archive/proxy?path=/download/drill-item-${i}/${f}.mp4")
  [ "$code" = "502" ] || fail "proxy request ${i}${f} returned ${code}, expected 502"
done; done
[ "$(status_field state)" = "down" ] && pass "8 refused requests across 4 items -> state down" || fail "expected down, got $(status_field state)"
[ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "${BASE}/api/health")" = "200" ] && pass "non-Archive route /api/health unaffected" || fail "/api/health affected by outage"
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "${BASE}/api/archive/proxy?path=/download/drill-item-9/x.zip/inner.mp4")
[ "$code" = "422" ] && pass "item-specific failure still returns 422, not counted as outage" || fail "unplayable member returned ${code}"

wait_for "probe reaches the control URL" control ok 200
[ "$(status_field state)" = "down" ] && pass "still down with control reachable (real Archive outage, not our network)" || fail "state after control probe: $(status_field state)"

cp "$HOSTS_BAK" /etc/hosts
echo "access restored; waiting for recovery"
wait_for "recovers after access is restored" state ok 240

echo "--- last health log lines ---"; grep '"state"' "$LOG" | tail -3 | cut -c1-240
[ "$FAIL" = "0" ] && echo "ARCHIVE OUTAGE DRILL: PASS" || echo "ARCHIVE OUTAGE DRILL: FAIL"
exit "$FAIL"
