# Classic Network Rotation & Schedule Preview Implementation Plan (Evidence-First Revision)

Revised implementation plan addressing all review feedback from `AJN_Classic_Network_Owner_Decisions_2026-11-07.md`. Incorporates real manifest probe findings, replaces clock blocks with dynamic sequence runs (1–3 episodes, ending with Hogan's), provides an explicit channel-ID exclusion list, defines an extensive daytime pool, and details an automated validation suite in `tests/`.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Key revisions incorporated from the review:
> - **Phase 1 Manifest Probe Completed**: Channel IDs, item identifiers, and episode counts have been verified against `src/data/extraChannelsManifest.json`, `src/data/seriesManifests.json`, and `src/data/classicNetworkCatalog.json`.
> - **Weeknight Dynamic Run Model**: Replaced fixed 2-hour Hogan's block with alternating runs of 1–3 episodes (Hogan's / Taxi / M\*A\*S\*H). The final run concluding before midnight is Hogan's Heroes (1–3 episodes). Never the same series twice running back-to-back, and never 5 episodes of any show in a row.
> - **Explicit Excluded Channel IDs**: Replaced loose regex matching with an explicit manifest ID blacklist to prevent accidental exclusion of unrelated shows.
> - **Sherlock Holmes & Granada Disambiguation**: Confirmed `l4-the-adventures-of-sherlock-holmes-s-03-e-01-reluctant-carpen` is the admitted 1954 US Ronald Howard series. `tvx-granada-series-sherlock-holmes` (British ITV) is explicitly excluded under the British shows rule.
> - **Held Status for Unverified Items**: *Gunsmoke* (`l4-gunsmoke-...`) and *Barnaby Jones* (`l4-bitchute-barnaby-jones-2022`) are placed in the "Held" list until live HTTP 206 and H.264 codec checks pass; they will not be scheduled in the preview. *Burns & Allen* remains held.
> - **Cartoon Ratio by Airtime**: Pre-1960 vs 1960–1995 cartoon balance is measured by cumulative scheduled seconds (60% ± 5% pre-1960), not fixed clock hours.
> - **Preview Delivery Only**: Outputs to `reports/classic-network/preview-schedule-14d.json` without modifying production publication.

---

## 1. Verified Manifest Probe & Pool Mapping

### A. Explicit Exclusion List (Strict Blacklist)
The catalog generator and validator will reject any row originating from or matching these IDs:
- **Soaps**: `allmychildren`, `allmychildren-channel`, `tvx-soap-ch309`, `soap` (Ch 309).
- **British Standalone Shows**:
  - `danger-man`
  - `l4-2017-the-saint-movie-1080p-spanish-or-english` (The Saint)
  - `l4-s-01-e-01-murder-in-monmartre-1` (Maigret 1959)
  - `tvx-granada-series-sherlock-holmes` (Granada Series Sherlock Holmes - British ITV)
  - `l4-fawlty-towers-complete-series-1975`
  - `l4-the-prisoner-complete-series-1967` / `l4-the-prisoner-complete-series-2009`
  - `l4-it-aint-half-hot-mum-s-06-e-04-the-dhobi-wallahs`
  - `l4-the-secret-service-1969`
  - `l4-the-baron-1966-series`
  - `l4-the-protectors`
  - `l4-the-buccaneers-s-01-e-01-blackbeard`
- **Post-1995 Crossover Series**:
  - `star-trek-voyager` (1995–2001)
  - `cx-x-men-the-animated-series-ai-upscale` (X-Men 1992–1997)
  - `cx-gargoyles-ai-upscale` (Gargoyles 1994–1997)
  - `cx-reboot-with-subtitles-and-mkv` (ReBoot 1994–2001)
  - `cx-spider-man-the-animated-series-complete-1994-series-ai-upsca` (Spider-Man 1994–1998)
  - `cx-beavis-and-butt-head-1992-present-final` (Beavis and Butt-Head 1992–1997+)
  - `cx-teknoman-upscale` (Teknoman 1995–1996)

### B. Held List (Pending Verification / Probe)
These shows are retained in a diagnostic report (`reports/classic-network/held-inventory.json`) and **never scheduled**:
- `burns-and-allen`: Unchecked on Archive accounts; probe pending.
- `l4-gunsmoke-s-01-e-01-matt-gets-it-202509` (Gunsmoke): Prior 403 restricted check on Archive item; held until HTTP 206 admission succeeds.
- `l4-bitchute-barnaby-jones-2022` (Barnaby Jones): BitChute origin; held until codec verification confirms compliant H.264/AAC.
- Unverified cartoons: Compilations without confirmed pre-1995 individual release dates (`cx-dilbert-...`, `cx-chadam-2010`, etc.).

### C. Admitted Pools & Verified IDs

