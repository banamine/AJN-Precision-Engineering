# Head-Unit Spectrum Analyzer for Podcasts & Archived Music

Restore real-time spectrum visualization in the radio head unit when playing Archived Music, Live Concerts, Podcasts, and AJN Radio broadcasts, not just live radio stations.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed choices from interactive clarification:

- **Confirmed Decision 1 — Spectrum Activation Scope**: Animate the head-unit spectrum analyzer whenever any audio is actively playing in the deck (`live || Boolean(playingNow)`), rather than restricting `playing` to `live` (`channelId.startsWith('radio:')`).
- **Confirmed Decision 2 — Non-CORS Podcast Enclosures**: Keep direct browser playback for third-party podcast enclosures and rely on the existing honest `"Spectrum unavailable"` badge when a host does not provide CORS headers.

## 1. Overview & Core Concept

- **What It Does**: Connects the head-unit `RadioSpectrum` display to the active playback state of all deck audio sources (Live Radio, Archive Music channels, Live Concerts, Archived Podcasts, and CORS-enabled RSS Podcasts).
- **Target Audience / Persona**: Listeners using the automotive head-unit deck on the Radio page or in the slide-up Radio drawer across desktop and mobile.
- **Key Value**: Consistent, real-time Web Audio frequency visualization across all audio modes without fabricating synthetic bars or risking playback failures on non-CORS streams.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. Listener opens the Radio page or Radio drawer and selects **Archive Music**, **Live Concerts**, or **Podcasts**.
  2. Listener starts an album, concert, or podcast episode (via the deck list, preset keys, or Listen browser).
  3. The head-unit LCD lamp lights up and the right-hand **Spectrum** bay immediately renders 72-bar real-time frequency data from the shared Web Audio `AnalyserNode`.
  4. If a third-party podcast enclosure plays directly without CORS headers, audio plays normally and the spectrum bay displays its honest `"Spectrum unavailable"` pill over the baseline.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Hardware-inspired dark glass head-unit console with copper-orange accents (`#E06D3B`) and cyan frequency bars (`rgba(103, 232, 249, 0.56)`).
  - *Color Palette & Mood*: Deep slate-black LCD/spectrum bays (`rgba(15,17,23,0.55)`) with subtle 1px translucent bezels (`rgba(255,255,255,0.18)`).
  - *Typography & Hierarchy*: Crisp uppercase section micro-labels (`10px` bold tracking-widest) paired with high-contrast station/episode titles and tabular counters.
  - *Component Styling & Layout*: 2-column balanced head-unit grid on desktop (`1440px` baseline) collapsing cleanly to 1 column in narrow containers (`< 640px`).
- **Interactive Feedback & Motion**: Smooth `requestAnimationFrame` canvas rendering while audio plays; immediate baseline settle when paused or stopped.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Drive `RadioSpectrum` with `live || Boolean(playingNow)`**:
  - *Chosen Approach*: Pass `playing={live || Boolean(playingNow)}` to `<RadioSpectrum>` inside the head unit.
  - *Why*: `live` is intentionally scoped to live radio stations (`channelId.startsWith('radio:')`) so live station preset dots only light up for live radio, whereas `playingNow` reflects whether the persistent media element is actively playing any audio track.
  - *Alternatives Considered*: Changing the `live` prop definition in `RadioView` and `RadioDock` was rejected because `live` also controls live-only UI indicators (`ON AIR` vs `PLAYING` badge and preset live dots).
- **Decision 2 — Preserve Direct Playback for Non-CORS Podcasts**:
  - *Chosen Approach*: Keep `corsModeFor` rules unchanged so proxied Archive Music/Concerts (`/api/archive/proxy`), AJN feeds (`/api/ajn/proxy`), and `corsVerified` podcasts use `crossOrigin="anonymous"` (feeding `getSharedAnalyser()`), while non-CORS third-party podcast hosts play natively.
  - *Why*: Guarantees zero playback regressions while enabling the real Web Audio spectrum on all Archive Music, Concerts, and CORS-capable podcasts.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌──────────────────────────────────────────────────────────────┐
│           Persistent Audio Player (MinimalPlayer)            │
│   useAudioNormalization -> Web Audio diagnosticsAnalyser     │
└──────────────────────────────┬───────────────────────────────┘
                               │ getSharedAnalyser()
                               ▼
┌──────────────────────────────────────────────────────────────┐
│            RadioView / RadioDock (playingNow, live)          │
└──────────────────────────────┬───────────────────────────────┘
                               │ props: live, playingNow
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 RadioPresetsBar (Head Unit)                  │
│     <RadioSpectrum playing={live || Boolean(playingNow)} />  │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│        RadioSpectrum -> ArchiveMusicSpectrum (Canvas)        │
└──────────────────────────────────────────────────────────────┘
```
- **Data Model & State**:
  - `live`: `boolean` — true when a `radio:*` live stream is attached and unpaused.
  - `playingNow`: `boolean | undefined` — true when the persistent player is attached and unpaused for any media item.
  - `analyser`: `AnalyserNode | null` — read from `getSharedAnalyser()` every 500ms and on `playing` state transitions.
- **Interactive Component & State Mapping**:
  - Starting Archive Music, Concerts, or Podcasts sets `playingNow = true` on `RadioPresetsBar`.
  - `RadioPresetsBar` computes `spectrumPlaying = live || Boolean(playingNow)` and passes it to `RadioSpectrum`.
  - `RadioSpectrum` polls `getSharedAnalyser()` and activates `useAnalyzerState(analyser, playing)` and `ArchiveMusicSpectrum`.
