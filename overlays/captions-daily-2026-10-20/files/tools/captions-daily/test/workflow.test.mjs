import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("tools/captions-daily");
const workflow = await readFile(path.join(root, "ajn-captions-daily.yml"), "utf8");
const mainWorkflow = await readFile(path.resolve(".github/workflows/ajn-captions-daily.yml"), "utf8");
const branchReadme = await readFile(path.join(root, "data-branch-readme.md"), "utf8");

test("the two workflow copies are identical and use only requested triggers", () => {
  assert.equal(workflow, mainWorkflow);
  assert.match(workflow, /cron:\s*["']23 12 \* \* \*["']/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}push:/m);
  assert.match(workflow, /timeout-minutes:\s*60/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test("workflow is least-privilege, pins actions, and performs an orphan lease-guarded push", () => {
  assert.match(workflow, /^permissions:\n  contents: write$/m);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /node-version:\s*["']22["']/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.match(workflow, /git commit-tree "\$tree"/);
  assert.match(workflow, /printf '%s %s %s\\n' "\$rows" "\$items" "\$bytes"/);
  assert.match(workflow, /--force-with-lease=refs\/heads\/captions-archive:\$\{expected\}/);
  assert.match(workflow, /data\/captions\/MANIFEST\.csv/);
  assert.doesNotMatch(workflow, /secrets\.(?!GITHUB_TOKEN)/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN\s*:\s*\$\{\{\s*secrets\./);
});

test("data README documents branch visibility, retention limits, rights and takedown contact", () => {
  assert.match(branchReadme, /orphan `captions-archive` branch, separate from `main`/);
  assert.match(branchReadme, /older commit SHAs may remain reachable/);
  assert.match(branchReadme, /not necessarily gone from the Internet/);
  assert.match(branchReadme, /50,000,000-byte cap applies only to `data\/captions\/`/);
  assert.match(branchReadme, /Caption\/transcript text may be protected by copyright/);
  assert.match(branchReadme, /Takedown contact: the repository owner/);
});
