from __future__ import annotations

import argparse
import json
from urllib.parse import urlparse

import httpx


def check_target(name: str, target: str) -> dict[str, object]:
    parsed = urlparse(target)
    safe = parsed.scheme in {"http", "https"} and parsed.hostname is not None
    return {"name": name, "target": target, "safe_url_shape": safe, "host": parsed.hostname, "scheme": parsed.scheme}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    probes = [
        ("path-traversal", f"{args.url.rstrip('/')}/api/proxy?url=/../etc/passwd"),
        ("scheme-inject", f"{args.url.rstrip('/')}/api/proxy?url=https://evil.com"),
    ]
    results = []
    exit_code = 0
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        for name, url in probes:
            try:
                response = client.get(url)
                passed = response.status_code in {400, 403}
                if not passed:
                    exit_code = 1
                results.append({"name": name, "status": "PASS" if passed else "FAIL", "http_status": response.status_code, "url": url})
            except httpx.HTTPError as exc:
                exit_code = 1
                results.append({"name": name, "status": "FAIL", "error": str(exc), "url": url})
    print(json.dumps({"results": results}, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
