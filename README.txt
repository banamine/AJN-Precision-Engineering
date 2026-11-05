FIX FOR THE NIGHTLY "AJN Catalog Refresh" FAILURE (run 41883264527, step "Measure payloads")
One file: .github/workflows/ajn-catalog-refresh.yml  (only change: the builder step now ends with  --lists 1,3,4,5 ).
REQUIRES the ZIP 2.1 builder (tools/build-infobattalion-lists.py) to be on main FIRST. The old builder rejects "--lists 1,3,4,5".
Cause (from the log): full mode produced a movies-classics list with fewer than 60 rows; server/moviesClassicsSchedule.ts throws on that, so tools/catalog-measure.mts crashed.
Side effect: the nightly now refreshes only lists 1,3,4,5 (documentary, cartoons, tv, movies). Music, NWT and OTR lists are not refreshed nightly until a separate step is added.
Not verified: a full CI run with the new command (needs a real Archive crawl; run workflow_dispatch with dry_run ticked after merging).
