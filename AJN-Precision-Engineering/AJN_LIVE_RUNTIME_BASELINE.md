# AJN LIVE Runtime Baseline

## Environment
- **Target URL:** `https://ais-pre-22ngduihbs737dbjc6habr-804326557407.us-east1.run.app`
- **Agent Execution Constraints:** The agent runtime does not possess the user's active authentication cookies or session credentials. 
- **Observation Result:** All network requests (including `curl -sL`) to the LIVE domain are intercepted by the Google AI Studio security proxy (returning the `__SECURE-aistudio_auth_flow_may_set_cookies` authentication challenge page). 
- **Conclusion:** The headless agent environment cannot observe or test the LIVE runtime baseline directly.

## Home
*Observation blocked by AI Studio authentication wall.*

## TV Guide
*Observation blocked by AI Studio authentication wall.*

## Player
*Observation blocked by AI Studio authentication wall.*

## Library
*Observation blocked by AI Studio authentication wall.*

## Search
*Observation blocked by AI Studio authentication wall.*

## Fox News
*Observation blocked by AI Studio authentication wall.*

## CNN
*Observation blocked by AI Studio authentication wall.*

## MSNBC
*Observation blocked by AI Studio authentication wall.*

## BBC News
*Observation blocked by AI Studio authentication wall.*

## Continuous Playback
*Observation blocked by AI Studio authentication wall.*

## Console Errors
*Unobservable (no browser context).*

## Media Errors
*Unobservable (no browser context).*

## Network Evidence
*Unobservable (all requests return 302 Found or 200 OK HTML containing the AI Studio Cookie Auth Challenge).*

## Telemetry Visibility
*Unobservable.*

## Acceptance Baseline

| Capability | LIVE Result | Evidence | Pass/Fail |
|---|---|---|---|
| Player | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| Fox News | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| CNN | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| MSNBC | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| BBC News | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| Continuous Playback | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| /api/health | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |
| /api/schedule | Unobservable | AI Studio Auth Intercept | Fail (Blocked) |

## FINAL STATUS

YELLOW — partial baseline; additional evidence required (Requires manual user session in a real browser)
