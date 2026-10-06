from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import urljoin

import httpx

from .common import Result

ENDPOINTS = [
    ("/api/health", "GET"),
    ("/api/news/rss", "GET"),
    ("/api/watchdog/heartbeat", "POST"),
    ("/api/v1/news", "GET"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    base = args.url.rstrip("/") + "/"
    exit_code = 0
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        for path, method in ENDPOINTS:
            url = urljoin(base, path.lstrip("/"))
            try:
                response = client.request(method, url)
                detail = f"HTTP {response.status_code}"
                evidence = {"url": url, "status": response.status_code}
                if path == "/api/news/rss" and response.is_success:
                    try:
                        payload = response.json()
                        if isinstance(payload, dict):
                            items = payload.get("items")
                            if isinstance(items, list):
                                evidence["items"] = len(items)
                                detail += f"; RSS items={len(items)}"
                    except json.JSONDecodeError:
                        evidence["body_type"] = response.headers.get("content-type", "")
                    print(json.dumps({"name": path, "status": "INFO", "detail": detail, "evidence": evidence}))
                    continue
                expected = {"/api/health": 200, "/api/news/rss": 200, "/api/watchdog/heartbeat": 200, "/api/v1/news": 200}[path]
                status = "PASS" if response.status_code == expected else "FAIL"
                if status == "FAIL":
                    exit_code = 1
                print(json.dumps({"name": path, "status": status, "detail": detail, "evidence": evidence}))
            except httpx.HTTPError as exc:
                exit_code = 1
                print(json.dumps({"name": path, "status": "FAIL", "detail": str(exc), "evidence": {"url": url}}))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
