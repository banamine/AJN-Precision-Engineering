# AJN Classic TV: finite, published schedules

## Classic Movies, using the same engine

AJN Classic Movies (classic-movies) is the first Movies & Cinema Classics
channel. It uses the same publication/compiler/window/player adapters, not a
second scheduler or player. Its owner-editable includeChannels and fixed seed
are in config/classic-networks.json. Runtime genre-split children are represented
by their source parent's raw rows; the retained manifest has no static split
children. If future manifests contain children of mx-movies-classics-list,
the catalog CLI includes those existing descendants, not unrelated uploaders.

Default sources are the owner Movies Classics list, the 29-item Cinema Classics
Vault manifest, Filmography and Atlas Taggart. JT's Ghost, AIVIIXX, Random,
Lars and Star Wars channels are not included. A source being considered does
not establish rights or playback. Missing durations are excluded, including
Vault rows without an actual duration. No default runtime is substituted.

Only non-private MP4 files with real 60–240-minute durations pass. Explicit
short/trailer/serial labels and episode/chapter/season numbering are excluded.
The movie key is normalized title plus known year; without a known year it
falls back to identifier plus file. Numeric film titles are not assumed to be
release years. Duplicate renditions merge provenance and prefer H.264/ia.mp4.
A film title overlapping a TV series (for example The Odd Couple, 1968) is
flagged for review, not discarded as a TV episode.

The one-pool order is SHA256(seed + movieKey), ascending. Every entry is walked
before wrapping; a full cycle must exceed 168 real hours, and the normal
consecutive-start gate still checks each published occurrence. Do not change
the seed without rebuilding the catalog and validating a future revision.

PowerShell, after resolving the shared initial origin/activation conflict:

    npx tsx tools/build-classic-network-catalog.mts --movies
    npx tsx tools/compile-classic-network.mts --network classic-movies --active-from 2026-11-09T08:00:00Z
    node tools/check-classic-network-publication.mjs --network classic-movies
    npm run build

For renewal, preserve the current artifact and pass it with --previous; use a
future activation, exactly as for Classic TV. Do not regenerate an initial
publication over an active one. Existing movie-vault indexing still exposes
only about 128 of roughly 11,270 source rows; that unrelated limitation is
not changed by this channel.

> Delivery status: PARTIAL. The absolute 23/25-hour grid projection is not
> implemented. The real synthetic-WebM browser test verified a 30.1-second
> seek and a visible past-end error; its delayed-response case timed out
> and is NOT VERIFIED. Do not treat those two successes as a full browser gate.
> The complete repository typecheck exhausts the requested 1,500 MiB heap
> on both the unchanged base and this branch; scoped typechecks and the
> production build pass. See the accompanying REPORT for commands and logs.

On renewal, the artifact retains approved earlier occurrences. They remain
available before the new revision's future activation; activation must not
hide that approved prefix. Initial publication still stays unavailable until
its first scheduled occurrence. The currently compiled initial artifact
starts November 9, not November 4, because the requested November 4 activation
precedes the fixed November 9 origin. The owner must resolve that conflict
before publishing this channel.

This is a finite, deterministic scheduled-VOD channel, not an upstream live feed.
The operator is banamine. The station clock is America/Los_Angeles. Viewer-local
time is presentation only. Source files, real durations and episode keys come
from the app's manifests. Retrieval does not establish rights. Rights are not
judged by this compiler; the owner decides what to distribute.

## Current delivery limits

The owner-corrected origin Monday is **November 2, 2026**. The first activation is
**November 5, 2026 00:00 Los Angeles**. Both values are in
`config/classic-networks.json`; the ordinary Classic Network compile reads them
without command-line overrides. Earlier drafts used November 9 and are obsolete.

The six-show provisional lineup is Danger Man, The Dick Van Dyke Show, Get Smart,
Benson, Taxi and Hogan's Heroes. Death Valley Days and The Odd Couple remain
withheld: the local manifests do not provide 49 distinct ordered episodes with
real durations for either show. There are no unused weekly pools. Danger Man's
numbered filename order is explicit but still requires owner review before
publication. Every actual start must pass the 168-elapsed-hour gate.

The full grid/DST rendering work is NOT completed. The existing grid contract
does not pass an absolute visible window and assumes 24 drawn hours. It is not
safe to claim a 25-hour day is drawn correctly merely by removing a clamp.
This delivery does not edit BroadcastTVGuide. Absolute server now/next and the
Upcoming adapter are separate from this unresolved visual issue.

