AJN H1 build v2 (2026-10-21) - built offline, 0 Archive requests, no app/manifest files touched.

manifest.json          15557 entries: 1173 active (ready 246, provisional 927) + 14384 deferred_owner_decision.
                       Each has id, regex-identified contentType + mediaKind (+ the signals that decided it), cleaned title, status, deferReasons.
deferred.json          Everything the system was unsure about, with reasons. NOTHING deleted. byReason: {'creator_digitalfolklore_deferred': 14338, 'virginian_search_title_not_series_match': 41, 'format_needs_derivative_or_unclassified': 5}
playlists/             ALL.m3u, type-<contentType>.m3u, TEST-ONE-PER-TYPE.m3u (one item per playback type; see below).
type-confirmation.json One test item per playback type. Play it; set confirmed=true; rerun the build with --confirm to stamp
                       every item of that type typeCheck=confirmed instead of awaiting_type_check. (Nothing is confirmed yet.)
owner-overrides.json   Explicit owner decisions applied on top of the rules (currently: Centennial's 11 Matroska-labelled .mp4 files accepted).
title-changes.json     Every title the cleaner changed (before/after). validation-report.json: checks + what is NOT verified.
tools/                 classify_lib.py (regex rules), build_h1_v2.py, build_extra_channels.py (+ extra_channels_lib.py)
tests/                 13 tests. Run: python3 -I tests/test_classify.py ; python3 -I tests/test_converter.py

Rebuild:  python3 -I tools/build_h1_v2.py phase2-ranked.json candidates.json out_dir --overrides owner-overrides.json --confirm type-confirmation.json
Convert:  python3 -I tools/build_extra_channels.py --h1 manifest.json --meta-dir META_DIR --base extraChannelsManifest.json \
              --out extraChannelsManifest.new.json --sidecar-out audio-sidecar.json --report report.json

Status meanings: ready = mediatype + formats known and consistent. provisional = at least one type signal, no conflict, but format or
mediatype unknown (embed link only). deferred_owner_decision = no evidence, conflicting evidence, bad identifier characters, format needing a
derivative check, parked source (digitalfolklore), or non-series Virginian search hit.
Not verified: playback of any item, restriction/loan/dark state, rights, file-level metadata for embed items, Archive derivative naming
assumed by the converter (name.ia.mp4, name_64kb.mp3).
