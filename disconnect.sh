curl "http://localhost:3000/api/archive/proxy?path=%2Fdownload%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper.mp4%3Fstart%3D0%26end%3D300" -o /tmp/disconnect.mp4 &
PID=$!
sleep 2
kill $PID
