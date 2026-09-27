const url = "https://archive.org/download/2015-music.-7z/VOM/The%20Odd%20Couple%20S01-S05%20%281970-%29/The%20Odd%20Couple%20S01%20%28360p%20re-dvdrip%29/The%20Odd%20Couple%20S01E03%20Felix%20gets%20Sick.mp4";

async function run() {
  console.log("Fetching upstream URL:", url);
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Range': 'bytes=0-1023'
    }
  });

  console.log("Status:", res.status, res.statusText);
  console.log("Content-Type:", res.headers.get('content-type'));
  console.log("Content-Length:", res.headers.get('content-length'));
  console.log("Content-Range:", res.headers.get('content-range'));
  console.log("Accept-Ranges:", res.headers.get('accept-ranges'));
  console.log("Final URL (after redirects):", res.url);
  
  const buf = await res.arrayBuffer();
  console.log("Received bytes length:", buf.byteLength);
}

run().catch(console.error);
