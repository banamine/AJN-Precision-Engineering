from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--skip-install", action="store_true")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    result = {"repo": str(repo), "steps": []}
    commands = []
    if not args.skip_install:
        commands.append(["npm", "install"])
    commands.extend([["npm", "run", "build"], ["npx", "tsc", "--noEmit"]])

    exit_code = 0
    for command in commands:
        code, output = run(command, repo)
        result["steps"].append({"command": " ".join(command), "exit_code": code, "output_tail": output[-4000:]})
        if code != 0:
            exit_code = code
            break
    print(json.dumps(result, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
