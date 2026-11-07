"""Stdlib-only Matroska track reader: codecs from the first bytes of an .mkv (Range request), SeekHead fallback."""

ID_SEGMENT, ID_SEEKHEAD, ID_SEEK, ID_SEEKID, ID_SEEKPOS = 0x18538067, 0x114D9B74, 0x4DBB, 0x53AB, 0x53AC
ID_TRACKS, ID_TRACKENTRY, ID_TRACKTYPE, ID_CODECID, ID_FLAGDEFAULT, ID_TRACKNUM = 0x1654AE6B, 0xAE, 0x83, 0x86, 0x88, 0xD7
ID_CUES, ID_CLUSTER, ID_INFO = 0x1C53BB6B, 0x1F43B675, 0x1549A966
MASTERS = {ID_SEGMENT, ID_SEEKHEAD, ID_SEEK, ID_TRACKS, ID_TRACKENTRY}
VIDEO_OK = {"V_MPEG4/ISO/AVC": "h264", "V_VP8": "vp8", "V_VP9": "vp9", "V_AV1": "av1"}
AUDIO_OK = {"A_AAC": "aac", "A_AAC/MPEG4/LC": "aac", "A_AAC/MPEG2/LC": "aac", "A_MPEG/L3": "mp3", "A_OPUS": "opus", "A_VORBIS": "vorbis"}
NAMES = {"V_MPEGH/ISO/HEVC": "hevc", "A_AC3": "ac3", "A_EAC3": "eac3", "A_DTS": "dts", "V_MPEG2": "mpeg2", "V_MS/VFW/FOURCC": "vfw", "A_FLAC": "flac", "A_TRUEHD": "truehd"}

class Short(Exception): pass

def vint(b, p, mask=True):
    if p >= len(b): raise Short()
    first = b[p]; n = 1; m = 0x80
    while n <= 8 and not first & m: n += 1; m >>= 1
    if n > 8: raise ValueError("bad vint")
    if p + n > len(b): raise Short()
    v = first & (m - 1) if mask else first
    for i in range(1, n): v = (v << 8) | b[p + i]
    unknown = mask and v == (1 << (7 * n)) - 1
    return v, n, unknown

def walk(b, p, end, out, base=0):
    while p < end:
        eid, n, _ = vint(b, p, mask=False); p += n
        size, n, unk = vint(b, p); p += n
        if eid in MASTERS:
            if eid == ID_SEGMENT: out["segment_data"] = p
            stop = len(b) if unk else min(p + size, len(b))
            if eid == ID_TRACKENTRY: out["tracks"].append({})
            if eid == ID_SEEK: out["seeks"].append({})
            if eid == ID_TRACKS: out["tracks_seen"] = True
            walk(b, p, stop, out, base)
            if eid == ID_TRACKS and p + size > len(b): raise Short()
            if unk: return
            p += size; continue
        if p + size > len(b):
            if eid in (ID_CLUSTER,): return
            raise Short()
        data = b[p:p + size]
        if eid == ID_CODECID and out["tracks"]: out["tracks"][-1]["codec"] = data.decode("ascii", "replace").rstrip("\0")
        elif eid == ID_TRACKTYPE and out["tracks"]: out["tracks"][-1]["type"] = int.from_bytes(data, "big")
        elif eid == ID_FLAGDEFAULT and out["tracks"]: out["tracks"][-1]["default"] = int.from_bytes(data, "big")
        elif eid == ID_SEEKID and out["seeks"]: out["seeks"][-1]["id"] = int.from_bytes(data, "big")
        elif eid == ID_SEEKPOS and out["seeks"]: out["seeks"][-1]["pos"] = int.from_bytes(data, "big")
        elif eid == ID_CLUSTER: return
        p += size

def parse(b):
    out = {"tracks": [], "seeks": [], "segment_data": None, "tracks_seen": False}
    try: walk(b, 0, len(b), out, 0)
    except (Short, ValueError): out["short"] = True
    return out

def verdict(info):
    vids = [t for t in info["tracks"] if t.get("type") == 1]
    auds = [t for t in info["tracks"] if t.get("type") == 2]
    pick = lambda ts: next((t for t in ts if t.get("default", 1) == 1), ts[0]) if ts else None
    v, a = pick(vids), pick(auds)
    vc, ac = (v or {}).get("codec"), (a or {}).get("codec")
    vn = VIDEO_OK.get(vc) or NAMES.get(vc) or vc; an = AUDIO_OK.get(ac) or NAMES.get(ac) or ac
    has_cues = any(s.get("id") == ID_CUES for s in info["seeks"])
    reasons = []
    if vc not in VIDEO_OK: reasons.append(f"video={vn or 'none'}")
    if ac not in AUDIO_OK: reasons.append(f"audio={an or 'none'}")
    return {"videoCodec": vc, "audioCodec": ac, "videoNorm": vn, "audioNorm": an, "audioTracks": len(auds),
            "hasCues": has_cues, "browserPlayable": not reasons, **({"reason": "unplayable codec: " + ", ".join(reasons)} if reasons else {})}


MAX_TRACKS_BYTES = 4 * 1024 * 1024

def probe(fetch, first=65536):
    """fetch(start, end) -> bytes for that inclusive byte range (must be a bounded Range read).
    -> dict with status 'verified' (browserPlayable true/false) or 'unverified' (could not read the track list)."""
    b = fetch(0, first - 1); info = parse(b); requests = 1
    complete = info["tracks_seen"] and not info.get("short") and info["tracks"]
    if not complete:
        pos = next((s["pos"] for s in info["seeks"] if s.get("id") == ID_TRACKS), None)
        if pos is None or info["segment_data"] is None:
            return {"status": "unverified", "reason": "track list not in first %d bytes and no SeekHead entry" % first, "requests": requests}
        off = info["segment_data"] + pos
        head = fetch(off, off + 15); requests += 1
        eid, n1, _ = vint(head, 0, mask=False)
        size, n2, unk = vint(head, n1)
        if eid != ID_TRACKS or unk or size > MAX_TRACKS_BYTES:
            return {"status": "unverified", "reason": "SeekHead Tracks pointer invalid or element too large", "requests": requests}
        body = fetch(off, off + n1 + n2 + size - 1); requests += 1
        info2 = parse(body); info2["seeks"] = info["seeks"]; info = info2
        if not info["tracks"] or info.get("short"):
            return {"status": "unverified", "reason": "track list incomplete after SeekHead read", "requests": requests}
    r = verdict(info); r["status"] = "verified"; r["requests"] = requests
    return r
