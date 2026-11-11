# SourcePrism3D Live Radio Box Resizing & Cockpit Switch Theme Plan

## 1. Goal & Scope
Update `src/components/SourcePrism3D.tsx` (and `src/cockpit.css` only if a compact grid-tile helper is needed) so that:
1. **2-Column Station Switch Grid with Full-Width 5th Switch**: The 5 `FACTORY_RADIO_PRESETS` switches inside Facet 0 (`LIVE RADIO`) replace the cramped `lg:grid-cols-5` layout with a 2-column grid (`grid-cols-2`), where the 5th switch (`05 · 109 Warm`) spans both columns (`col-span-2`).
2. **2-Line Wrapped Station Labels with Scaled Typography**: Station names inside each switch no longer clip to a few characters via single-line `truncate`. Instead, each switch displays its preset badge (`01`–`05`) alongside a 2-line capable label (`line-clamp-2 leading-tight text-[11px] sm:text-xs font-bold`) so full station names (`AJN Alex Jones`, `Infowars Live AAC`, `Channel 109 Original`, `109 Classic Rock`, `109 Warm`) fit comfortably inside the box across both mobile and desktop head-unit widths.
3. **Full Cockpit Latching Switch Theme (`ck-key`) Across All Prism Controls**:
   - **5 Live Radio Station Boxes**: Styled with `ck-key` (`aria-pressed={isActive}`, `aria-current={isActive ? 'true' : undefined}`, `.is-latched` when `nowPlaying?.channelId === st.channelId`), giving each station box the raised metallic gradient, top LED indicator bar (`::before`), and 3px pressed amber latch when active.
   - **4 Top Source Mode Tabs (`1. LIVE RADIO` .. `4. LISTEN BACK`)**: Upgraded to `ck-key ck-key--sm` with `aria-selected={activeSource === src}` and `aria-pressed={activeSource === src}` so the active source tab latches down with the glowing amber indicator bar while preserving `role="tab"` and `data-testid={MODE_TEST_ID[src]}`.
   - **Prev / Next Prism Step Buttons (`‹` / `›`)**: Upgraded to `ck-key ck-key--icon` while preserving `data-testid="source-prism-prev"`, `data-testid="source-prism-next"`, and `>= 48px` touch targets.

---

## 2. File-Level Changes

### A. `src/components/SourcePrism3D.tsx`
1. **Top Source Mode Tabs (`lines 113–131`)**:
   - Replace hardcoded `bg-[#E06D3B] text-black` / `bg-[#181B24]` classes with `ck-key ck-key--sm uppercase tracking-wider text-xs font-bold` and `is-latched` when `activeSource === src`.
   - Keep `role="tab"`, `data-testid={MODE_TEST_ID[src]}`, `aria-selected={activeSource === src}`, `aria-pressed={activeSource === src}`, and exact label text (`1. LIVE RADIO`, `2. ARCHIVE MUSIC`, `3. PODCASTS`, `4. LISTEN BACK`) so `test-listen-back.tsx` assertions pass unchanged.
2. **Prev / Next Prism Buttons (`lines 134–154`)**:
   - Apply `ck-key ck-key--icon w-12 h-12 !min-h-[48px] !min-w-[48px] text-[#E06D3B] flex items-center justify-center text-base font-bold` to both `source-prism-prev` and `source-prism-next`.
3. **Facet 0 (`LIVE RADIO`) Viewport & Grid (`lines 177–212`)**:
   - Change the station container from `grid grid-cols-1 lg:grid-cols-5 gap-1 sm:gap-1.5 my-auto` to `grid grid-cols-2 gap-1.5 sm:gap-2 my-auto`.
   - For each of the 5 `FACTORY_RADIO_PRESETS` buttons (`index === 4` gets `col-span-2`):
     - Use `ck-key` with `aria-pressed={isActive}` and `aria-current={isActive ? 'true' : undefined}` where `isActive = nowPlaying?.channelId === st.channelId`.
     - Set layout inside the switch to `w-full !min-h-[52px] px-2.5 pt-2.5 pb-1.5 text-left flex items-center justify-start gap-2` so content clears the top 4px cockpit indicator bar (`::before`) and aligns cleanly.
     - Render the preset number badge (`01`–`05`) as a compact monospace pill/tag (`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40 text-[#E06D3B] shrink-0 border border-[#E06D3B]/30`) and the station name as `<span className="text-[11px] sm:text-xs font-bold leading-tight line-clamp-2 break-words text-left">{st.name}</span>`.
   - Adjust the prism scene height slightly if needed (`h-[300px] lg:h-[260px]`) so the header, 3 rows of cockpit switches (2+2+1), and footer (`P01–P05 Live Edge`) fit inside Facet 0 without vertical clipping.

---

## 3. Guardrails & Verification
- **Protected Files Untouched**: Only `src/components/SourcePrism3D.tsx` will be edited. No protected files (`server.ts`, `guideRegistry.ts`, `channels.ts`, `MinimalPlayer.tsx`, etc.) will be touched.
- **Test Compatibility**: All `SourcePrism3D` assertions in `test-listen-back.tsx` (`data-testid="radio-mode-listenback"`, `4. LISTEN BACK`, `rotateY(270deg)`, and 4 `role="tabpanel"` nodes) remain intact.
