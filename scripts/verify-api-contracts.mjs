const base = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function check(name, url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  console.log(`=== ${name} ===`);
  console.log(`STATUS=${response.status}`);
  console.log(`CONTENT_TYPE=${response.headers.get('content-type') || ''}`);
  console.log(`BODY=${text.slice(0, 1000)}`);
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}`);
  return text;
}

await check('WATCHDOG', `${base}/api/watchdog/heartbeat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ event: 'CI_CONTRACT_SMOKE', ts: Date.now() }),
});

await check('NEWS_V1', `${base}/api/v1/news`);

console.log('PASS: API compatibility contracts responded with 2xx.');
