from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

TOOLBOX_DIR = Path(__file__).resolve().parent
load_dotenv(TOOLBOX_DIR / ".env")


@dataclass(frozen=True)
class Config:
    repo_url: str = os.getenv("REPO_URL", "https://github.com/banamine/AJN-Precision-Engineering")
    live_app_url: str = os.getenv("LIVE_APP_URL", "https://ajn-precision-engineering.ai.studio")
    local_clone_path: Path = Path(
        os.getenv("LOCAL_CLONE_PATH") or (Path.home() / "ajn-precision-engineering")
    )
    github_token: str | None = os.getenv("GITHUB_TOKEN") or None


CONFIG = Config()
