#!/usr/bin/env python3
"""Display-title cleanup for AJN manifests (dry-run by default).

Usage:
  python3 tools/clean-manifest-titles.py --check   # report only (default), exit 1 if changes pending
  python3 tools/clean-manifest-titles.py --apply   # rewrite manifests in place
  python3 tools/clean-manifest-titles.py --self-test

Guards: display titles only (never identifiers/file/path/url), never empty,
no new same-channel collisions, idempotent, JSON formatting preserved byte-for-byte.
"""
import json, re, sys, collections, pathlib
from urllib.parse import unquote

ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / "src" / "data"
# (file, indent, ensure_ascii, trailing newline)
FMT = {
    "extraChannelsManifest.json": (None, True, False),
    "seriesManifests.json": (1, True, False),
    "organizerShowsManifest.json": (None, False, False),
    "archiveItemManifest.guide.json": (1, False, True),
}
TAGS = r"(?:2160p|1080p|720p|480p|360p|x26[45]|h\.?26[45]|hevc|hdtv|web-?dl|webrip|blu-?ray|bdrip|dvdrip|re-?dvdrip|xvid|divx)"
TAGS_B = r"(?:" + TAGS[3:-1] + r"|aac(?:\d\.\d)?|hdr)"
RULES = [
    ("iso_timestamp_prefix", re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*-\s*"), ""),
    ("ia_or_512kb_suffix", re.compile(r"(?:\.ia|_512kb|_256kb)$"), ""),
    # brackets containing ONLY tags and separators (cast info is kept)
    ("bracket_release_tags", re.compile(r"\s*[\[(]\s*" + TAGS_B + r"(?:[\s.,;_-]+" + TAGS_B + r")*\s*[\])]", re.I), ""),
    ("trailing_release_tags", re.compile(r"[\s._-]+" + TAGS + r"(?:[\s._-]+" + TAGS + r")*(?:-\w+)?$", re.I), ""),
    ("bitchute_prefix", re.compile(r"^BitChute\s*-\s*"), ""),
]
AJ = re.compile(r"^(\d{4})(\d{2})(\d{2})-The Alex Jones Channel-(.*?)(?:-[A-Za-z0-9_ -]{11})?-\d{3,4}x\d{3,4}$")
CHANNEL_RENAMES = {"BitChute - barnaby-jones (2022)": "Barnaby Jones"}


def clean(t):
    o = t
    if re.search(r"%[0-9A-Fa-f]{2}", t):
        t = unquote(t)
    m = AJ.match(t)
    if m:
        t = f"{m.group(4)} ({m.group(1)}-{m.group(2)}-{m.group(3)})"
    for _, rx, rep in RULES:
        t = rx.sub(rep, t)
    if " " not in t and "_" in t:
        t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip(" -_.")
    return t if t else o


def walk_titles(m, name):
    """Yield (container, key, scope) for every display title field."""
    if name == "extraChannelsManifest.json":
        for c in m["channels"]:
            for r in c["rows"]:
                yield r, "title", c["id"]
    elif name == "seriesManifests.json":
        for k, s in m["series"].items():
            for e in s["episodes"]:
                if "title" in e:
                    yield e, "title", k
    elif name == "organizerShowsManifest.json":
        for it in m["items"]:
            yield it, "title", it.get("channelId")


def process(name, m):
    changes = []
    groups = collections.defaultdict(list)
    for cont, key, scope in walk_titles(m, name):
        groups[scope].append((cont, key))
    for scope, lst in groups.items():
        existing = collections.Counter(c[k] for c, k in lst)
        for cont, key in lst:
            old = cont[key]
            new = clean(old)
            if new == old:
                continue
            # collision guard: new title must not newly collide in-channel
            if existing[new] > 0:
                continue
            existing[old] -= 1
            existing[new] += 1
            cont[key] = new
            changes.append((name, scope, old, new))
    # explicit channel renames (names only; ids unchanged)
    def ren(d, k):
        if d.get(k) in CHANNEL_RENAMES:
            changes.append((name, d.get("id") or d.get("channelId") or d.get("key"), d[k], CHANNEL_RENAMES[d[k]]))
            d[k] = CHANNEL_RENAMES[d[k]]
    if name == "seriesManifests.json":
        for s in m["series"].values():
            ren(s, "name"); ren(s, "series")
    elif name == "extraChannelsManifest.json":
        for c in m["channels"]:
            ren(c, "name")
    elif name == "organizerShowsManifest.json":
        for it in m["items"]:
            ren(it, "channelName")
    elif name == "archiveItemManifest.guide.json":
        for c in m["channels"]:
            ren(c, "name")
    return changes


def dump(m, fmt):
    ind, ea, nl = fmt
    s = json.dumps(m, indent=ind, ensure_ascii=ea, separators=(",", ":") if ind is None else None)
    return s + ("\n" if nl else "")


def self_test():
    cases = {
        "2023-01-17T07:15:57.671Z - Foo Bar": "Foo Bar",
        "Show S01E02 720p x264": "Show S01E02",
        "Western [Alan Ladd, Jack Palance; 720p]": "Western [Alan Ladd, Jack Palance; 720p]",
        "Movie (1080p BluRay)": "Movie",
        "BitChute - Some Title": "Some Title",
        "my_show_name": "my show name",
        "Fish%20And%20Chips": "Fish And Chips",
        "Clip.ia": "Clip",
        "20230105-The Alex Jones Channel-Big News-abcdefghijk-1280x720": "Big News (2023-01-05)",
        "720p": "720p",
        "Taxi AAC": "Taxi AAC",
    }
    for a, b in cases.items():
        got = clean(a)
        assert got == b, (a, got, b)
        assert clean(got) == got, ("not idempotent", a)
    m = {"channels": [{"id": "c", "name": "x", "rows": [{"title": "A 720p"}, {"title": "A"}, {"title": "B 720p"}]}]}
    ch = process("extraChannelsManifest.json", m)
    assert [r["title"] for r in m["channels"][0]["rows"]] == ["A 720p", "A", "B"], m  # A collision skipped
    assert len(ch) == 1
    print("self-test OK")


def main():
    a = sys.argv[1:]
    if "--self-test" in a:
        return self_test()
    apply = "--apply" in a
    allc = []
    for name, fmt in FMT.items():
        p = D / name
        raw = p.read_text(encoding="utf-8")
        m = json.loads(raw)
        assert dump(m, fmt) == raw, f"{name}: round-trip not byte-exact"
        ch = process(name, m)
        allc += ch
        if apply and ch:
            p.write_text(dump(m, fmt), encoding="utf-8", newline="")
    by = collections.Counter(c[0] for c in allc)
    print(("APPLIED" if apply else "DRY-RUN"), len(allc), "changes", dict(by))
    for c in allc[:40]:
        print(f"  [{c[0].split('.')[0]}] {c[2]!r} -> {c[3]!r}")
    return 0 if (apply or not allc) else 1


if __name__ == "__main__":
    sys.exit(main())
