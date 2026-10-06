from __future__ import annotations

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def run(url: str) -> int:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(url, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1000)

        result = {
            "url": url,
            "cross_origin_attributes": await page.locator("video, audio").evaluate_all(
                "els => els.map(el => ({tag: el.tagName.toLowerCase(), value: el.getAttribute('crossorigin')}))"
            ),
            "overflow": await page.evaluate("({scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth})"),
            "buttons": await page.locator("button, a[href]").count(),
            "title": await page.title(),
        }
        overflow_pass = result["overflow"]["scrollWidth"] <= result["overflow"]["innerWidth"]
        cross_origin_pass = all(item["value"] in (None, "") for item in result["cross_origin_attributes"])
        result["no_page_overflow"] = overflow_pass
        result["cross_origin_clear"] = cross_origin_pass
        print(json.dumps(result, indent=2, sort_keys=True))
        await browser.close()
        return 0 if overflow_pass and cross_origin_pass else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    return asyncio.run(run(args.url))


if __name__ == "__main__":
    raise SystemExit(main())