| Daypart & Pool | Admitted Shows & Manifest IDs | Episode Count & Depth | Runtime / Pacing |
| :--- | :--- | :--- | :--- |
| **Weeknight Prime (18:00–24:00 PT)** | `hogans-heroes`<br>`taxi`<br>`tvx-m-a-s-h-no-laugh-track` | Hogan's: 154 eps<br>Taxi: 114 eps<br>M\*A\*S\*H: 41 eps | Runs of 1–3 episodes per show.<br>Series must alternate.<br>Last run before midnight is Hogan's. |
| **Weekday Daytime (06:00–18:00 PT)** | `benson`<br>`get-smart`<br>`dick-van-dyke`<br>`l4-the-jeffersons-lando18`<br>`l4-good-times-lando18`<br>`l4-mister-ed-lando18`<br>`l4-chico-the-man`<br>`l4-archie-bunkers-place-complete-series`<br>`l4-major-dad`<br>`l4-operationpetticoats1` | Total: >1,000 distinct in-era episodes across 10 series | Single episodes only.<br>No consecutive airings of the same series. |
| **Overnight (00:00–06:00 PT)** | In-era comedy/drama rotation:<br>`dick-van-dyke`, `get-smart`, `benson`, `l4-mister-ed-lando18`, `l4-chico-the-man` | >400 episodes | 1–2 episodes per show.<br>168h repeat gate enforced. |
| **Weekend Morning Cartoons (06:00–12:00 PT)** | **Pre-1960 Pool (~60% Airtime)**:<br>`cx-popeye-the-sailor-man-1933-to-1943` (123 eps)<br>`cx-popeye-the-sailor-man-1943-to-1949` (43 eps)<br>`cx-buddy-full-hq-hd-collection-1933-1935` (23 eps)<br>`cx-norman-mccabe-warner-brothers-direction-colection` (27 eps)<br>`cx-noveltoons-original-classics` (26 eps)<br>`cx-disney-rarities-celebrated-shorts-1920s-1960s` (37 eps)<br>`cx-the-woody-woodpecker-friends-cartunes` (510 eps)<br><br>**1960–1995 In-Era Pool (~40% Airtime)**:<br>`cx-the-underdog-show-the-complete-collection` (1964: 47 eps)<br>`cx-the-ant-and-the-aardvark` (1969: 17 eps)<br>`cx-80-s-ducktales-collections` (1987: 91 eps)<br>`cx-80-s-cartoons-talespin-collection` (1990: 65 eps)<br>`cx-darkwing-duck-collection` (1991: 86 eps) | Combined: >950 verified shorts/episodes with real durationSeconds | Interleaved playout meeting 60% ± 5% cumulative airtime ratio. |
| **Weekend Evening Westerns (18:00–22:00 PT)** | `l4-nty-20251115` (Wanted: Dead or Alive: 94 eps)<br>`death-valley-days` (49 eps)<br>`l4-the-loner-1965-series` (26 eps)<br>`l4-hondo-s-01-e-01-hondo-and-the-eagle-claw` (17 eps) | Total: 186 episodes | Exactly 2 episodes per weekend evening (8 total over 14 days; ample depth against 168h gate). |
| **Sunday Mystery Wheel (18:00–22:00 PT Sundays)** | `l4-the-adventures-of-sherlock-holmes-s-03-e-01-reluctant-carpen` (1954 US: 36 eps)<br>`tvx-ironside-season-3` & `l4-ironsides02` (41 eps)<br>`l4-colonel-march-of-scotland-yard-s-01-e-01-the-sorcerer-1` (26 eps)<br>`l4-murder-she-wrote-202402` (Flagged: 1984–1996 in-era continuation, 218 eps) | Total: 321 episodes | 2 feature-length or mystery episodes on Sunday evenings only. |

---

## 2. Schedule Grid & Playout Rules

```
Hour (PT)   Monday – Friday                   Saturday                          Sunday
00:00-06:00 Late-Night Comedy Variety         Late-Night Comedy Variety         Late-Night Comedy Variety
06:00-12:00 Weekday Daytime (Single Ep)       Weekend Cartoons (60/40 Ratio)    Weekend Cartoons (60/40 Ratio)
12:00-18:00 Midday Variety (Single Ep)        Weekend Afternoon Variety         Weekend Afternoon Variety
18:00-24:00 Prime Runs: M*A*S*H / Taxi /     Westerns (2 eps) + Prime Runs,    Sunday Mystery Wheel (2 eps) + Prime,
            Hogan's (1-3 eps alternating;     Ending with Hogan's Run           Ending with Hogan's Run
            ends with Hogan's before 24:00)
```

