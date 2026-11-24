/* AJN On Air playout engine: pure functions + state machine. Ported from the locked Dusk Marquee mock-up (Revision 2, 39/39 tests).
 * Behaviour is unchanged except denverParts/denverMs, which are now DST-correct (the mock-up hard-coded UTC-7).
 * No React, no network, no wall clock: every function takes nowMs. The page drives it only through tickOnce. */

  // America/Denver wall clock (DST-correct via Intl). The mock-up hard-coded UTC-7; the real page runs all year.
  var DENVER_OFFSET_MS = -7 * 3600 * 1000; // kept for API compatibility (standard-time offset only)
  var DENVER_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });

  function denverParts(nowMs) {
    var out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    var parts = DENVER_FMT.formatToParts(new Date(nowMs));
    for (var i = 0; i < parts.length; i++) {
      var n = Number(parts[i].value), t = parts[i].type;
      if (t === "year") out.year = n; else if (t === "month") out.month = n; else if (t === "day") out.day = n;
      else if (t === "hour") out.hour = n % 24; else if (t === "minute") out.minute = n; else if (t === "second") out.second = n;
    }
    return out;
  }

  function denverMs(year, month1Based, day, hour, minute, second) {
    var target = Date.UTC(year, month1Based - 1, day, hour, minute, second, 0);
    var guess = target;
    for (var i = 0; i < 4; i++) {
      var p = denverParts(guess);
      var diff = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
      if (diff === 0) break;
      guess += diff;
    }
    return guess;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatDenverHMS(nowMs) {
    var p = denverParts(nowMs);
    return pad2(p.hour) + ":" + pad2(p.minute) + ":" + pad2(p.second);
  }

  function formatMMSS(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + pad2(r);
  }

  function formatSignedDrift(driftMs) {
    if (!driftMs) return "0:00";
    var sign = driftMs < 0 ? "-" : "+";
    var absSec = Math.round(Math.abs(driftMs) / 1000);
    return sign + formatMMSS(absSec);
  }

  // 1. advanceClock(sim, deltaRealMs, speed) -> sim
  function advanceClock(sim, deltaRealMs, speed) {
    var spd = typeof speed === "number" && speed > 0 ? speed : 1;
    var dt = typeof deltaRealMs === "number" && deltaRealMs >= 0 ? deltaRealMs : 0;
    return {
      nowMs: sim.nowMs + dt * spd,
      elapsedRealMs: (sim.elapsedRealMs || 0) + dt,
      ticks: (sim.ticks || 0) + 1
    };
  }

  // 2. fadeProgress(nowMs, startMs, durMs) -> 0..1
  function fadeProgress(nowMs, startMs, durMs) {
    if (durMs <= 0) {
      return nowMs >= startMs ? 1 : 0;
    }
    var raw = (nowMs - startMs) / durMs;
    if (raw <= 0) return 0;
    if (raw >= 1) return 1;
    return raw;
  }

  // 3. crossfadeGains(progress, ceilingOut, ceilingIn, startInFrac) -> {out, in}
  function crossfadeGains(progress, ceilingOut, ceilingIn, startInFrac) {
    var s = typeof startInFrac === "number" ? startInFrac : 0;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
    if (progress <= 0) {
      return { out: ceilingOut, in: ceilingIn * s };
    }
    if (progress >= 1) {
      return { out: 0, in: ceilingIn };
    }
    var angle = progress * (Math.PI / 2);
    var outGain = Math.cos(angle) * ceilingOut;
    var sn = Math.sin(angle);
    var inGain = ceilingIn * (s + (1 - s) * sn * sn); // eases in: the new source rises slowly while the old one is still audible
    if (outGain > ceilingOut) outGain = ceilingOut;
    if (outGain < 0) outGain = 0;
    if (inGain > ceilingIn) inGain = ceilingIn;
    if (inGain < 0) inGain = 0;
    return { out: outGain, in: inGain };
  }

  // 4. planBlend(segment, nextSegment, params)
  function planBlend(segment, nextSegment, params) {
    var endMs = segment.endMs;
    return {
      prebufferAtMs: endMs - params.prebufferSec * 1000,
      watchdogAtMs: endMs - params.watchdogSec * 1000,
      musicInAtMs: endMs - params.musicInSec * 1000,
      riseAtMs: endMs - params.riseSec * 1000,
      podcastFadeStartMs: endMs - params.podcastFadeOutSec * 1000,
      podcastFadeDurMs: params.podcastFadeOutSec * 1000
    };
  }

  // 5. prebufferOps(kind) -> ordered ops
  function prebufferOps(kind) {
    if (kind === "live" || kind === "Live 109") {
      return ["setSrc", "load", "playMutedAtVolume0"];
    }
    return ["setSrc", "preload:auto", "load", "waitReadyState>=3"];
  }

  // 6. teardownOps(deck) -> ordered ops
  function teardownOps(deck) {
    return ["pause", "removeAttribute:src", "load", "detachHandlers"];
  }

  // Pure helper applyOps(fakeAudio, ops) for T04/T05
  function applyOps(fakeAudio, ops) {
    var list = ops || [];
    for (var i = 0; i < list.length; i++) {
      var op = list[i];
      if (op === "pause") {
        fakeAudio.pause();
      } else if (op === "removeAttribute:src") {
        fakeAudio.removeAttribute("src");
      } else if (op === "load") {
        fakeAudio.load();
      } else if (op === "setSrc") {
        fakeAudio.src = "demo://media-source";
      } else if (op === "preload:auto") {
        fakeAudio.preload = "auto";
      } else if (op === "playMutedAtVolume0") {
        fakeAudio.volume = 0;
        fakeAudio.muted = true;
        fakeAudio.play();
      } else if (op === "detachHandlers") {
        if (typeof fakeAudio.detachHandlers === "function") fakeAudio.detachHandlers();
      }
    }
    return fakeAudio;
  }

  // 7. ceilingFor(kind, params)
  function ceilingFor(kind, params) {
    if (kind === "podcast") return params.ceilingPodcast;
    if (kind === "live" || kind === "Live 109") return params.ceilingLive109;
    return params.ceilingLibrary;
  }

  // 8. libraryPlan(blockStartMs, params, trackLengthsMs)
  function libraryPlan(blockStartMs, params, trackLengthsMs) {
    var minMs = params.musicMinSec * 1000;
    var targetMs = params.musicTargetSec * 1000;
    var maxMs = params.musicMaxSec * 1000;
    var tracks = (trackLengthsMs && trackLengthsMs.length > 0) ? trackLengthsMs : [210000, 210000];
    var picked = [];
    var cum = 0;
    var reason = "library_track_boundary";

    for (var j = 0; j < tracks.length; j++) {
      var dur = tracks[j];
      var nextCum = cum + dur;
      if (nextCum >= minMs && nextCum <= maxMs) {
        picked.push({ index: j, startOffsetMs: cum, endOffsetMs: nextCum, durationMs: dur });
        return { tracks: picked, exitAtMs: blockStartMs + nextCum, reason: "library_track_boundary" };
      }
      if (nextCum > maxMs) {
        // Swap to a shorter track that lands inside [minMs, maxMs], or best fit <= maxMs
        var bestIdx = -1;
        for (var k = 0; k < tracks.length; k++) {
          var alt = cum + tracks[k];
          if (alt >= minMs && alt <= maxMs) {
            bestIdx = k;
            break;
          }
        }
        if (bestIdx !== -1) {
          var bDur = tracks[bestIdx];
          picked.push({ index: bestIdx, startOffsetMs: cum, endOffsetMs: cum + bDur, durationMs: bDur });
          return { tracks: picked, exitAtMs: blockStartMs + cum + bDur, reason: "library_short_track_swap" };
        }
        // Pick shortest track that fits <= maxMs without exceeding maxMs
        var shortIdx = -1;
        var shortDur = Infinity;
        for (var s = 0; s < tracks.length; s++) {
          if (cum + tracks[s] <= maxMs && tracks[s] < shortDur) {
            shortDur = tracks[s];
            shortIdx = s;
          }
        }
        if (shortIdx !== -1) {
          picked.push({ index: shortIdx, startOffsetMs: cum, endOffsetMs: cum + shortDur, durationMs: shortDur });
          return { tracks: picked, exitAtMs: blockStartMs + cum + shortDur, reason: "library_short_track_swap" };
        }
        var capped = cum > 0 ? Math.min(cum, maxMs) : Math.min(targetMs, maxMs);
        return { tracks: picked, exitAtMs: blockStartMs + capped, reason: "library_short_track_cap" };
      }
      picked.push({ index: j, startOffsetMs: cum, endOffsetMs: nextCum, durationMs: dur });
      cum = nextCum;
    }

    var finalOff = cum;
    if (finalOff > maxMs) finalOff = maxMs;
    if (finalOff < minMs) finalOff = Math.min(targetMs, maxMs);
    return { tracks: picked, exitAtMs: blockStartMs + finalOff, reason: reason };
  }

  // 8b. paramsForSegment(seg, params): a music block planned with its own length (clock breaks: 4 min, 2 min, hour-end pad) uses that length
  // for its exit window instead of the global min/target/max. Blocks without seg.musicSec are unchanged.
  function paramsForSegment(seg, params) {
    var s = seg && seg.musicSec;
    if (!(s > 0)) return params;
    var o = {};
    for (var k in params) o[k] = params[k];
    o.musicTargetSec = s;
    o.musicMinSec = Math.max(60, s - 60);
    o.musicMaxSec = s + 60;
    return o;
  }

  // 9. musicExitAtMs(blockStartMs, params, songChangeTimesMs, feedStale, mode, trackLengthsMs)
  function musicExitAtMs(blockStartMs, params, songChangeTimesMs, feedStale, mode, trackLengthsMs) {
    var minMs = blockStartMs + params.musicMinSec * 1000;
    var targetMs = blockStartMs + params.musicTargetSec * 1000;
    var maxMs = blockStartMs + params.musicMaxSec * 1000;
    var isLive = mode === "Live 109" || mode === "live";

    if (isLive) {
      if (feedStale) {
        return { exitAtMs: targetMs, reason: "feed_stale_target" };
      }
      var list = (songChangeTimesMs || []).slice().sort(function (a, b) { return a - b; });
      for (var i = 0; i < list.length; i++) {
        if (list[i] >= minMs && list[i] <= maxMs) {
          // Build 20: the song change is seen AFTER it happens, so exiting "at" it made the fade window already
          // past and the engine jumped to news with no fade. Leave room for the standby deck to load, then a full fade.
          return { exitAtMs: list[i] + ((params.standbyLoadSec || 6) + params.musicFadeOutSec) * 1000, reason: "song_change" };
        }
      }
      return { exitAtMs: maxMs, reason: "hard_timer_max" };
    }

    var plan = libraryPlan(blockStartMs, params, trackLengthsMs);
    return { exitAtMs: plan.exitAtMs, reason: plan.reason };
  }

  // 10. buildRunOfShow(fixture, params, dayStartMs, horizonMs) -> segments (NO slate segments)
  function buildRunOfShow(fixture, params, dayStartMs, horizonMs) {
    var horizon = typeof horizonMs === "number" ? horizonMs : (dayStartMs + (params.horizonHours || 24) * 3600 * 1000);
    var dpStart = denverParts(dayStartMs);
    var midnightMs = denverMs(dpStart.year, dpStart.month, dpStart.day + 1, 0, 0, 0);

    var segments = [];
    var cursor = dayStartMs;
    var musicIdx = 0;
    var stations = ["Classic Rock 109", "Classic Hits 109"];
    var musicDurMs = params.musicTargetSec * 1000;
    var todayPods = fixture.podcasts || [];
    var yesterdayPods = fixture.yesterdayPodcasts || todayPods;

    function pushPodcast(p, editionTag, pubDate, seqNum) {
      var pDurMs = p.durationMin * 60 * 1000;
      segments.push({
        id: "seg-pod-" + p.slug + "-" + editionTag.toLowerCase().replace(/\s+/g, "-") + "-" + seqNum,
        index: segments.length + 1,
        type: "podcast",
        name: p.name,
        showName: p.name,
        episodeTitle: p.episodeTitle,
        networkTag: p.networkTag,
        publishedDate: pubDate,
        editionTag: editionTag,
        musicStation: null,
        musicSource: null,
        startMs: cursor,
        endMs: cursor + pDurMs,
        plannedStartMs: cursor,
        plannedEndMs: cursor + pDurMs,
        origPlannedStartMs: cursor,
        origPlannedEndMs: cursor + pDurMs,
        actualStartMs: null,
        actualEndMs: null,
        driftMs: 0,
        durationMs: pDurMs
      });
      cursor += pDurMs;
    }

    function pushMusic(editionTag) {
      var station = stations[musicIdx % 2];
      var mId = "seg-mus-" + (musicIdx + 1);
      segments.push({
        id: mId,
        index: segments.length + 1,
        type: "music",
        name: params.musicSource === "Library" ? ("Music Block " + (musicIdx + 1) + " (Library)") : ("Music Block " + (musicIdx + 1) + " (" + station + ")"),
        showName: station,
        episodeTitle: null,
        networkTag: params.musicSource === "Library" ? "LIBRARY" : "LIVE 109",
        publishedDate: editionTag === "NEW EDITION" ? "2026-11-22" : "2026-11-21",
        editionTag: editionTag,
        musicStation: station,
        musicSource: params.musicSource,
        startMs: cursor,
        endMs: cursor + musicDurMs,
        plannedStartMs: cursor,
        plannedEndMs: cursor + musicDurMs,
        origPlannedStartMs: cursor,
        origPlannedEndMs: cursor + musicDurMs,
        actualStartMs: null,
        actualEndMs: null,
        driftMs: 0,
        durationMs: musicDurMs
      });
      cursor += musicDurMs;
      musicIdx += 1;
    }

    var seq = 1;
    // Phase 1: Today's edition
    for (var i = 0; i < todayPods.length && cursor < horizon; i++) {
      pushPodcast(todayPods[i], "TODAY", "2026-11-21", seq++);
      if (cursor < horizon && cursor < midnightMs) {
        pushMusic("TODAY");
      }
    }

    // Phase 2: Yesterday filler until midnight cutover (segment on air at 00:00 finishes untouched)
    var yIdx = 0;
    while (cursor < midnightMs && cursor < horizon) {
      var yp = yesterdayPods[yIdx % yesterdayPods.length];
      pushPodcast(yp, "YESTERDAY", "2026-11-20", seq++);
      yIdx += 1;
      if (cursor < midnightMs && cursor < horizon) {
        pushMusic("YESTERDAY");
      }
    }

    // Phase 3: New edition starts with the very first segment starting after 00:00:00
    var nIdx = 0;
    while (cursor < horizon) {
      var np = todayPods[nIdx % todayPods.length];
      pushPodcast(np, "NEW EDITION", "2026-11-22", seq++);
      nIdx += 1;
      if (cursor < horizon) {
        pushMusic("NEW EDITION");
      }
    }

    return segments;
  }

  // 11. rescheduleFrom(segments, index, actualStartMs, skippedSegmentId) -> new segments array
  function rescheduleFrom(segments, index, actualStartMs, skippedSegmentId) {
    if (!segments || index < 0 || index >= segments.length) return segments;
    var target = segments[index];
    var skipSeg = null;
    if (skippedSegmentId) {
      for (var k = 0; k < segments.length; k++) {
        if (segments[k].id === skippedSegmentId) { skipSeg = segments[k]; break; }
      }
    }
    var skipLen = skipSeg ? (skipSeg.origPlannedEndMs - skipSeg.origPlannedStartMs) : 0;
    var delta = skipSeg ? (-skipLen) : (actualStartMs - target.plannedStartMs);
    return segments.map(function (s, i) {
      if (skipSeg && s.id === skippedSegmentId) {
        return Object.assign({}, s, {
          skipped: true,
          durationMs: 0,
          startMs: actualStartMs,
          endMs: actualStartMs,
          plannedEndMs: s.plannedStartMs,
          actualStartMs: actualStartMs,
          actualEndMs: actualStartMs,
          driftMs: -skipLen
        });
      }
      if (i < index) {
        if ((!skipSeg && i === index - 1) || (skipSeg && i === index - 2)) {
          return Object.assign({}, s, { actualEndMs: actualStartMs });
        }
        return s;
      }
      if (i === index) {
        return Object.assign({}, s, {
          startMs: actualStartMs,
          endMs: actualStartMs + s.durationMs,
          plannedStartMs: s.plannedStartMs + delta,
          plannedEndMs: s.plannedEndMs + delta,
          actualStartMs: actualStartMs,
          driftMs: (s.plannedStartMs + delta) - s.origPlannedStartMs
        });
      }
      return Object.assign({}, s, {
        startMs: s.startMs + delta,
        endMs: s.endMs + delta,
        plannedStartMs: s.plannedStartMs + delta,
        plannedEndMs: s.plannedEndMs + delta,
        driftMs: (s.plannedStartMs + delta) - s.origPlannedStartMs
      });
    });
  }

  // 12. parseClean(search) -> {clean:boolean, cam:'Off'|'BR'|'BL'|'TR'|'TL'}
  function parseClean(search) {
    var out = { clean: false, cam: "Off" };
    if (!search || typeof search !== "string") return out;
    var q = search.charAt(0) === "?" ? search.slice(1) : search;
    if (!q) return out;
    var parts = q.split("&");
    var validCam = { BR: "BR", BL: "BL", TR: "TR", TL: "TL", OFF: "Off" };
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      var k = decodeURIComponent(kv[0] || "").toLowerCase();
      var v = decodeURIComponent(kv[1] || "");
      if (k === "clean") {
        var vl = v.toLowerCase();
        out.clean = vl === "1" || vl === "true" || vl === "yes";
      } else if (k === "cam") {
        var vu = v.toUpperCase();
        if (validCam[vu]) out.cam = validCam[vu];
      }
    }
    return out;
  }

  // 13. nextState(machine, event, nowMs) -> {machine, actions}
  function cloneDeck(d) {
    return {
      id: d.id,
      role: d.role,
      source: d.source,
      volume: d.volume,
      ceiling: d.ceiling,
      readyState: d.readyState,
      readyAtMs: d.readyAtMs !== undefined ? d.readyAtMs : null,
      playing: d.playing,
      loadedItem: d.loadedItem,
      unlocked: d.unlocked
    };
  }

  function cloneMachine(m) {
    return {
      state: m.state,
      segmentId: m.segmentId,
      transitions: m.transitions || 0,
      gateUnlocked: !!m.gateUnlocked,
      activeDeck: m.activeDeck || "A",
      decks: m.decks ? { A: cloneDeck(m.decks.A), B: cloneDeck(m.decks.B) } : null,
      musicSource: m.musicSource || "Library",
      blockSourceOverride: m.blockSourceOverride || null,
      fadeStartMs: m.fadeStartMs !== undefined ? m.fadeStartMs : null,
      fadeDurMs: m.fadeDurMs || 0,
      fadeStartInFrac: typeof m.fadeStartInFrac === "number" ? m.fadeStartInFrac : 0,
      fadeKind: m.fadeKind || null,
      activeSegment: m.activeSegment || null,
      nextSegment: m.nextSegment || null,
      afterNextSegment: m.afterNextSegment || null,
      pendingSegmentId: m.pendingSegmentId || null,
      pendingSegment: m.pendingSegment || null,
      skippedSegmentId: m.skippedSegmentId || null,
      skipLoadStarted: !!m.skipLoadStarted,
      skipSilentStartMs: m.skipSilentStartMs !== undefined ? m.skipSilentStartMs : null,
      lastMeasuredGapMs: typeof m.lastMeasuredGapMs === "number" ? m.lastMeasuredGapMs : 0,
      params: m.params || null,
      feedStale: !!m.feedStale,
      libraryUnreachable: !!m.libraryUnreachable,
      volumeMode: m.volumeMode || "crossfade",
      metadataReady: !!m.metadataReady,
      pendingSeekSec: (typeof m.pendingSeekSec === "number") ? m.pendingSeekSec : null,
      podcastSkipWaiting: !!m.podcastSkipWaiting,
      podcastSkipSilentStartMs: m.podcastSkipSilentStartMs !== undefined ? m.podcastSkipSilentStartMs : null,
      standbyNotReadyBanner: !!m.standbyNotReadyBanner,
      musicUnavailableBanner: !!m.musicUnavailableBanner,
      musicUnavailableUntilMs: m.musicUnavailableUntilMs !== undefined ? m.musicUnavailableUntilMs : null,
      slateOverlayUntilMs: m.slateOverlayUntilMs || null,
      musicExitMs: m.musicExitMs || null,
      musicExitReason: m.musicExitReason || null,
      songChangeTimesMs: m.songChangeTimesMs ? m.songChangeTimesMs.slice() : [],
      trackLengthsMs: m.trackLengthsMs ? m.trackLengthsMs.slice() : null,
      retryCount: m.retryCount || 0,
      nextRetryAtMs: m.nextRetryAtMs || null
    };
  }

  function effectiveMusicSource(m) {
    return m.blockSourceOverride || m.musicSource;
  }

  function recomputeMusicExit(m) {
    if (!m.activeSegment || m.activeSegment.type !== "music" || !m.params) return;
    var mode = effectiveMusicSource(m);
    var res = musicExitAtMs(
      m.activeSegment.startMs,
      paramsForSegment(m.activeSegment, m.params),
      m.songChangeTimesMs || [],
      m.feedStale,
      mode,
      m.trackLengthsMs
    );
    m.musicExitMs = res.exitAtMs;
    m.musicExitReason = res.reason;
  }

  function stepSingleTick(m, event, nowMs, actions) {
    if (m.state === "IDLE" || !m.activeSegment || !m.params) return;
    var seg = m.activeSegment;
    var nxt = m.nextSegment;
    var params = m.params;
    var curDeck = m.decks ? m.decks[m.activeDeck] : null;
    var sbId = m.activeDeck === "A" ? "B" : "A";
    var sbDeck = m.decks ? m.decks[sbId] : null;

    // C1: Clear MUSIC UNAVAILABLE banner once its 10 s display window expires after skip completion
    if (m.musicUnavailableUntilMs !== null && nowMs >= m.musicUnavailableUntilMs && !m.skipLoadStarted && m.fadeKind !== "music-skipped") {
      m.musicUnavailableBanner = false;
      m.musicUnavailableUntilMs = null;
    }

    // Simulated load model: standby becomes readyState 4 only when nowMs >= readyAtMs
    if (sbDeck && sbDeck.readyState < 4 && sbDeck.readyAtMs !== null && nowMs >= sbDeck.readyAtMs) {
      sbDeck.readyState = 4;
      if (m.standbyNotReadyBanner && !m.skipLoadStarted && !m.podcastSkipWaiting) {
        m.standbyNotReadyBanner = false;
        if (m.state === "FAILOVER" && m.fadeStartMs === null && curDeck && !curDeck.playing) {
          sbDeck.playing = true;
          sbDeck.role = "on-air";
          sbDeck.volume = sbDeck.ceiling;
          curDeck.role = "standby";
          m.activeDeck = sbId;
          m.state = "PLAYING";
          var promoteSeg = m.pendingSegment || nxt;
          if (promoteSeg) {
            m.segmentId = promoteSeg.id;
            m.activeSegment = promoteSeg;
          }
          m.pendingSegmentId = null;
          m.pendingSegment = null;
          actions.push({ type: "SEGMENT_STARTED", segmentId: m.segmentId, actualStartMs: nowMs, atMs: nowMs });
          actions.push({ type: "LOG", message: "Failover standby became ready -> promoted Deck " + sbId, atMs: nowMs });
        }
      }
    }

    // F1 + C4: Honest load completion when waiting for standby during podcast-skip (measure & log real silent gap)
    if (m.state === "FAILOVER" && m.podcastSkipWaiting) {
      if (sbDeck && sbDeck.readyState >= 3) {
        var podGapMs = m.podcastSkipSilentStartMs !== null ? Math.max(0, nowMs - m.podcastSkipSilentStartMs) : 0;
        m.lastMeasuredGapMs = podGapMs;
        m.podcastSkipSilentStartMs = null;
        m.podcastSkipWaiting = false;
        m.standbyNotReadyBanner = false;
        m.state = "CROSSFADING";
        m.transitions = (m.transitions || 0) + 1;
        m.fadeStartMs = nowMs;
        m.fadeDurMs = 3000;
        m.fadeStartInFrac = 0;
        m.fadeKind = "podcast-skip";
        sbDeck.playing = true;
        actions.push({ type: "START_CROSSFADE", startAtMs: nowMs, measuredGapMs: podGapMs, atMs: nowMs });
        actions.push({ type: "LOG", message: "Podcast-skip standby ready after " + podGapMs + " ms measured silent gap -> 3s crossfade to " + (m.pendingSegment ? m.pendingSegment.name : ""), atMs: nowMs });
      }
      return;
    }

    // Podcast RETRYING state handling
    if (m.state === "RETRYING") {
      if (m.nextRetryAtMs !== null && nowMs >= m.nextRetryAtMs) {
        var maxRetries = typeof params.podcastRetries === "number" ? params.podcastRetries : 3;
        if (m.retryCount < maxRetries) {
          m.retryCount += 1;
          m.nextRetryAtMs = nowMs + (params.retryWaitSec || 5) * 1000;
          actions.push({ type: "PODCAST_RETRY", attempt: m.retryCount, max: maxRetries, atMs: nowMs });
          actions.push({ type: "LOG", message: "podcast retry " + m.retryCount + "/" + maxRetries + " at same position", atMs: nowMs });
        } else {
          // All retries exhausted -> skip to next segment using honest load model & pendingSegmentId
          m.retryCount = 0;
          m.nextRetryAtMs = null;
          m.pendingSegmentId = nxt ? nxt.id : null;
          m.pendingSegment = nxt || null;
          var nextSrc = nxt && nxt.type === "music" ? effectiveMusicSource(m) : "podcast";
          var alreadyReady = sbDeck && sbDeck.readyState >= 3 && sbDeck.loadedItem === (nxt ? nxt.name : "");
          if (alreadyReady || !sbDeck) {
            m.state = "CROSSFADING";
            m.transitions = (m.transitions || 0) + 1;
            m.fadeStartMs = nowMs;
            m.fadeDurMs = 3000;
            m.fadeStartInFrac = 0;
            m.fadeKind = "podcast-skip";
            if (sbDeck) sbDeck.playing = true;
          } else {
            var loadS = nextSrc === "Library" ? (params.libraryLoadSec || 2) : (params.standbyLoadSec || 6);
            if (nextSrc === "Library" && m.libraryUnreachable) loadS = Infinity;
            m.state = "FAILOVER";
            m.podcastSkipWaiting = true;
            m.podcastSkipSilentStartMs = nowMs;
            m.standbyNotReadyBanner = true;
            if (curDeck) { curDeck.playing = false; curDeck.volume = 0; }
            sbDeck.source = nextSrc;
            sbDeck.ceiling = ceilingFor(nextSrc, params);
            sbDeck.loadedItem = nxt ? nxt.name : "Next";
            sbDeck.readyState = 1;
            sbDeck.readyAtMs = nowMs + loadS * 1000;
          }
          actions.push({ type: "PODCAST_SKIP_NEXT", nextSegmentId: nxt ? nxt.id : null, atMs: nowMs });
          actions.push({ type: "LOG", message: "podcast retries exhausted -> skipping to " + (nxt ? nxt.name : "next"), atMs: nowMs });
        }
      }
      return;
    }

    if (seg.type === "podcast") {
      var bp = planBlend(seg, nxt, params);

      // Prebuffer at T-60s
      if (m.state === "PLAYING" && nowMs >= bp.prebufferAtMs) {
        m.state = "PREBUFFERING";
        var srcKind = nxt && nxt.type === "music" ? effectiveMusicSource(m) : "podcast";
        var opsKind = srcKind === "Live 109" ? "live" : (srcKind === "Library" ? "library" : "podcast");
        var loadSec = srcKind === "Library" ? (params.libraryLoadSec || 2) : (params.standbyLoadSec || 6);
        if (srcKind === "Library" && m.libraryUnreachable) loadSec = Infinity;
        if (sbDeck) {
          sbDeck.role = "prebuffer";
          sbDeck.source = srcKind;
          sbDeck.ceiling = ceilingFor(srcKind, params);
          sbDeck.loadedItem = nxt ? nxt.name : "Next";
          if (sbDeck.readyAtMs !== Infinity) {
            sbDeck.readyState = 1;
            sbDeck.readyAtMs = bp.prebufferAtMs + loadSec * 1000;
            if (nowMs >= sbDeck.readyAtMs) sbDeck.readyState = 4;
          } else {
            sbDeck.readyState = 1;
          }
        }
        actions.push({
          type: "PREBUFFER",
          deck: sbId,
          targetType: nxt ? nxt.type : "music",
          targetId: nxt ? nxt.id : null,
          ops: prebufferOps(opsKind),
          atMs: nowMs
        });
        actions.push({ type: "LOG", message: "T-60s prebuffer started on Deck " + sbId + " (" + srcKind + ")", atMs: nowMs });
      }

      // Watchdog at T-15s (before podcast fade-out at T-8s)
      if (m.state === "PREBUFFERING" && nowMs >= bp.watchdogAtMs) {
        var rs = sbDeck ? sbDeck.readyState : 4;
        if (rs < 3) {
          m.state = "FAILOVER";
          m.blockSourceOverride = "Library";
          if (nxt && nxt.type === "music" && m.libraryUnreachable) {
            // Change 2b: Both sources unavailable -> immediately start honest load of following podcast
            var skipTarget = m.afterNextSegment || nxt;
            var podLoadSec = typeof params.standbyLoadSec === "number" ? params.standbyLoadSec : 6;
            m.musicUnavailableBanner = true;
            m.skipLoadStarted = true;
            m.pendingSegmentId = skipTarget.id;
            m.pendingSegment = skipTarget;
            m.skippedSegmentId = nxt.id;
            if (sbDeck) {
              sbDeck.source = "podcast";
              sbDeck.ceiling = params.ceilingPodcast;
              sbDeck.loadedItem = skipTarget.name;
              sbDeck.readyState = 1;
              sbDeck.readyAtMs = bp.watchdogAtMs + podLoadSec * 1000;
              if (nowMs >= sbDeck.readyAtMs) sbDeck.readyState = 4;
            }
            actions.push({ type: "MUSIC_SKIPPED", skippedSegmentId: nxt.id, nextSegmentId: skipTarget.id, atMs: nowMs });
            actions.push({ type: "LOG", message: "MUSIC UNAVAILABLE - block skipped; loading " + skipTarget.name + " (ready in " + podLoadSec + "s)", atMs: nowMs });
          } else {
            var libLoad = m.libraryUnreachable ? Infinity : (params.libraryLoadSec || 2);
            if (sbDeck) {
              sbDeck.source = "Library";
              sbDeck.ceiling = params.ceilingLibrary;
              sbDeck.readyState = 1;
              sbDeck.readyAtMs = bp.watchdogAtMs + libLoad * 1000;
              if (nowMs >= sbDeck.readyAtMs) sbDeck.readyState = 4;
            }
            actions.push({ type: "FAILOVER_LIBRARY", reason: "watchdog_readyState_below_3", atMs: nowMs });
            actions.push({ type: "LOG", message: "Watchdog T-15s: readyState<3 -> FAILOVER to Library (per-block)", atMs: nowMs });
          }
        }
      }

      // Bed fade-in from T-20s to T-8s (over bedFadeInSec, default 3s) — skip if music is being skipped
      if ((m.state === "PREBUFFERING" || m.state === "FAILOVER") && !m.skipLoadStarted && nowMs >= bp.musicInAtMs && nowMs < bp.riseAtMs) {
        if (sbDeck && sbDeck.readyState >= 3) {
          sbDeck.playing = true;
          if (m.volumeMode === "hard-cut") {
            sbDeck.volume = 0;
          } else {
            var bedFrac = params.musicBedPct / 100;
            var bedProg = fadeProgress(nowMs, bp.musicInAtMs, (params.bedFadeInSec || 3) * 1000);
            // Build 15: 'ease-in' (default) starts very quiet and rises slowly; 'linear' reproduces the old straight ramp.
            if (params.bedCurve !== "linear") bedProg = bedProg * bedProg;
            sbDeck.volume = Math.min(sbDeck.ceiling, sbDeck.ceiling * bedFrac * bedProg);
          }
        }
        if (curDeck) curDeck.volume = curDeck.ceiling;
      }

      // Change 2c: Skip path — 3s crossfade starts at max(T-8, readyAtMs); if podcast ends before ready, hold & measure real silent gap
      if (m.state === "FAILOVER" && m.skipLoadStarted) {
        var readyAt = sbDeck && sbDeck.readyAtMs !== null ? sbDeck.readyAtMs : nowMs;
        if (sbDeck && sbDeck.readyState < 3) {
          if (nowMs >= seg.endMs) {
            if (curDeck) {
              curDeck.playing = false;
              curDeck.volume = 0;
            }
            if (!m.standbyNotReadyBanner) {
              m.standbyNotReadyBanner = true;
              m.skipSilentStartMs = seg.endMs;
              actions.push({ type: "LOG", message: "STANDBY NOT READY: podcast ended before next podcast loaded", atMs: nowMs });
            }
          }
        } else {
          var startAt = Math.max(bp.riseAtMs, readyAt);
          if (nowMs >= startAt) {
            var measuredGap = 0;
            if (m.skipSilentStartMs !== null) {
              measuredGap = Math.max(0, startAt - m.skipSilentStartMs);
              m.lastMeasuredGapMs = measuredGap;
              m.standbyNotReadyBanner = false;
              actions.push({ type: "LOG", message: "Skip standby ready after " + measuredGap + " ms measured silent gap", atMs: nowMs });
            } else {
              m.lastMeasuredGapMs = 0;
            }
            m.state = "CROSSFADING";
            m.transitions = (m.transitions || 0) + 1;
            m.fadeStartMs = startAt;
            m.fadeDurMs = 3000;
            m.fadeStartInFrac = 0;
            m.fadeKind = "music-skipped";
            if (sbDeck) sbDeck.playing = true;
            actions.push({ type: "START_CROSSFADE", startAtMs: startAt, measuredGapMs: measuredGap, atMs: nowMs });
            actions.push({ type: "LOG", message: "Skip 3s crossfade started at " + formatDenverHMS(startAt) + " -> " + (m.pendingSegment ? m.pendingSegment.name : ""), atMs: nowMs });
          }
        }
      }

      // Normal rise / crossfade at T-8s (when not already in skip-load path)
      if ((m.state === "PREBUFFERING" || m.state === "FAILOVER") && !m.skipLoadStarted && nowMs >= bp.riseAtMs) {
        var musicNotReady = sbDeck && sbDeck.readyState < 3;
        var libraryBlocked = m.libraryUnreachable && (effectiveMusicSource(m) === "Library" || m.state === "FAILOVER");
        if (nxt && nxt.type === "music" && (musicNotReady || libraryBlocked)) {
          // Fallback skip if music became unavailable right at T-8s: start honest load of next podcast
          var nextPod = m.afterNextSegment || nxt;
          var pLoadSec = typeof params.standbyLoadSec === "number" ? params.standbyLoadSec : 6;
          m.state = "FAILOVER";
          m.musicUnavailableBanner = true;
          m.skipLoadStarted = true;
          m.pendingSegmentId = nextPod.id;
          m.pendingSegment = nextPod;
          m.skippedSegmentId = nxt.id;
          if (sbDeck) {
            sbDeck.source = "podcast";
            sbDeck.ceiling = params.ceilingPodcast;
            sbDeck.loadedItem = nextPod.name;
            sbDeck.readyState = 1;
            sbDeck.readyAtMs = nowMs + pLoadSec * 1000;
          }
          actions.push({ type: "MUSIC_SKIPPED", skippedSegmentId: nxt.id, nextSegmentId: nextPod.id, atMs: nowMs });
          actions.push({ type: "LOG", message: "MUSIC UNAVAILABLE - block skipped; loading " + nextPod.name, atMs: nowMs });
        } else {
          m.state = "CROSSFADING";
          m.transitions = (m.transitions || 0) + 1;
          m.fadeStartMs = bp.podcastFadeStartMs;
          m.fadeDurMs = bp.podcastFadeDurMs;
          m.fadeStartInFrac = (nxt && nxt.type === "music") ? (params.musicBedPct / 100) : 0;
          m.fadeKind = "podcast-to-music";
          m.musicUnavailableBanner = false;
          m.pendingSegmentId = nxt ? nxt.id : null;
          m.pendingSegment = nxt || null;
          actions.push({ type: "START_CROSSFADE", atMs: nowMs });
          actions.push({ type: "LOG", message: "T-8s rise / crossfade started (startInFrac=" + m.fadeStartInFrac + ")", atMs: nowMs });
        }
      }

      // Crossfading gain computation
      if (m.state === "CROSSFADING" && curDeck && sbDeck) {
        var p = fadeProgress(nowMs, m.fadeStartMs, m.fadeDurMs);
        if (m.volumeMode === "hard-cut") {
          curDeck.volume = p >= 1 ? 0 : (curDeck.playing ? curDeck.ceiling : 0);
          sbDeck.volume = p >= 1 ? sbDeck.ceiling : 0;
          sbDeck.playing = p >= 1;
        } else {
          var gains = crossfadeGains(p, curDeck.playing ? curDeck.ceiling : 0, sbDeck.ceiling, m.fadeStartInFrac);
          curDeck.volume = gains.out;
          sbDeck.volume = gains.in;
          sbDeck.playing = true;
        }
        if (p >= 1) {
          curDeck.playing = false;
          curDeck.volume = 0;
          curDeck.role = "standby";
          curDeck.readyState = 0;
          curDeck.readyAtMs = null;
          sbDeck.playing = true;
          sbDeck.volume = sbDeck.ceiling;
          sbDeck.role = "on-air";
          m.activeDeck = sbId;
          m.state = "PLAYING";
          m.fadeStartMs = null;
          m.fadeDurMs = 0;
          m.fadeStartInFrac = 0;
          var promotedSeg = m.pendingSegment;
          var promotedId = m.pendingSegmentId;
          var skippedId = m.skippedSegmentId;
          m.pendingSegmentId = null;
          m.pendingSegment = null;
          m.skippedSegmentId = null;
          m.skipLoadStarted = false;
          m.skipSilentStartMs = null;
          m.fadeKind = null;
          if (skippedId) {
            m.musicUnavailableBanner = true;
            m.musicUnavailableUntilMs = nowMs + 10000;
          }
          if (promotedSeg) {
            m.segmentId = promotedId;
            m.activeSegment = promotedSeg;
            if (promotedSeg.type === "music") {
              m.musicUnavailableBanner = false;
              m.musicUnavailableUntilMs = null;
              m.songChangeTimesMs = [];
              recomputeMusicExit(m);
            } else {
              m.blockSourceOverride = null;
            }
          }
          actions.push({ type: "SEGMENT_STARTED", segmentId: m.segmentId, actualStartMs: nowMs, skippedSegmentId: skippedId || null, atMs: nowMs });
          actions.push({ type: "TEARDOWN", deck: curDeck.id, ops: teardownOps(curDeck.id), atMs: nowMs });
          actions.push({ type: "LOG", message: "Crossfade complete -> Deck " + sbId + " on air (" + m.segmentId + ")", atMs: nowMs });
        }
      }
    } else {
      // Music block: elastic exit via musicExitAtMs
      if (!m.musicExitMs) recomputeMusicExit(m);
      var exitMs = m.musicExitMs || seg.endMs;
      var fadeDur = params.musicFadeOutSec * 1000;
      var fadeStart = exitMs - fadeDur;
      var preStart = exitMs - params.prebufferSec * 1000;

      if (m.state === "PLAYING" && nowMs >= preStart) {
        m.state = "PREBUFFERING";
        var podLoad = params.standbyLoadSec || 6;
        if (sbDeck && nxt) {
          sbDeck.role = "prebuffer";
          sbDeck.source = "podcast";
          sbDeck.ceiling = ceilingFor("podcast", params);
          sbDeck.loadedItem = nxt.name;
          sbDeck.readyState = 1;
          sbDeck.readyAtMs = preStart + podLoad * 1000;
          if (nowMs >= sbDeck.readyAtMs) sbDeck.readyState = 4;
        }
        actions.push({
          type: "PREBUFFER",
          deck: sbId,
          targetType: nxt ? nxt.type : "podcast",
          targetId: nxt ? nxt.id : null,
          ops: prebufferOps("podcast"),
          atMs: nowMs
        });
        actions.push({ type: "LOG", message: "Music T-60s prebuffer started for podcast " + (nxt ? nxt.name : ""), atMs: nowMs });
      }

      if ((m.state === "PREBUFFERING" || m.state === "FAILOVER") && nowMs >= fadeStart) {
        m.state = "CROSSFADING";
        m.transitions = (m.transitions || 0) + 1;
        m.fadeStartMs = fadeStart;
        m.fadeDurMs = fadeDur;
        m.fadeStartInFrac = (typeof params.podcastInStartPct === "number" ? params.podcastInStartPct : 0) / 100; // Build 15: next podcast starts quietly, not from silence
        m.fadeKind = "music-to-podcast";
        m.pendingSegmentId = nxt ? nxt.id : null;
        m.pendingSegment = nxt || null;
        actions.push({ type: "START_CROSSFADE", atMs: nowMs });
        actions.push({ type: "LOG", message: "Music fade-out started (" + (m.musicExitReason || "window") + ")", atMs: nowMs });
      }

      if (m.state === "CROSSFADING" && curDeck && sbDeck) {
        var pm = fadeProgress(nowMs, m.fadeStartMs, m.fadeDurMs);
        if (m.volumeMode === "hard-cut") {
          curDeck.volume = pm >= 1 ? 0 : curDeck.ceiling;
          sbDeck.volume = pm >= 1 ? sbDeck.ceiling : 0;
          sbDeck.playing = pm >= 1;
        } else {
          var gm = crossfadeGains(pm, curDeck.ceiling, sbDeck.ceiling, m.fadeStartInFrac || 0);
          curDeck.volume = gm.out;
          sbDeck.volume = gm.in;
          sbDeck.playing = true;
        }
        if (pm >= 1) {
          curDeck.playing = false;
          curDeck.volume = 0;
          curDeck.role = "standby";
          curDeck.readyState = 0;
          curDeck.readyAtMs = null;
          sbDeck.playing = true;
          sbDeck.volume = sbDeck.ceiling;
          sbDeck.role = "on-air";
          m.activeDeck = sbId;
          m.state = "PLAYING";
          m.fadeStartMs = null;
          m.fadeDurMs = 0;
          m.fadeStartInFrac = 0;
          m.blockSourceOverride = null; // 6) Clear per-block failover override for next block
          m.musicExitMs = null;
          m.musicExitReason = null;
          m.slateOverlayUntilMs = nowMs + 4000; // 2) 4s visual-only Station ID slate overlay
          var promM = m.pendingSegment;
          var promMId = m.pendingSegmentId;
          m.pendingSegmentId = null;
          m.pendingSegment = null;
          if (promM) {
            m.segmentId = promMId;
            m.activeSegment = promM;
          }
          actions.push({ type: "SEGMENT_STARTED", segmentId: m.segmentId, actualStartMs: nowMs, atMs: nowMs });
          actions.push({ type: "SLATE_OVERLAY", untilMs: m.slateOverlayUntilMs, atMs: nowMs });
          actions.push({ type: "TEARDOWN", deck: curDeck.id, ops: teardownOps(curDeck.id), atMs: nowMs });
          actions.push({ type: "LOG", message: "Music->Podcast complete -> Deck " + sbId + " on air (4s visual slate)", atMs: nowMs });
        }
      }
    }
  }

  function nextState(machine, event, nowMs) {
    var actions = [];
    var m = cloneMachine(machine);
    var evType = event && event.type ? event.type : "";
    var evSegId = event ? event.segmentId : undefined;

    // 8) Every event except START, RESUME, TOGGLE_SOURCE must carry a segmentId
    if (evType !== "START" && evType !== "RESUME" && evType !== "TOGGLE_SOURCE") {
      if (evSegId === undefined || evSegId === null || evSegId === "") {
        actions.push({
          type: "LOG",
          message: "ignored: missing segmentId",
          eventType: evType,
          atMs: nowMs
        });
        return { machine: machine, actions: actions };
      }
      if (m.segmentId !== undefined && m.segmentId !== null && evSegId !== m.segmentId) {
        actions.push({
          type: "LOG",
          message: "ignored stale",
          eventType: evType,
          segmentId: evSegId,
          currentSegmentId: m.segmentId,
          atMs: nowMs
        });
        return { machine: machine, actions: actions };
      }
    }

    if (evType === "START") {
      if (!event.gatePressed && !m.gateUnlocked) {
        actions.push({ type: "LOG", message: "start refused: gate locked", atMs: nowMs });
        return { machine: m, actions: actions };
      }
      m.gateUnlocked = true;
      if (m.decks) {
        m.decks.A.unlocked = true;
        m.decks.B.unlocked = true;
        var ad = m.decks[m.activeDeck];
        ad.playing = true;
        ad.readyState = 4;
        ad.volume = ad.ceiling;
      }
      m.state = "PLAYING";
      if (event.segmentId) m.segmentId = event.segmentId;
      if (m.activeSegment && m.activeSegment.type === "music") recomputeMusicExit(m);
      actions.push({ type: "LOG", message: "started on air; decks A and B unlocked", atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "TOGGLE_SOURCE") {
      m.musicSource = event.source ? event.source : (m.musicSource === "Library" ? "Live 109" : "Library");
      if (m.activeSegment && m.activeSegment.type === "music") recomputeMusicExit(m);
      actions.push({ type: "LOG", message: "music source set to " + m.musicSource, atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "FEED_STALE") {
      m.feedStale = true;
      if (m.activeSegment && m.activeSegment.type === "music") recomputeMusicExit(m);
      actions.push({ type: "LOG", message: "feed marked stale; music exit recomputed to target", atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "CAN_PLAY") {
      if (m.decks) {
        var standById = m.activeDeck === "A" ? "B" : "A";
        m.decks[standById].readyState = 4;
      }
      actions.push({ type: "LOG", message: "standby deck readyState=4", atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "METADATA") {
      m.metadataReady = true;
      if (typeof m.pendingSeekSec === "number") {
        var seekTarget = m.pendingSeekSec;
        m.pendingSeekSec = null;
        actions.push({ type: "SEEK", seekToSec: seekTarget, atMs: nowMs });
        actions.push({ type: "LOG", message: "METADATA arrived -> executing pending seek to " + seekTarget + "s", atMs: nowMs });
      } else {
        actions.push({ type: "LOG", message: "metadata loaded", atMs: nowMs });
      }
      return { machine: m, actions: actions };
    }

    if (evType === "STALL" || evType === "ERROR") {
      // F1: Watchdog for on-air podcast: do not burn retries if already RETRYING; set pendingSegmentId & honest load on skip
      var isActivePodcast =
        m.activeSegment &&
        m.activeSegment.type === "podcast" &&
        (event.deck === "active" || event.deckId === m.activeDeck);

      if (isActivePodcast) {
        if (m.state === "RETRYING") {
          actions.push({ type: "LOG", message: "ignored " + evType + " while already RETRYING (" + m.retryCount + ")", atMs: nowMs });
          return { machine: m, actions: actions };
        }
        if (m.state === "CROSSFADING" || m.podcastSkipWaiting) {
          actions.push({ type: "LOG", message: "ignored " + evType + " while already skipping/crossfading", atMs: nowMs });
          return { machine: m, actions: actions };
        }
        var maxR = m.params && typeof m.params.podcastRetries === "number" ? m.params.podcastRetries : 3;
        var waitSec = m.params && typeof m.params.retryWaitSec === "number" ? m.params.retryWaitSec : 5;
        if (m.retryCount < maxR) {
          m.state = "RETRYING";
          m.retryCount += 1;
          m.nextRetryAtMs = nowMs + waitSec * 1000;
          actions.push({ type: "PODCAST_RETRY", attempt: m.retryCount, max: maxR, atMs: nowMs });
          actions.push({ type: "LOG", message: "active podcast " + evType + " -> RETRYING (" + m.retryCount + "/" + maxR + ")", atMs: nowMs });
        } else {
          m.retryCount = 0;
          m.nextRetryAtMs = null;
          m.pendingSegmentId = m.nextSegment ? m.nextSegment.id : null;
          m.pendingSegment = m.nextSegment || null;
          var sbIdErr = m.activeDeck === "A" ? "B" : "A";
          var sbDeckErr = m.decks ? m.decks[sbIdErr] : null;
          var curDeckErr = m.decks ? m.decks[m.activeDeck] : null;
          var nextSrcErr = m.nextSegment && m.nextSegment.type === "music" ? effectiveMusicSource(m) : "podcast";
          var isReadyErr = sbDeckErr && sbDeckErr.readyState >= 3 && sbDeckErr.loadedItem === (m.nextSegment ? m.nextSegment.name : "");
          if (isReadyErr || !sbDeckErr) {
            m.state = "CROSSFADING";
            m.transitions = (m.transitions || 0) + 1;
            m.fadeStartMs = nowMs;
            m.fadeDurMs = 3000;
            m.fadeStartInFrac = 0;
            m.fadeKind = "podcast-skip";
            if (sbDeckErr) sbDeckErr.playing = true;
          } else {
            var loadErr = nextSrcErr === "Library" ? (m.params ? (m.params.libraryLoadSec || 2) : 2) : (m.params ? (m.params.standbyLoadSec || 6) : 6);
            if (nextSrcErr === "Library" && m.libraryUnreachable) loadErr = Infinity;
            m.state = "FAILOVER";
            m.podcastSkipWaiting = true;
            m.podcastSkipSilentStartMs = nowMs;
            m.standbyNotReadyBanner = true;
            if (curDeckErr) { curDeckErr.playing = false; curDeckErr.volume = 0; }
            sbDeckErr.source = nextSrcErr;
            sbDeckErr.ceiling = m.params ? ceilingFor(nextSrcErr, m.params) : 0.85;
            sbDeckErr.loadedItem = m.nextSegment ? m.nextSegment.name : "Next";
            sbDeckErr.readyState = 1;
            sbDeckErr.readyAtMs = nowMs + loadErr * 1000;
          }
          actions.push({ type: "PODCAST_SKIP_NEXT", nextSegmentId: m.pendingSegmentId, atMs: nowMs });
          actions.push({ type: "LOG", message: "podcast retries exhausted -> skip to " + (m.pendingSegment ? m.pendingSegment.name : "next"), atMs: nowMs });
        }
        return { machine: m, actions: actions };
      }

      // Otherwise standby/music deck stall -> per-block failover to Library (or stall standby load to Infinity)
      var sbId = m.activeDeck === "A" ? "B" : "A";
      if (event.stallStandbyForever && m.decks) {
        m.decks[sbId].readyAtMs = Infinity;
        m.decks[sbId].readyState = 1;
        actions.push({ type: "LOG", message: "standby deck load stalled (readyAtMs=Infinity)", atMs: nowMs });
        return { machine: m, actions: actions };
      }
      m.state = "FAILOVER";
      m.blockSourceOverride = "Library";
      var libLoadSec = m.libraryUnreachable ? Infinity : (m.params ? (m.params.libraryLoadSec || 2) : 2);
      if (m.decks) {
        m.decks[sbId].source = "Library";
        m.decks[sbId].ceiling = m.params ? m.params.ceilingLibrary : 0.85;
        m.decks[sbId].readyState = 1;
        m.decks[sbId].readyAtMs = nowMs + libLoadSec * 1000;
      }
      actions.push({ type: "FAILOVER_LIBRARY", reason: evType, atMs: nowMs });
      actions.push({ type: "LOG", message: evType + " -> FAILOVER to Library (per-block)", atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "ENDED") {
      // T09: ENDED during CROSSFADING must NOT start a second transition
      if (m.state === "CROSSFADING") {
        actions.push({ type: "LOG", message: "ignored ENDED during crossfade", atMs: nowMs });
        return { machine: m, actions: actions };
      }
      var oldDeckId = m.activeDeck;
      var nextDeckId = oldDeckId === "A" ? "B" : "A";
      var nextDeck = m.decks ? m.decks[nextDeckId] : null;

      // 4b) If standby is NOT ready (< 3), do NOT promote as ready -> FAILOVER + load Library + banner
      if (nextDeck && nextDeck.readyState < 3) {
        m.state = "FAILOVER";
        m.blockSourceOverride = "Library";
        m.standbyNotReadyBanner = true;
        if (m.decks) {
          m.decks[oldDeckId].playing = false;
          m.decks[oldDeckId].volume = 0;
          nextDeck.source = "Library";
          nextDeck.ceiling = m.params ? m.params.ceilingLibrary : 0.85;
          var lSec = m.libraryUnreachable ? Infinity : (m.params ? (m.params.libraryLoadSec || 2) : 2);
          nextDeck.readyAtMs = nowMs + lSec * 1000;
          // Keep nextDeck.readyState unchanged (< 3) right after the event
        }
        actions.push({ type: "FAILOVER_LIBRARY", reason: "ended_standby_not_ready", atMs: nowMs });
        actions.push({ type: "LOG", message: "ENDED while standby not ready -> FAILOVER to Library (STANDBY NOT READY)", atMs: nowMs });
        return { machine: m, actions: actions };
      }

      // Standby IS ready (>= 3): promote immediately (no fake silent gap number)
      m.transitions = (m.transitions || 0) + 1;
      m.state = "PLAYING";
      m.fadeStartMs = null;
      m.fadeDurMs = 0;
      m.activeDeck = nextDeckId;
      if (m.nextSegment) {
        m.segmentId = m.nextSegment.id;
        m.activeSegment = m.nextSegment;
        if (m.activeSegment.type === "music") {
          m.songChangeTimesMs = [];
          recomputeMusicExit(m);
        }
      } else if (event.nextSegmentId) {
        m.segmentId = event.nextSegmentId;
      }
      if (m.decks) {
        m.decks[oldDeckId].playing = false;
        m.decks[oldDeckId].volume = 0;
        m.decks[oldDeckId].role = "standby";
        m.decks[oldDeckId].readyState = 0;
        m.decks[oldDeckId].readyAtMs = null;
        m.decks[nextDeckId].playing = true;
        m.decks[nextDeckId].role = "on-air";
        m.decks[nextDeckId].volume = m.decks[nextDeckId].ceiling;
      }
      actions.push({ type: "SEGMENT_STARTED", segmentId: m.segmentId, actualStartMs: nowMs, atMs: nowMs });
      actions.push({ type: "PROMOTE_IMMEDIATE", deck: nextDeckId, atMs: nowMs });
      actions.push({ type: "TEARDOWN", deck: oldDeckId, ops: teardownOps(oldDeckId), atMs: nowMs });
      actions.push({ type: "LOG", message: "early ENDED promoted ready Deck " + nextDeckId, atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "SONG_CHANGE") {
      if (m.activeSegment && m.activeSegment.type === "music" && m.params) {
        m.songChangeTimesMs = (m.songChangeTimesMs || []).concat([nowMs]);
        recomputeMusicExit(m);
        actions.push({
          type: "LOG",
          message: "SONG_CHANGE at +" + formatMMSS((nowMs - m.activeSegment.startMs) / 1000) + " -> exit " + formatDenverHMS(m.musicExitMs) + " (" + m.musicExitReason + ")",
          atMs: nowMs
        });
        // Re-evaluate tick transitions immediately in case fade should begin now
        stepSingleTick(m, event, nowMs, actions);
        return { machine: m, actions: actions };
      }
      actions.push({ type: "LOG", message: "SONG_CHANGE outside music block ignored", atMs: nowMs });
      return { machine: m, actions: actions };
    }

    if (evType === "RESUME") {
      var plan = resumePlan(
        event.savedStartMs,
        nowMs,
        event.durationMs,
        event.seekable !== false,
        m.params ? m.params.nearEndSkipSec : 15
      );
      actions.push({ type: "RESUME_PLAN", plan: plan, atMs: nowMs });
      if (plan.action === "seek") {
        if (m.metadataReady) {
          m.pendingSeekSec = null;
          actions.push({ type: "SEEK", seekToSec: plan.seekToSec, atMs: nowMs });
          actions.push({ type: "LOG", message: "RESUME -> seek " + plan.seekToSec + "s (metadata ready)", atMs: nowMs });
        } else {
          m.pendingSeekSec = plan.seekToSec;
          actions.push({ type: "WAIT_METADATA", seekToSec: plan.seekToSec, atMs: nowMs });
          actions.push({ type: "LOG", message: "RESUME -> waiting for METADATA before seek to " + plan.seekToSec + "s", atMs: nowMs });
        }
      } else {
        m.pendingSeekSec = null;
        actions.push({ type: "RESUME_SKIP_NEXT", atMs: nowMs });
        actions.push({ type: "LOG", message: "RESUME -> next", atMs: nowMs });
      }
      return { machine: m, actions: actions };
    }

    if (evType === "TICK") {
      // 13) Big jump support: re-run transitions until state & segmentId stop changing, at most 5 passes
      for (var pass = 0; pass < 5; pass++) {
        var prevState = m.state;
        var prevSeg = m.segmentId;
        stepSingleTick(m, event, nowMs, actions);
        if (m.state === prevState && m.segmentId === prevSeg) break;
      }
      return { machine: m, actions: actions };
    }

    return { machine: m, actions: actions };
  }

  // 14. layoutFor(camPos, width, height, tickerVisible)
  function layoutFor(camPos, width, height, tickerVisible) {
    var w = width || 1920;
    var h = height || 1080;
    var showTicker = tickerVisible !== false;
    var s = h / 1080;
    var pad = Math.max(4, Math.round(8 * s));
    var headerH = Math.round(48 * s);
    var lowerH = Math.round(64 * s);
    var tickerH = showTicker ? Math.round(40 * s) : 0;
    var camW = Math.round(w * 0.25);
    var camH = Math.round(h * 0.25);

    var cam = null;
    if (camPos === "BR") cam = { x: w - camW, y: h - camH, w: camW, h: camH };
    else if (camPos === "BL") cam = { x: 0, y: h - camH, w: camW, h: camH };
    else if (camPos === "TR") cam = { x: w - camW, y: 0, w: camW, h: camH };
    else if (camPos === "TL") cam = { x: 0, y: 0, w: camW, h: camH };

    var hdrX = camPos === "TL" ? (camW + pad) : 0;
    var hdrW = (camPos === "TL" || camPos === "TR") ? (w - camW - pad) : w;
    var header = { x: hdrX, y: 0, w: hdrW, h: headerH };

    var tickX = camPos === "BL" ? (camW + pad) : 0;
    var tickW = (camPos === "BL" || camPos === "BR") ? (w - camW - pad) : w;
    var ticker = { x: tickX, y: h - tickerH, w: tickW, h: tickerH };

    var ltY = h - tickerH - lowerH - (showTicker ? pad : 0);
    var ltX = camPos === "BL" ? (camW + pad) : 0;
    var ltW = (camPos === "BL" || camPos === "BR") ? (w - camW - pad) : w;
    var lowerThird = { x: ltX, y: ltY, w: ltW, h: lowerH };

    var contentTop = headerH + pad;
    var contentBottom = ltY - pad;

    var panelW = Math.round(w * 0.30);
    var panelX = w - panelW;
    var pTop = camPos === "TR" ? Math.max(contentTop, camH + pad) : contentTop;
    var pBottom = camPos === "BR" ? Math.min(contentBottom, h - camH - pad) : contentBottom;
    var totalPanelsH = Math.max(40, pBottom - pTop);
    var singlePanelH = Math.floor((totalPanelsH - pad * 3) / 4);
    var panels = [];
    for (var i = 0; i < 4; i++) {
      panels.push({
        x: panelX,
        y: pTop + i * (singlePanelH + pad),
        w: panelW,
        h: singlePanelH
      });
    }

    var stageX = 0;
    var stageW = panelX - pad;
    var sTop = camPos === "TL" ? Math.max(contentTop, camH + pad) : contentTop;
    var sBottom = camPos === "BL" ? Math.min(contentBottom, h - camH - pad) : contentBottom;
    var stage = {
      x: stageX,
      y: sTop,
      w: stageW,
      h: Math.max(40, sBottom - sTop)
    };

    return {
      header: header,
      stage: stage,
      panels: panels,
      lowerThird: lowerThird,
      ticker: ticker,
      cam: cam
    };
  }

  // 15. daypartOf(nowMs)
  function daypartOf(nowMs) {
    var h = denverParts(nowMs).hour;
    // Same boundaries as dayparts.ts (shared with the planner): 5, 12, 18 and 23 Denver.
    if (h >= 5 && h <= 11) return "Morning";
    if (h >= 12 && h <= 17) return "Afternoon";
    if (h >= 18 && h <= 22) return "Evening";
    return "Late Night";
  }

  // 16. pickPanels (11: 4 interleaved lanes so slots only change on their own boundary, zero simultaneous changes, zero duplicates)
  var DAYPART_PREFS = {
    "Morning": ["Weather", "Digest", "Still to come"],
    "Afternoon": ["Live now", "On this day", "Digest", "Weather", "Still to come"],
    "Evening": ["Homepage reel", "Live now", "Still to come", "Digest", "Weather"],
    "Late Night": ["On this day", "Homepage reel", "Still to come", "Weather"]
  };

  function panelChangesInSec(slotIndex, nowMs, dwellSec) {
    var dwell = Math.max(1, dwellSec || 45);
    var offset = slotIndex * 11;
    var sec = Math.floor(nowMs / 1000);
    var mod = ((sec - offset) % dwell + dwell) % dwell;
    return dwell - mod;
  }

  function pickPanels(state, catalog, availability, daypart, segmentType, nowMs) {
    var dwell = (state && state.dwellSec) ? state.dwellSec : 45;
    var avail = availability || {};
    var libDown = !!(state && state.libraryUnreachable);
    var lockPanelA = segmentType === "podcast";

    function isEligibleForLanes(type) {
      if (avail[type] === false) return false;
      if (type === "Last songs" && segmentType !== "music") return false;
      if (type === "On this day" && libDown) return false;
      if (type === "Show card") return false; // Never in rotating lanes (Panel A locked when podcast)
      return true;
    }

    // Build ONE ordered eligible list: daypart preference, then remaining catalog
    var prefs = DAYPART_PREFS[daypart] || DAYPART_PREFS["Afternoon"];
    var ordered = [];
    var i;
    for (i = 0; i < prefs.length; i++) {
      if (isEligibleForLanes(prefs[i]) && ordered.indexOf(prefs[i]) === -1) {
        ordered.push(prefs[i]);
      }
    }
    var cat = catalog || [];
    for (i = 0; i < cat.length; i++) {
      if (isEligibleForLanes(cat[i]) && ordered.indexOf(cat[i]) === -1) {
        ordered.push(cat[i]);
      }
    }

    // Split into 4 interleaved lanes: lane s = entries at positions s, s+4, s+8, ...
    // Build 13: while Panel A is locked to the Show card (podcasts), spread the entries over lanes B-D only, so nothing
    // (Headlines, On this day...) is parked in a lane that is never shown.
    var laneOffset = lockPanelA ? 1 : 0;
    var laneCount = 4 - laneOffset;
    var lanes = [];
    for (i = 0; i < 4; i++) lanes.push([]);
    for (i = 0; i < ordered.length; i++) {
      lanes[laneOffset + (i % laneCount)].push(ordered[i]);
    }

    var sec = Math.floor(nowMs / 1000);
    var chosen = [];
    for (var s = 0; s < 4; s++) {
      if (s === 0 && lockPanelA) {
        chosen.push("Show card");
        continue;
      }
      var lane = lanes[s];
      if (lane.length === 0) {
        chosen.push("Clock card");
      } else {
        var step = Math.floor((sec - 11 * s) / dwell);
        var idx = ((step % lane.length) + lane.length) % lane.length;
        chosen.push(lane[idx]);
      }
    }
    return chosen;
  }

  // 17. resumePlan(savedStartMs, nowMs, durationMs, seekable, nearEndSec)
  function resumePlan(savedStartMs, nowMs, durationMs, seekable, nearEndSec) {
    var elapsedMs = nowMs - savedStartMs;
    var remainingMs = durationMs - elapsedMs;
    var nearMs = (typeof nearEndSec === "number" ? nearEndSec : 15) * 1000;
    if (!seekable || elapsedMs < 0 || remainingMs <= nearMs) {
      return { action: "next", seekToSec: 0, waitForMetadata: false };
    }
    return {
      action: "seek",
      seekToSec: Math.floor(elapsedMs / 1000),
      waitForMetadata: true
    };
  }

  // 18. ringPush & ringExport
  function ringPush(ring, entry, cap) {
    var limit = cap || 500;
    var next = (ring || []).concat([entry]);
    if (next.length > limit) {
      next = next.slice(next.length - limit);
    }
    return next;
  }

  function ringExport(ring) {
    return (ring || []).map(function (item) {
      return JSON.stringify(item);
    }).join("\n");
  }

  // 19. relativeAge & filterFreshHeadlines
  function relativeAge(itemMs, nowMs) {
    var diffSec = Math.max(0, Math.floor((nowMs - itemMs) / 1000));
    if (diffSec < 60) return diffSec + "s ago";
    if (diffSec < 3600) return Math.floor(diffSec / 60) + "m ago";
    return Math.floor(diffSec / 3600) + "h ago";
  }

  function filterFreshHeadlines(headlines, nowMs, maxAgeHours) {
    var maxAgeMs = maxAgeHours * 3600 * 1000;
    return (headlines || []).filter(function (h) {
      var age = nowMs - h.publishedMs;
      return age >= 0 && age <= maxAgeMs;
    });
  }

  // 19b. validateParams(candidate, fallback) -> {ok, params, errors}
  function validateParams(candidate, fallback) {
    var p = Object.assign({}, fallback || {}, candidate || {});
    var errors = [];
    if (!(p.prebufferSec >= p.musicInSec)) errors.push("prebufferSec must be >= musicInSec");
    if (!(p.musicInSec >= p.watchdogSec)) errors.push("musicInSec must be >= watchdogSec");
    if (!(p.watchdogSec > p.riseSec)) errors.push("watchdogSec must be > riseSec");
    if (!(p.riseSec >= p.podcastFadeOutSec && p.podcastFadeOutSec > 0)) errors.push("riseSec must be >= podcastFadeOutSec > 0");
    if (!(p.bedFadeInSec >= 0 && p.bedFadeInSec <= (p.musicInSec - p.riseSec))) errors.push("bedFadeInSec must be 0..(musicInSec - riseSec)");
    if (!(p.musicMinSec >= 30 && p.musicMinSec <= p.musicTargetSec && p.musicTargetSec <= p.musicMaxSec)) errors.push("musicMinSec >= 30 and <= musicTargetSec <= musicMaxSec required");
    if (!(p.musicFadeOutSec > 0 && p.musicFadeOutSec < p.musicMinSec)) errors.push("musicFadeOutSec must be > 0 and < musicMinSec");
    if (!(p.musicBedPct >= 0 && p.musicBedPct <= 100)) errors.push("musicBedPct must be 0..100");
    if (!(p.ceilingPodcast >= 0 && p.ceilingPodcast <= 1)) errors.push("ceilingPodcast must be 0..1");
    if (!(p.ceilingLive109 >= 0 && p.ceilingLive109 <= 1)) errors.push("ceilingLive109 must be 0..1");
    if (!(p.ceilingLibrary >= 0 && p.ceilingLibrary <= 1)) errors.push("ceilingLibrary must be 0..1");
    if (!(p.panelDwellSec >= 34)) errors.push("panelDwellSec must be >= 34");
    if (!(p.standbyLoadSec >= 0 && p.standbyLoadSec <= 60 && p.libraryLoadSec >= 0 && p.libraryLoadSec <= 60)) errors.push("standbyLoadSec and libraryLoadSec must be 0..60");
    if (!(p.podcastRetries >= 0 && p.podcastRetries <= 10 && p.retryWaitSec >= 1)) errors.push("podcastRetries 0..10 and retryWaitSec >= 1");
    if (!(p.horizonHours >= 1 && p.horizonHours <= 48 && p.tickMs >= 20 && p.tickMs <= 1000 && p.nearEndSkipSec >= 0 && p.headlineMaxAgeHours >= 1)) errors.push("horizonHours 1..48, tickMs 20..1000, nearEndSkipSec >= 0, headlineMaxAgeHours >= 1");
    if (p.musicSource !== "Library" && p.musicSource !== "Live 109") errors.push("musicSource must be Library or Live 109");
    return { ok: errors.length === 0, params: errors.length === 0 ? p : Object.assign({}, fallback || {}), errors: errors };
  }

  // 20. volumeWritable(probe)
  function volumeWritable(probe) {
    if (!probe) return { mode: "crossfade" };
    if (probe.writable === false) return { mode: "hard-cut" };
    if (
      typeof probe.target === "number" &&
      typeof probe.afterSet === "number" &&
      Math.abs(probe.afterSet - probe.target) > 0.01
    ) {
      return { mode: "hard-cut" };
    }
    return { mode: "crossfade" };
  }

  // 21. tickOnce(machine, runOfShow, nowMs, event) -> {machine, runOfShow, actions}
  function tickOnce(machine, runOfShow, nowMs, event) {
    var ev = event || { type: "TICK", segmentId: machine.segmentId };
    var res = nextState(machine, ev, nowMs);
    var m = res.machine;
    var ros = runOfShow;
    var actions = res.actions || [];
    var i;

    for (i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (a.type === "SEGMENT_STARTED" && ros && ros.length > 0) {
        var startedIdx = -1;
        for (var j = 0; j < ros.length; j++) {
          if (ros[j].id === a.segmentId) { startedIdx = j; break; }
        }
        if (startedIdx >= 0) {
          ros = rescheduleFrom(ros, startedIdx, a.actualStartMs, a.skippedSegmentId || null);
        }
      }
    }

    if (ros && ros.length > 0 && m) {
      var curIdx = -1;
      for (i = 0; i < ros.length; i++) {
        if (ros[i].id === m.segmentId) { curIdx = i; break; }
      }
      if (curIdx >= 0) {
        m.activeSegment = ros[curIdx];
      }
      if (m.pendingSegmentId) {
        var pIdx = -1;
        for (i = 0; i < ros.length; i++) {
          if (ros[i].id === m.pendingSegmentId) { pIdx = i; break; }
        }
        if (pIdx >= 0) {
          m.pendingSegment = ros[pIdx];
          m.nextSegment = ros[pIdx];
          m.afterNextSegment = ros[pIdx + 1] || ros[0];
        }
      } else if (curIdx >= 0) {
        m.nextSegment = ros[curIdx + 1] || ros[0];
        m.afterNextSegment = ros[curIdx + 2] || ros[0];
      }
    }

    return { machine: m, runOfShow: ros, actions: actions };
  }

  var AJN_PLAYOUT_OBJ = {
    DENVER_OFFSET_MS: DENVER_OFFSET_MS,
    denverMs: denverMs,
    denverParts: denverParts,
    formatDenverHMS: formatDenverHMS,
    formatMMSS: formatMMSS,
    formatSignedDrift: formatSignedDrift,
    advanceClock: advanceClock,
    fadeProgress: fadeProgress,
    crossfadeGains: crossfadeGains,
    planBlend: planBlend,
    nextState: nextState,
    tickOnce: tickOnce,
    prebufferOps: prebufferOps,
    teardownOps: teardownOps,
    applyOps: applyOps,
    libraryPlan: libraryPlan,
    paramsForSegment: paramsForSegment,
    musicExitAtMs: musicExitAtMs,
    buildRunOfShow: buildRunOfShow,
    rescheduleFrom: rescheduleFrom,
    parseClean: parseClean,
    layoutFor: layoutFor,
    pickPanels: pickPanels,
    panelChangesInSec: panelChangesInSec,
    resumePlan: resumePlan,
    ringPush: ringPush,
    ringExport: ringExport,
    daypartOf: daypartOf,
    relativeAge: relativeAge,
    filterFreshHeadlines: filterFreshHeadlines,
    validateParams: validateParams,
    volumeWritable: volumeWritable,
    ceilingFor: ceilingFor
  };

export const AJN_PLAYOUT = AJN_PLAYOUT_OBJ;
