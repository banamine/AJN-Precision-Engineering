---
name: Archive search pagination
description: Reliable pagination for complete Internet Archive advancedsearch queries.
---

When building a complete index from Internet Archive advancedsearch, do not rely on `start=` for offsets. Use `page=` with a stable identifier sort, and verify page counts and deduplicate records before publishing the index.

**Why:** The Archive advancedsearch endpoint ignored `start=` during index rebuilding, returning overlapping rows and invalidating aggregate counts.

**How to apply:** For future Archive.org indexes, use deterministic `sort[]=identifier asc`, increment `page`, and validate uniqueness and expected totals before writing output.