### Core Invariant Rules
1. **Dynamic Prime Runs**: Weeknight 18:00–24:00 is compiled as an alternating chain of series runs (each 1–3 episodes of M\*A\*S\*H, Taxi, or Hogan's Heroes). Never the same series twice in a row. The final run concluding before midnight is Hogan's Heroes (1–3 episodes).
2. **Never 5 in a Row**: At no point in the 14-day schedule may 5 episodes of any single series air consecutively across any lane boundary.
3. **Daytime Singularity**: 06:00–18:00 on weekdays emits single episodes only, rotating across the 10 admitted daytime series.
4. **Cartoon Ratio by Airtime**: Cumulative duration seconds of pre-1960 cartoons scheduled on Saturday and Sunday mornings must fall strictly within 55.0% and 65.0% of total weekend morning cartoon duration.
5. **Western & Mystery Segregation**: Westerns appear only on Saturday and Sunday evenings; Mystery Wheel appears only on Sunday evenings.
6. **168-Hour Repeat Gate**: No individual asset/episodeKey may be scheduled with less than 168 elapsed hours (7 days) since its prior broadcast start.

---

## 3. Technical Architecture & Component Mapping

```
┌─────────────────────────────────────────────────────────────┐
│                 Applet Source Manifests                     │
│ (src/data/extraChannelsManifest, seriesManifests, etc.)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             tools/build-classic-network-catalog.mts         │
│ - Strict channel-ID blacklist filter                        │
│ - Held inventory isolation (Gunsmoke, Barnaby Jones, B&A)   │
│ - Verified asset extractor with real durationSeconds > 0    │
│ - Emits src/data/classicNetworkCatalog.json                 │
│ - Emits reports/classic-network/held-inventory.json         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               config/classic-network-draft.json             │
│ - Station Zone: America/Los_Angeles                         │
│ - Lineups: Weekday, Saturday, Sunday                        │
│ - Pool declarations for daytime, prime, cartoons, westerns, │
│   mystery, and overnight                                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            tools/compile-classic-network.mts                │
│ - Dry-run preview mode (--preview --days 14)                │
│ - Generates reports/classic-network/preview-schedule-14d.json│
│ - Live classicNetworkPublication.json remains untouched     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         tests/test-classic-network-schedule-rules.ts        │
│ (Located in tests/ with ../ imports)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Verification Test Suite (`tests/test-classic-network-schedule-rules.ts`)

The test suite will execute against the generated preview manifest and assert:

1. **Integrity & Runtime**:
   - Every scheduled program has `durationSeconds > 0` and a non-empty `archivePath`.
   - Zero scheduled items have `private: true`, `is_dark: true`, or `restricted: true`.
2. **Zero Blacklisted Occurrences**:
   - Confirms 0 episodes from `danger-man`, `the-saint`, `maigret`, `granada-sherlock-holmes`, `soap`, `all-my-children`, `voyager`, `x-men`, `gargoyles`, `reboot`, `spider-man`, `beavis-and-butt-head`, `teknoman`, or `burns-and-allen`.
3. **Prime Run & Hogan's Midnight Anchor**:
   - On every weeknight (Mon–Fri 18:00–24:00 PT), consecutive episodes of any series are bounded between 1 and 3.
   - The final scheduled program before midnight PT on every day of the 14 days belongs to `hogans-heroes`.
   - Never the same series twice in a row during prime unless part of an ongoing 1–3 episode run.
4. **Never 5 in a Row**:
   - Scans the entire 14-day schedule array; asserts no single show key repeats 5 times consecutively anywhere.
5. **Weekday Daytime Singularity**:
   - For all Monday–Friday airings between 06:00 and 18:00 PT, consecutive episodes never share the same show key.
6. **Weekend Cartoon Airtime Ratio**:
   - Calculates `sum(pre1960_duration) / sum(total_cartoon_duration)`.
   - Asserts ratio is between `0.55` and `0.65`.
7. **Western & Mystery Daypart Bounds**:
   - Westerns appear exclusively between 18:00 and 22:00 PT on Saturdays and Sundays.
   - Mystery wheel series appear exclusively between 18:00 and 22:00 PT on Sundays.
8. **168-Hour Repeat Gate**:
   - For every `episodeKey`, verifies `start_time - previous_start_time >= 168 * 3600 * 1000` ms.

---

## 5. Execution Order

1. **Execute Catalog Filter & Admission**:
   - Update `tools/build-classic-network-catalog.mts` with the explicit blacklist and verified show mappings.
   - Run catalog generation, populating `src/data/classicNetworkCatalog.json` and `reports/classic-network/held-inventory.json`.
2. **Configure Draft Daypart Settings**:
   - Create `config/classic-network-draft.json` encoding the weekday, Saturday, and Sunday daypart lineups.
3. **Compile 14-Day Preview Manifest**:
   - Run compilation generating `reports/classic-network/preview-schedule-14d.json` starting Monday, 2026-11-09 PT.
4. **Run Automated Test Suite**:
   - Execute `npx tsx tests/test-classic-network-schedule-rules.ts`.
   - Verify all assertions pass.
5. **Submit for Owner Review**:
   - Present preview manifest and test results to the owner for sign-off prior to publishing.
