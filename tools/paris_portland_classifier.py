"""Two-bucket classifier for @paris-portland items (Entry 028 of the AJN Collaboration Ledger).

Bucket A "Live Concerts" -> src/data/concertPoolsManifest.json ; Bucket B "FM Broadcasts" -> src/data/fmBroadcastChannels.json.
Rules, in order (first match wins, every result carries its reason - no silent default):
  1. topic tag "live concert" is FINAL (protects items already in the concert pools)
  2. whole-tag match (case-folded set intersection, never substring) on radio/aircheck tags
  3. title regex for hosted shows / radio series
  4. title regex for compound venues and concert festivals
  5. AUDIT default: admitted to Live Concerts with reason AUDIT_REVIEW_UNVERIFIED_VENUE so it can be inspected
"""
import re

FM_TAGS = {"aircheck", "radio series", "freeform portland", "freeform fm", "melting pot", "radio broadcast", "kboo", "kffp", "kmhd"}

FM_TITLE_REGEX = re.compile(
    r"\b("
    r"aircheck|air-check|radio\s+show|radio\s+series|"
    r"freeform\s+portland|melting\s+pot|roots\s+of\s+rock\s+&\s+roll|"
    r"stranger\s+than\s+fiction|jazz\s+night\s+in\s+america|mountain\s+stage|"
    r"jazz\s+at\s+lincoln\s+center|prairie\s+home\s+companion|john\s+peel|top\s+gear|"
    r"in\s+studio|studio\s+session|live\s+at\s+kboo|kpfa\s+studios"
    r")\b",
    re.IGNORECASE,
)

VENUE_REGEX = re.compile(
    r"\b("
    r"rockpalast|loreley|red\s+rocks|oregon\s+country\s+fair|telluride|"
    r"bottom\s+line|king\s+biscuit|kbfh|captured\s+live|"
    r"hammersmith\s+odeon|lisner\s+auditorium|birchmere|fat\s+chance\s+saloon|"
    r"concert\s+hall|music\s+hall|town\s+hall|carnegie\s+hall|amphitheat(?:er|re)|"
    r"opera\s+house|kezar\s+stadium|e-werk"
    r")\b",
    re.IGNORECASE,
)

LIVE, FM = "Live Concerts", "FM Broadcasts"
MANIFEST = {LIVE: "concertPoolsManifest.json", FM: "fmBroadcastChannels.json"}


def classify_paris_portland_v2(item_id, title, topics, creator="", description=""):
    title_clean = (title or "").strip()
    topic_set = {str(t).strip().lower() for t in topics} if topics else set()
    if "live concert" in topic_set:
        return {"bucket": LIVE, "reason": "TAG_LIVE_CONCERT", "manifest": MANIFEST[LIVE]}
    matched = topic_set.intersection(FM_TAGS)
    if matched:
        return {"bucket": FM, "reason": f"TAG_FM_BROADCAST: {sorted(matched)}", "manifest": MANIFEST[FM]}
    if FM_TITLE_REGEX.search(title_clean):
        return {"bucket": FM, "reason": "TITLE_FM_SERIES_MATCH", "manifest": MANIFEST[FM]}
    if VENUE_REGEX.search(title_clean):
        return {"bucket": LIVE, "reason": "TITLE_COMPOUND_VENUE_MATCH", "manifest": MANIFEST[LIVE]}
    return {"bucket": LIVE, "reason": "AUDIT_REVIEW_UNVERIFIED_VENUE", "manifest": MANIFEST[LIVE]}


# ---- Entry 030: FM-tagged audit items (tags 'fm broadcast' / 'freeform radio', no 'live concert') ----
RADIO_FEATURE_REGEX = re.compile(
    r"\b("
    r"story|documentary|retrospective|history|special|interview|profiles?|"
    r"piano\s+jazz|anthology|psychedelicatessen|countdown|spotlight|chronicle|edition|"
    r"(?:radio|tv|hosted)\s+show"
    r")\b",
    re.IGNORECASE,
)
RADIO_HOST_REGEX = re.compile(r"\b(bob\s+harris|kim\s+paris|john\s+peel|mr\.\s*b|dj|hosted\s+by)\b", re.IGNORECASE)
FM_AMBIGUOUS_TAGS = {"fm broadcast", "freeform radio"}


def disambiguate_fm_broadcast_item(title, topics, creator=""):
    text = f"{title} {creator}".lower()
    if RADIO_FEATURE_REGEX.search(title or "") or RADIO_HOST_REGEX.search(text):
        return {"bucket": FM, "reason": "FM_FEATURE_OR_DOCUMENTARY", "manifest": MANIFEST[FM]}
    return {"bucket": LIVE, "reason": "FM_LIVE_CONCERT_PERFORMANCE", "manifest": MANIFEST[LIVE]}


def classify_final(item_id, title, topics, creator="", description=""):
    r = classify_paris_portland_v2(item_id, title, topics, creator, description)
    ts = {str(t).strip().lower() for t in (topics or [])}
    if r["reason"] == "AUDIT_REVIEW_UNVERIFIED_VENUE" and ts & FM_AMBIGUOUS_TAGS:
        return disambiguate_fm_broadcast_item(title, topics, creator)
    return r
