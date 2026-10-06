from __future__ import annotations

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def run(url: str) -> int:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await page.add_init_script(
            """
            (() => {
              const OriginalAudioContext = window.AudioContext;
              let count = 0;
              window.__ajnAudioContextCount = () => count;
              class CountingAudioContext extends OriginalAudioContext {
                constructor(...args) {
                  super(...args);
                  count += 1;
                }
              }
              window.AudioContext = CountingAudioContext;
              if (window.webkitAudioContext) window.webkitAudioContext = CountingAudioContext;
            })();
            """
        )
        await page.goto(url, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1000)
        count = await page.evaluate("window.__ajnAudioContextCount ? window.__ajnAudioContextCount() : 0")
        print(json.dumps({"audio_context_count": count, "strict_singleton_gate": count <= 1}, indent=2))
        await browser.close()
        return 0 if count <= 1 else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    return asyncio.run(run(args.url))


if __name__ == "__main__":
    raise SystemExit(main())
