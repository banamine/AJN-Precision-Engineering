function canonicalPathFromProxyUrl(url) {
  const u = new URL(url, "https://example.test");
  let path = u.searchParams.get("path") || "";
  for (let i = 0; i < 2; i += 1) {
    const next = decodeURIComponent(path);
    if (next === path) break;
    path = next;
  }
  return path;
}

const cases = [
  ["https://example.test/api/archive/proxy?path=%2Fdownload%2FThe_Fugitive_Series%2FThe%2520Fugitive.mp4", "/download/The_Fugitive_Series/The Fugitive.mp4"],
  ["https://example.test/api/archive/proxy?path=%2Fdownload%2F1a-3_20240519%2F52%2F%25238%2FThe%2520Sopranos.mp4", "/download/1a-3_20240519/52/#8/The Sopranos.mp4"],
  ["https://example.test/api/archive/proxy?path=%2Fdownload%2FCNNW%2FCNNW.mp4%3Fstart%3D0%26end%3D300", "/download/CNNW/CNNW.mp4?start=0&end=300"],
];
let failed = false;
for (const [input, expected] of cases) {
  const actual = canonicalPathFromProxyUrl(input);
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}: ${actual}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
