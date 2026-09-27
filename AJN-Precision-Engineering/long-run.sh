curl --limit-rate 5k "http://localhost:3000/api/archive/proxy?path=%2Fdownload%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper.mp4%3Fstart%3D0%26end%3D300" -o /tmp/long.mp4 &
PID=$!
echo "Started curl with PID $PID"
sleep 65
kill $PID
ls -l /tmp/long.mp4 | awk '{print $5}'
