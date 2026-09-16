from __future__ import annotations

import argparse
import sys
import time

from github import Github

from toolbox.config import CONFIG


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", default="ajn-ci.yml")
    parser.add_argument("--ref", default="main")
    parser.add_argument("--wait", action="store_true")
    args = parser.parse_args()

    if not CONFIG.github_token:
        print("SKIP: GITHUB_TOKEN is not configured for local use")
        return 0

    github = Github(CONFIG.github_token)
    repo = github.get_repo("banamine/AJN-Precision-Engineering")
    workflow = repo.get_workflow(args.workflow)
    workflow.create_dispatch(args.ref)
    print(f"DISPATCHED {args.workflow} ref={args.ref}")

    if not args.wait:
        return 0

    for _ in range(60):
        runs = list(workflow.get_runs(branch=args.ref))
        if runs:
            run = runs[0]
            print(f"RUN {run.id} status={run.status} conclusion={run.conclusion}")
            if run.status == "completed":
                return 0 if run.conclusion == "success" else 1
        time.sleep(5)
    print("FAIL: timed out waiting for workflow")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
