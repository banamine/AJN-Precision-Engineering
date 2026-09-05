# AJN News Archive Playout — drop-in files

Install these files at the matching paths, then let Builder perform Phase 3 verification.

Primary changes:
- bounded Archive.org metadata concurrency
- targeted retries/backoff and User-Agent
- no fake Night of the Living Dead fallback
- preserves HD/4K/SD/trailer/colorized variants while collapsing duplicate encodings
- explicit upstream error propagation from the archive proxy
- shared six-argument playback callback type
- reusable news playout policy constants

Important: this package is a targeted repair set, not a claim that the entire repository has been compiled here. Builder should run `npx tsc --noEmit` and `npm run build` after installation and report any repository-specific type/API mismatches.
