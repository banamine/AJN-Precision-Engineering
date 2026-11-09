# ArchiveClient Immediate-Stop Unit Test Alignment

Update the unit test suite in `test_infobattalion_builder.py` so its rate-limit and service-stop tests match `ArchiveClient.get()`'s fail-fast behavior on HTTP `403`, `429`, and `503` responses using a shared `_stop_case(self, code, retry_after)` helper.

## User Review & Critical Decisions

> [!IMPORTANT]
> Scope and verification constraints:
> - **Single-File Scope**: Only `test_infobattalion_builder.py` will be edited. `tools/build-infobattalion-lists.py` and all other files remain untouched.
> - **Shared Helper Design**: Adds `_stop_case(self, code, retry_after)` on `InfobattalionBuilderTests` returning `(client, calls)` and replaces the two old retry tests with the three immediate-stop tests (`429`, `503`, `403`).
> - **Verification**: Run `python -m unittest test_infobattalion_builder -q` and `node test-catalog-gate.mjs` and report raw output (and stop immediately if any other test fails).

## 1. Overview & Core Concept

- **What It Does**: Deletes `test_rate_limit_retries_three_times_with_pacing_and_honors_retry_after` and `test_retry_after_is_capped_at_sixty_seconds`, adds `_stop_case(self, code, retry_after)`, and adds `test_429_stops_immediately_without_retry`, `test_503_stops_immediately_and_ignores_retry_after`, and `test_403_stops_immediately_without_retry`.
- **Key Value**: Ensures all tests in `test_infobattalion_builder.py` pass with zero network calls and verify immediate termination on `403`/`429`/`503`.

## 2. User Experience & Visual Design

- **Test Suite Behavior**:
  - `python -m unittest test_infobattalion_builder -q` runs and outputs `OK` with 0 failures.
  - `node test-catalog-gate.mjs` passes unchanged.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Consolidate Stop Assertions into `_stop_case(self, code, retry_after)`**
  - *Chosen Approach*:
    1. `_stop_case(self, code, retry_after)`:
       - Instantiates `clock = FakeClock()`, `calls = []`, and `headers = email.message.Message()` with `headers["Retry-After"] = retry_after`.
       - Defines `opener(_request, timeout)` that appends `timeout` to `calls` and raises `urllib.error.HTTPError("https://archive.org/test", code, "stop", headers, None)`.
       - Builds `client = builder.ArchiveClient(opener=opener, clock=clock.now, sleeper=clock.sleep)`.
       - Calls `client.get("https://archive.org/test")` inside `with self.assertRaises(builder.ArchiveFetchStopped) as ctx:`.
       - Asserts `f"HTTP {code}" in str(ctx.exception)`, `"stopping immediately" in str(ctx.exception)`, `calls == [120]`, `clock.value == 0.0`, and `client._stopped is True`.
       - Returns `(client, calls)`.
    2. `test_429_stops_immediately_without_retry(self)`:
       - Calls `client, calls = self._stop_case(429, "2")`.
       - Calls `client.get("https://archive.org/other")` inside `with self.assertRaises(builder.ArchiveFetchStopped):` and asserts `calls == [120]`.
    3. `test_503_stops_immediately_and_ignores_retry_after(self)`:
       - Calls `self._stop_case(503, "300")`.
    4. `test_403_stops_immediately_without_retry(self)`:
       - Calls `self._stop_case(403, "1")`.
  - *Why*: Eliminates boilerplate across the three status codes while testing the post-stop short-circuit on subsequent `client.get()` calls.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     InfobattalionBuilderTests Suite                      │
│                                                                          │
│  _stop_case(self, code, retry_after)                                     │
│    ├─ FakeClock (value = 0.0) + opener recording timeout in `calls`      │
│    ├─ client.get("https://archive.org/test")                             │
│    ├─ Asserts ArchiveFetchStopped ("HTTP {code}", "stopping immediately")│
│    ├─ Asserts calls == [120], clock.value == 0.0, client._stopped is True│
│    └─ Returns (client, calls)                                            │
│         │                                                                │
│         ├─► test_429_stops_immediately_without_retry (429, "2")          │
│         │     └─ 2nd client.get("https://archive.org/other")             │
│         │        raises ArchiveFetchStopped with calls == [120]          │
│         ├─► test_503_stops_immediately_and_ignores_retry_after (503,"300")│
│         └─► test_403_stops_immediately_without_retry (403, "1")          │
└──────────────────────────────────────────────────────────────────────────┘
```
