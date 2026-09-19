from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class Result:
    name: str
    status: str
    detail: str
    evidence: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit(result: Result) -> int:
    import json
    print(json.dumps({"timestamp": now_iso(), **result.to_dict()}, sort_keys=True))
    return 0 if result.status in {"PASS", "INFO", "SKIP"} else 1
