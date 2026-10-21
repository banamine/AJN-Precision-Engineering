# Archive health control board ("digital twin") - plan, phase 2

Status: PLAN ONLY. Do not build until the Phase 1 outage-mode branch (`feat/archive-outage-mode-2026-10-21`) has been
built, pushed and reviewed. This file is the reference for Phase 2. Date: 2026-10-21.

Source: the owner's brainstorm (a virtual control board whose nodes, wires and mini graphs show the backend's real state),
reviewed and reconciled below. The brainstorm referenced an uploaded brainstorm document and a reference image that the
reviewer has not seen; where this plan depends on them it says so.

## 1. Concept (kept from the brainstorm)
Three linked layers, each clickable into the other two:

| What exists | What is happening | What the user sees |
|---|---|---|
| Architecture (nodes, wires) | Runtime evidence (events, probes) | Application behavior (banner, player) |

- Click a node: see its activity and the features it affects.
- Click a banner: see the state decision that activated it.
- Click a failed wire: see the related requests, errors and traces.
- The visual board represents the backend wiring. It must never BE the wiring: closing the board must not disable outage handling.
- No full URLs on the canvas. Destinations live in the inspector, with query strings and tokens redacted.

## 2. Review of the brainstorm (what to keep, change, or watch)

Keep:
- Separate dimensions instead of one linear scale (provider assessment, local reachability, observation point, evidence freshness).
- Stale or missing evidence shows as `unknown`, never green.
- Simulation as a first-class mode, with a persistent `SIMULATION - NO PRODUCTION EFFECT` banner.
- A data contract before any animation. The board renders reported state; it never infers health from colors or particle motion.
- Store state transitions with their evidence and a policy version, so history can explain past decisions.

Change / watch:
1. Phase 1 uses one enum (`ok | degraded | down | unreachable_from_here`). Phase 2 replaces it with the dimensions in section 3. Keep the
   Phase 1 endpoint working (additive fields only) so the banner does not break.
2. "Telemetry ingestion" from browsers is a NEW public write endpoint. It needs authentication or a signed session token, rate limits,
   size limits, schema validation and redaction. Browser reports may only affect `scope: browser` state. They must never flip the
   provider-wide assessment (otherwise anyone can fake an outage).
3. History: a "15-day timeline" needs durable storage. Cloud Run instances are ephemeral and can run in parallel, so in-memory state
   resets on restart and differs between instances. Phase 1 is in-memory only. Phase 2 must name the store (the repo has Firebase
   config files, so Firestore is one candidate) and say how instances share state. Do not claim 15 days of history without that.
4. Dashboard scope is large. Build the data contract and the first slice (section 5), then add graphs and animation.
5. Redaction: inspector URLs can carry signed tokens (Archive and X media links can). Strip query strings and credentials at ingestion,
   not just in the UI.

## 3. State model (dimensions)
| Dimension | Values |
|---|---|
| Provider assessment | healthy, degraded, suspected_outage, unknown |
| Local reachability | reachable, unreachable, unknown (from a control probe to a non-Archive host) |
| Observation scope | backend, browser, synthetic_probe |
| Evidence freshness | current, stale, missing |

Rules: one browser failing does not mark the provider down. One missing item (404/403/410) never counts. Our own backend losing
connectivity is `unreachable`, not a confirmed provider outage. Backend success does not prove a given browser can play media.

## 4. Data contract (proposed node update)
```json
{
  "nodeId": "archive-connector",
  "mode": "live",
  "health": "degraded",
  "activity": "active",
  "scope": "backend",
  "reasonCode": "repeated_timeouts",
  "observedAt": "2026-10-21T17:39:00Z",
  "windowSeconds": 60,
  "evidenceIds": ["event-1042", "event-1048"],
  "policyVersion": "archive-health-v1"
}
```
Modes: `live` (production observations), `history` (recorded), `simulation` (synthetic, preview only). Simulated events live in a
separate store, are tagged at the type level, and are never read by the production health evaluator.

## 5. First slice (build this first in Phase 2)
```
Archive request -> recorded outcome -> health evaluation -> live node update -> warning preview -> clickable supporting event
```
Acceptance tests:
1. One missing item: item-level error, no global outage.
2. Repeated connection failures: `degraded`/`suspected_outage` with evidence ids.
3. Monitoring stops (no recent observations): `unknown` + `evidence: stale`, not green.
4. Service recovers: state clears per the recovery policy (Phase 1 default: 2 good probes).
5. Simulation events never change the production state (test by running a scenario and re-reading production state).
6. Browser telemetry cannot change the provider assessment (test with forged browser events).

Then add, in order: player activity, scan workers, scenario buttons (metadata timeout, item missing, browser cannot reach media host,
backend connectivity failure, scanner overdue, recovery, telemetry connection lost), historical replay.

## 6. Relationship to Phase 1
Phase 1 (`feat/archive-outage-mode-2026-10-21`) builds the pure state machine, `/api/archive/status`, banner, paused thumbnails and
no auto-skip during an outage. Phase 2 reuses that state machine as the health evaluator and adds: the dimensions above, the
data contract and event store, the topology registry (which nodes and wires exist), and the board UI. Review Phase 1 first and
adjust this plan to what was actually built.