## Build, renew, check, publish

No runtime request compiles a schedule or contacts Archive for this feature.
Publication is baked into the server bundle. Google Builder publishing activates
the image that contains it. All replicas of that image have the same artifact.
Old and new releases do NOT share a mutable activation pointer.

Run these from the project root in PowerShell, after installing the repository's
existing dependencies. Allow a few minutes for installation/build; compilation is
offline. Use the elapsed times in the delivery report for this machine, not a
guaranteed wait time on yours.

```powershell
npm ci
npx tsx tools/build-classic-network-catalog.mts
npx tsx tools/compile-classic-network.mts --network classic-network
node tools/check-classic-network-publication.mjs --network classic-network
npm run build
```

Renew BEFORE the old horizon ends. Preserve a copy of the old publication, then
compile from it with a future activation INSIDE its existing coverage:

```powershell
Copy-Item src/data/classicNetworkPublication.json "$env:TEMP\classic-network-previous.json"
# Example date only: choose a future covered instant when you actually renew.
npx tsx tools/compile-classic-network.mts --network classic-network --previous "$env:TEMP\classic-network-previous.json" --active-from 2026-12-01T08:00:00Z
node tools/check-classic-network-publication.mjs --network classic-network
npm run build
Copy-Item src/data/classicNetworkPublication.json "<YOUR-UPLOAD-FOLDER>\src\data\classicNetworkPublication.json"
```

The compiler preserves every prior occurrence starting before the new activation,
including a carry-over episode that finishes later. It seeds recent starts and
cursors from that prefix. Do not reset the catalog or start a separate independent
publication to evade the repeat gate. A failed compile does not replace the old
artifact. A last episode finishes even across midnight or the nominal horizon.

**Adding episodes/catalog edits:** rebuild the catalog, retain the old publication
and use `--previous`. Approved past occurrences remain unchanged. Each series
continues after its last episode identity in the new catalog; if that asset was
removed, it uses the next still-admitted identity from the approved future order.
If neither anchor exists the compile rejects, rather than resetting a returning
series. Recent starts, including removed assets, remain in the repeat gate.

## What viewers and the owner see

Before activation, after horizon exhaustion, or with an invalid/missing artifact,
the channel stays visible but unavailable with an operator-action message.
Other channels continue. No filler, silent repeats or runtime regeneration.
Slow or failed media never changes the baked schedule or advances its cursors.
The existing parent PlayerView/App error auto-advance is unchanged and remains
a separate known issue; no new auto-advance is introduced by the seek block.

Check at 14 days, 7 days and 72 hours remaining. The read-only checker uses
elapsed hours, not calendar-day approximations: exit 0 = OK, 1 = warning within
14 days, 2 = critical within 72 hours or ended/invalid/missing.
The optional observer lives under `optional/`, not `.github/workflows/`.
It is inactive. If the owner activates it later, it maintains one issue per
current problem report, but checks the committed artifact, not the deployed
Cloud Run build. It cannot detect its own death.

## Guarantees and limits

- Half-open absolute occurrences; one finishes before the next begins.
- A shared cursor per series across every lane.
- Exactly 168 elapsed hours between repeated starts is allowed; 1 ms less fails.
- No lane boundary between 01:00 and 03:00 local; ambiguous/nonexistent local
  instants reject. DST station days are not forced to 24 elapsed hours.
- Only the carry-over and next 48 elapsed hours enter the schedule response,
  never the entire 60-day artifact.
- Library indexes existing episode channels, not duplicate network occurrences.
- Watch Later/cloud sync logic is unchanged. Existing cloud sync drops additional
  episode/occurrence identity; this delivery does not claim to repair that.
- A finite 60-day gate is not a proof of feasibility forever, across future
  catalog changes or arbitrary rotation cycles.
- Real H.264 playback, real devices, Cloud Run behaviour and rights require owner
  checks. Offline fixtures and partial HTTP retrieval are not playback proof.

## Rollback

In Google Builder, restore the previous working version through **Builder >
Versions** first after any sandbox load failure. Alternatively restore the
previous artifact and the listed overwritten source files together, then rebuild
and publish that version. A running server cannot reload a changed artifact
without a new build. Keep ZIP 1 as the fallback if Movies work is not accepted.
