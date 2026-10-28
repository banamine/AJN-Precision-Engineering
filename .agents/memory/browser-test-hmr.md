---
name: Browser test HMR
description: Keep interactive browser tests isolated from workspace-log file changes.
---

When a browser flow unexpectedly reloads during a Vite development session, check whether workspace tooling is writing logs under a watched project directory. For interactive verification, prefer the built production server on a separate port rather than changing application code to compensate.

**Why:** Replit ShellExec output is persisted under `.local/state/workflow-logs`; the development server's file watcher can treat those logs as page changes and reload the browser, interrupting navigation and playback.

**How to apply:** If interactive tests lose state in dev, reproduce against the built app on a temporary port and distinguish that HMR interruption from an application route or playback failure.
