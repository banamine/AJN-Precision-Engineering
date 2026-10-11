# Guide channel icons - complete set (2026-10-10)
Your workspace had the 4 new PNGs but NOT the code that draws icons in the Guide, nor the other 9 PNGs. This zip adds everything; same-path replacement.
- src/components/ChannelLogo.tsx (NEW) - draws the icon, falls back to the Tv/Radio icon if missing or broken.
- src/EpgGuide.tsx - ONLY change: imports ChannelLogo and uses it in the channel column (Tv/Radio icon kept as fallback).
- public/logos/news/*.png - all 13 icons (fox-news, cnn, msnbc, bbc, kpix, cbc, ctv, aljazeera, france24, trt-world, dw, rt, rt-documentaries).
- src/data/newsLogos.json, guideRegistry.ts, test-channel-logo.tsx - same as the previous logos zip.
Verify after publish: Guide > Cable TV channel column shows the icons; curl.exe -s "https://ajn-precision-engineering.ai.studio/api/schedule?guide=cable-tv" | findstr logo
