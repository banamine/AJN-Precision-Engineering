# Out-branch setup (owner steps, ~10 minutes)

Goal: Replit can push gate results to GitHub on its own branch, and cannot touch main or the queue branch.

1. GitHub > banamine > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   - Name: replit-out-2026-10-20. Expiration: 14 days.
   - Repository access: Only select repositories > AJN-Precision-Engineering.
   - Permissions: Contents = Read and write. Everything else = No access.
2. Replit > Secrets: add GITHUB_TOKEN_OUT = that token. Do not paste it into chat.
3. Branch protection (repo > Settings > Rules > Rulesets > New branch ruleset):
   - Name: protect-main-and-queue. Enforcement: Active.
   - Target branches: main and replit/queue-2026-10-20.
   - Rules: Restrict updates, Restrict deletions, Block force pushes.
   - Bypass list: your own account only (and Claude's session identity if you want Claude to keep updating the queue branch).
   A fine-grained token has no bypass, so Replit cannot push there.
4. (Optional) second ruleset on replit/out-* : Block force pushes + Restrict deletions.
5. Test: ask Replit to push a one-line out/TEST.txt to replit/out-2026-10-20 and then try (and expect to FAIL) pushing the same file to the queue branch. Report both results.
6. Tell Claude "OUT BRANCH LIVE" when step 5 behaved as expected.
Revoke the token (Settings > Developer settings) when the run is finished.
