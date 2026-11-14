#!/usr/bin/env python3
"""Add the REST of the Shows list (additive to build-show-drawers.py output).
Run from a folder that already holds src/data/showDrawers.json + showEpisodes/ (the v3 output):
    python build-show-drawers-rest.py --repo <path to repo with m3u_files/ and src/data manifests> [--max-seconds 150]
Sources (the user's own data): src/data/seriesManifests.json, src/data/extraChannelsManifest.json, m3u_files/*.m3u.
Rules: plain .mp4 preferred over .ia.mp4; known-bad items skipped; a show is listed only if its first AND last file answer a
Range request with 200/206 today (else it goes to the report, not the screen); lengths are Archive/manifest lengths (0 = unknown);
talk archives (Alex Jones/Infowars/Liberty Express etc.) and shows the owner dropped are HELD, not added. Resumable (cache/probe).
"""
import json, os, re, sys, time, glob, csv, unicodedata, urllib.parse, urllib.request, urllib.error, datetime, collections
from concurrent.futures import ThreadPoolExecutor

arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
REPO = arg("--repo", "."); MAXS = float(arg("--max-seconds", 150)); T0 = time.time()
CACHE = "tools/.show-drawers-cache"; os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AJN-drawers"}
TODAY = datetime.date.today().isoformat()

BAD_ITEMS = {"01-tv-fighting-crime-part-2_20240703", "01-tv-fighting-crime-part-5"}   # 403 on every sampled file (Drawers Phase 1 report)
DROPPED = re.compile(r"gunsmoke|maverick|lawman|bonanza|rifleman|arsenio|high chaparral|big valley|^bumpers$|mission impossible|^tv ?shows$|^tv ?fighting|^tv ?westerns|torrent couch|^classic tv specials", re.I)
HOLD_TALK = re.compile(r"alex ?24|ajn archive|info ?surviv|info survior|survior|norm archive|infowars|info wars|liberal hivemind|liberty.?express.?live|super alex|surviv guns|project verit|fact.?fake|paul harvey|new world tyranny|rush limbaugh|nightly news", re.I)

PILL_CH = {"Sitcoms & Comedy": "ch101", "Crime & Spy": "ch101", "Westerns": "ch101", "Sci-Fi": "ch101", "Soaps & Drama": "ch101",
           "British": "ch102", "Cartoons": "ch103", "Movies": "ch201", "Documentary": "ch301", "Science": "ch302",
           "Late Night & Talk": "ch401", "Classic News": "ch401", "Reality": "ch601", "Music": "ch501"}

def norm(s):
    s = unicodedata.normalize("NFKC", s).lower().replace("&", " and ")
    s = re.split(r"\s+[-\u2013\u2014:]\s+|\s*\(", s)[0]
    s = re.sub(r"\b(seasons?|series|episodes?|part)\s*\d+([- ]\d+)?\b", " ", s)
    s = re.sub(r"\b(top rated|hd|720p|1080p|480p|hdtv|dvdrip|x264|bonus|complete|series|tv|season|all seasons|collection|vhs|archive|set)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)

# ---------- pill rules (first match wins) ----------
RULES = [
 ("Music", r"music|billboard|eagles|mixer"),
 ("Science", r"how its made|how it s made|mayday|air crash|^aci$|aci |science"),
 ("Documentary", r"american experience|ancient aliens|river monsters|september 11|911|most shocking|ripley|western tradition|cousteau|documentar|nature"),
 ("British", r"father ted|rumpole|top gear|maigret|survivors|prisoner|thriller|hamish macbeth|duchess of duke|spoils of war|half hot|whoops apocalypse|hitchhiker|hhgttg|dave s classic british|blackadder|monty python|benny hill|doctor who|dr who"),
 ("Cartoons", r"total drama|looney|tom and jerry|cartoon|popeye|woody woodpecker|scooby|flintstones|jetsons|iron man|spider ?man|x men|transformers"),
 ("Westerns", r"western|hondo|riders of death valley|wanted dead|bat masterson|wagon train|branded|rawhide|wells fargo|the loner|lone ranger|cisco kid|roy rogers|gene autry|texan|zorro|laramie|cheyenne|sugarfoot|bronco|bonanza"),
 ("Sci-Fi", r"twilight|galactica|odyssey 5|alien nation|gemini man|sci ?fi|six million dollar|ultraseven|dracula|rod serling|night gallery|outer limits|star trek|buck rogers|phantom of the air|green hornet|robinson crusoe|vikings|airwolf|space|logan s run|battlestar|the master|man from u n c l e|uncle"),
 ("Sitcoms & Comedy", r"taxi|hogan|amen|coach|chico|major dad|joanie|malcolm|mister ed|good times|single guy|petticoat|beverly hillbillies|fish|rob |jefferson|honey ?mooner|odd couple|home improvement|barney miller|night ?court|laverne|happy days|mork|three s company|alice|bosom buddies|benson|diff rent|facts of life|gimme a break|webster|silver spoons|perfect strangers|full house|family ties|cheers|frasier|seinfeld|friends|roseanne|action|rat patrol|f troop|gilligan|brady|partridge|bewitched|i dream of jeannie|munsters|addams|green acres|petticoat junction|hee haw|laugh in|carol burnett|sonny|cher|smothers|red skelton|jackie gleason|lucy|dick van dyke|mary tyler moore|bob newhart|rhoda|phyllis|maude|sanford|all in the family|archie bunker"),
 ("Crime & Spy", r"murder she wrote|barnaby|ironside|baron|saint|sherlock|she spies|interpol|colonel march|protectors|secret service|the net|fugitive|kojak|columbo|cannon|adam 12|adam12|hunter|police woman|dragnet|t j hooker|21 jump|mod squad|charlie s angels|hawaii five|the fbi|fbi|rockford|magnum|simon and simon|spenser|mannix|mccloud|quincy|hart to hart|cagney|moonlighting|miami vice|starsky|streets of san francisco|hill street|wiseguy|gang busters|organization|spy|crime|detective|police|cop|ellery|car 54|naked city|man with a camera|staccato|chips|c h i p s|gotham"),
 ("Reality", r"apprentice|tom green|big brother|survivor"),
 ("Documentary", r"unsolved mysteries"),
 ("Movies", r"^classic movies|rebel highway|dcom|disney channel original|^movie"),
 ("Cartoons", r"spawn|family comedy animation|d c follies|jimmy and the federation|little rascals|inside out"),
 ("Sci-Fi", r"fantastic journey|man from atlantis|freakylinks|so weird|terminator|supernatural|pandora|narnia|odyssey|counterstrike|alf|time tunnel|lost in space|land of the giants|voyage to the bottom|fantasy island"),
 ("Westerns", r"wyatt earp|oregon trail|centennial"),
 ("Crime & Spy", r"felony squad|n y p d|nypd|coronet blue|it takes a thief|new alfred hitchcock|alleyn|hache|macgyver|key west|dick tracy|father brown|sniffer|duel on the thin|jj starbuck|j j starbuck|brooklyn nine|aci "),
 ("Sitcoms & Comedy", r"m a s h|mama s family|everybody loves raymond|wkrp|ropers|small wonder|nutt house|9 to 5|wilfred|galavant|even stevens|room 222|laurel and hardy|little rascals|1600 penn|starved|enos|trailer park|tom green|life goes on|norm"),
 ("Soaps & Drama", r"all my children|soap|waltons|little house|sopranos|highway to heaven|knots landing|dallas|falcon crest|dynasty"),
]
RX = [(p, re.compile(rx)) for p, rx in RULES]
def pick_pill(name, group=None):
    n = re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKC", name).lower()).strip()
    if group == "Cartoons": return "Cartoons"
    if group == "Movies": return "Movies"
    if group == "Soap Operas": return "Soaps & Drama"
    for p, rx in RX:
        if rx.search(n): return p
    return "Soaps & Drama"      # default: general drama (reported so the owner can re-file)

def http(url, headers=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=dict(UA, **(headers or {}))), timeout=40); r.read(1); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception as e: return "ERR:" + type(e).__name__

def q(item, fn): return "/download/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(fn, safe="/")
def clean(name):
    t = os.path.splitext(os.path.basename(urllib.parse.unquote(name)))[0]; t = re.sub(r"\.ia$", "", t)
    return re.sub(r"\s+", " ", re.sub(r"[_]+", " ", t)).strip()
def season_ep(name):
    for pat in (r"[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})", r"[Ss]-?(\d{1,2})[ ._-]*EP?[ ._-]*(\d{1,3})", r"(\d{1,2})x(\d{1,3})"):
        m = re.search(pat, name)
        if m: return int(m.group(1)), int(m.group(2))
    return None, None
def slug(t): return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:70]

# ---------- candidates ----------
cands = []   # dict(title, pill, tags, eps=[{t,p,d,s?,e?}], src)
def add(title, pill, eps, src, tags=()):
    cands.append(dict(title=title, pill=pill, eps=eps, src=src, tags=list(tags)))

def merge_dedupe(eps):
    out, seen, plain = [], {}, {e["_k"] for e in eps if not e["_ia"]}
    for e in eps:
        if e["_ia"] and e["_k"] in plain: continue
        if e["_k"] in seen: continue
        seen[e["_k"]] = 1; out.append({k: v for k, v in e.items() if not k.startswith("_")})
    return out

sm = json.load(open(f"{REPO}/src/data/seriesManifests.json", encoding="utf-8"))["series"]
for x in (sm if isinstance(sm, list) else sm.values()):
    eps = []
    for e in x["episodes"]:
        path = e.get("path") or ""
        if not path.startswith("/download/") or e.get("identifier") in BAD_ITEMS: continue
        fn = urllib.parse.unquote(path.split("/", 3)[-1]); ia = fn.lower().endswith(".ia.mp4")
        if not fn.lower().endswith(".mp4"): continue
        d = {"t": e.get("title") or clean(fn), "p": path, "d": int(e.get("durationSeconds") or 0), "_k": (e["identifier"], re.sub(r"\.ia(?=\.mp4$)", "", fn, flags=re.I).lower()), "_ia": ia}
        if e.get("season") is not None: d["s"] = e["season"]; d["e"] = e.get("episode") or 0
        eps.append(d)
    add(x.get("series") or x["name"], None, merge_dedupe(eps), "series:" + x["channelId"], ())
    cands[-1]["group"] = x.get("group"); cands[-1]["name"] = x["name"]

cm = json.load(open(f"{REPO}/src/data/extraChannelsManifest.json", encoding="utf-8"))["channels"]
for c in cm:
    eps = []
    for r in c["rows"]:
        fn = r.get("file") or ""; item = r.get("identifier") or ""
        if not item or item in BAD_ITEMS or not fn.lower().endswith(".mp4"): continue
        ia = fn.lower().endswith(".ia.mp4"); s, e = season_ep(fn)
        d = {"t": r.get("title") or clean(fn), "p": q(item, fn), "d": int(r.get("durationSeconds") or 0), "_k": (item, re.sub(r"\.ia(?=\.mp4$)", "", fn, flags=re.I).lower()), "_ia": ia}
        if s is not None: d["s"] = s; d["e"] = e
        eps.append(d)
    add(c["name"], None, merge_dedupe(eps), "extra:" + c["id"]); cands[-1]["group"] = c.get("group"); cands[-1]["name"] = c["name"]

# ---------- M3U (virtual shows, same split rule as tools/phase1_drawer_audit.py) ----------
SE = [(re.compile(r"[Ss]-?(\d{1,3})[ ._-]*(?:[Ee][Pp]?|x)[ ._-]*(\d{1,3})"), 1, 2), (re.compile(r"\b(\d{1,2})x(\d{1,3})\b"), 1, 2), (re.compile(r"[Ee](\d{1,2})[Ss](\d{1,3})"), 2, 1)]
def pnorm(s):
    s = unicodedata.normalize("NFKC", s).lower().replace("&", " and ")
    s = re.sub(r"\b(top rated|hd|720p|1080p|480p|ia|hdtv|dvdrip|x264|bonus)\b", " ", s); return re.sub(r"[^a-z0-9]+", " ", s).strip()
by_file = collections.OrderedDict()
for f in sorted(glob.glob(f"{REPO}/m3u_files/*.m3u")):
    L = [l.strip() for l in open(f, encoding="utf-8", errors="ignore")]; ents = []
    for i in range(len(L) - 1):
        if L[i].startswith("#EXTINF") and L[i + 1].startswith("http"):
            url = L[i + 1]; path = urllib.parse.urlparse(url).path; parts = path.split("/")
            if len(parts) < 4 or parts[1] != "download": continue
            item = parts[2]; fn = urllib.parse.unquote("/".join(parts[3:])); base = re.sub(r"\.(ia\.)?(mp4|mkv|avi|m4v|webm|mp3)$", "", fn, flags=re.I)
            show = s = e = None
            for rx, sg, eg in SE:
                m = rx.search(base)
                if m: show = pnorm(base[:m.start()]); s, e = int(m.group(sg)), int(m.group(eg)); break
            ents.append(dict(item=item, fn=fn, show=show, s=s, e=e, title=L[i].split(",", 1)[-1], path=path))
    by_file[os.path.splitext(os.path.basename(f))[0]] = ents
vshows = collections.OrderedDict()
for fname, ents in by_file.items():
    cnt = collections.Counter(x["show"] for x in ents if x["show"]); mega = len([s for s, c in cnt.items() if c >= 10]) >= 3
    for x in ents:
        if x["item"] in BAD_ITEMS or not x["fn"].lower().endswith(".mp4"): continue
        key = x["show"] if mega and x["show"] else pnorm(fname); label = x["show"] if mega and x["show"] else fname
        vshows.setdefault(key, dict(label=label, file=fname, ents=[]))["ents"].append(x)
tw = [k for k in vshows if re.search(r"twilight zone", k)]
if tw:   # the numbered '103 twilight zone' ... fragments are one show
    big = vshows.setdefault("the twilight zone collection", dict(label="The Twilight Zone (collection)", file="m3u", ents=[]))
    for k in tw:
        if k != "the twilight zone collection": big["ents"] += vshows.pop(k)["ents"]
for key, v in vshows.items():
    eps = []
    for x in v["ents"]:
        ia = x["fn"].lower().endswith(".ia.mp4")
        d = {"t": clean(x["fn"]), "p": urllib.parse.quote(x["path"], safe="/%"), "d": 0, "_k": (x["item"], re.sub(r"\.ia(?=\.mp4$)", "", x["fn"], flags=re.I).lower()), "_ia": ia}
        if x["s"] is not None: d["s"] = x["s"]; d["e"] = x["e"]
        eps.append(d)
    title = v["label"] if re.search(r"[A-Z]", v["label"]) else v["label"].title()
    add(title, None, merge_dedupe(eps), "m3u:" + v["file"]); cands[-1]["group"] = None; cands[-1]["name"] = title

# ---------- existing data ----------
doc = json.load(open("src/data/showDrawers.json", encoding="utf-8"))
have_titles = {norm(s["title"]) for s in doc["shows"]}; have_ids = {s["id"] for s in doc["shows"]}
def pk(p): return re.sub(r"\.ia(?=\.mp4$)", "", urllib.parse.unquote(p).lower())
have_paths = {}; existing_eps = {}; title_to_show = {}
for sh in doc["shows"]:
    eps_ = json.load(open(f"src/data/showEpisodes/{sh['id']}.json", encoding="utf-8")); existing_eps[sh["id"]] = eps_; title_to_show[norm(sh["title"])] = sh
    for e in eps_: have_paths[pk(e["p"])] = sh["id"]

extend = []
report = {"extended": [], "held_talk": [], "dropped": [], "duplicate": [], "too_few": [], "unplayable": [], "defaulted_to_drama": [], "added": []}
queue = []
for c in cands:
    t = c["title"]; nm = c.get("name") or t
    if HOLD_TALK.search(nm) or HOLD_TALK.search(c["src"]): report["held_talk"].append([nm, len(c["eps"])]); continue
    if DROPPED.search(nm) or DROPPED.search(c["src"]): report["dropped"].append([nm, len(c["eps"])]); continue
    if not c["eps"]: report["too_few"].append([nm, 0]); continue
    newe = [e for e in c["eps"] if pk(e["p"]) not in have_paths]
    if norm(t) in have_titles or norm(nm) in have_titles:
        ex = title_to_show.get(norm(t)) or title_to_show.get(norm(nm))
        if len(newe) >= 5 and ex: extend.append((ex, newe, nm))      # same show, more episodes than we already list
        else: report["duplicate"].append([nm, f"same title as an existing show ({len(newe)} new episodes)"])
        continue
    if len(newe) < 0.5 * len(c["eps"]): report["duplicate"].append([nm, f"{len(c['eps']) - len(newe)}/{len(c['eps'])} episodes already listed"]); continue
    c["eps"] = newe
    if len(c["eps"]) < 3 and c["pill"] != "Movies" and c.get("group") != "Movies": report["too_few"].append([nm, len(c["eps"])]); continue
    pill = pick_pill(nm, c.get("group"))
    if pill == "Soaps & Drama" and not RX[-1][1].search(re.sub(r"[^a-z0-9]+", " ", nm.lower())) and c.get("group") != "Soap Operas": report["defaulted_to_drama"].append(nm)
    c["pill"] = pill; queue.append(c)
# one show per normalized title (merge same-title candidates from different sources)
merged = collections.OrderedDict()
for c in queue:
    k = norm(c["title"])
    if k in merged:
        seen = {e["p"] for e in merged[k]["eps"]}; merged[k]["eps"] += [e for e in c["eps"] if e["p"] not in seen]
    else: merged[k] = c
queue = list(merged.values())

# ---------- probe first + last ----------
pf = f"{CACHE}/probe-rest.json"; probes = json.load(open(pf)) if os.path.exists(pf) else {}
def sample(eps):
    eps.sort(key=lambda x: (x.get("s", 99), x.get("e", 9999), x["t"])); return [eps[0]["p"]] + ([eps[-1]["p"]] if len(eps) > 1 else [])
ext_c = [dict(title=n, eps=e) for _, e, n in extend]
need = sorted({p for c in queue + ext_c for p in sample(c["eps"]) if p not in probes})
def probe(p):
    if time.time() - T0 > MAXS: return None
    return p, http("https://archive.org" + p, {"Range": "bytes=0-0"})
with ThreadPoolExecutor(6) as ex:
    for r in ex.map(probe, need):
        if r: probes[r[0]] = [r[1], TODAY]
json.dump(probes, open(pf, "w"))
pending = [p for p in need if p not in probes]
if pending:
    print(f"PENDING {len(pending)} probes - run again"); sys.exit(2)

# ---------- write ----------
used = set(have_ids); new_shows = []
for c in queue:
    s = sample(c["eps"]); res = [probes[p] for p in s]; ok = all(r[0] in (200, 206) for r in res)
    if not ok: report["unplayable"].append([c["title"], [r[0] for r in res], len(c["eps"])]); continue
    sid = slug(c["title"]); n = 2
    while sid in used: sid = f"{slug(c['title'])}-{n}"; n += 1
    used.add(sid)
    json.dump(c["eps"], open(f"src/data/showEpisodes/{sid}.json", "w"), separators=(",", ":"))
    tags = list(c["tags"]) + (["TV-MA"] if re.search(r"sopranos|spawn|tom green|perversions|drawn together|death note|supernatural|cobra kai|bates|weeds|ozark", c["title"], re.I) else [])
    new_shows.append({"id": sid, "title": c["title"], "channelId": PILL_CH[c["pill"]], "pill": c["pill"], "tags": tags, "episodes": len(c["eps"]),
                      "hours": None if any(e["d"] == 0 for e in c["eps"]) else round(sum(e["d"] for e in c["eps"]) / 3600, 1), "in24x7": False,
                      "verification": {"ok": True, "date": TODAY, "method": "range-sample-first-last"}})
    report["added"].append([c["title"], c["pill"], len(c["eps"]), c["src"]])
for (ex, newe, nm), c in zip(extend, ext_c):
    res = [probes[p] for p in sample(c["eps"])]
    if not all(r[0] in (200, 206) for r in res): report["unplayable"].append([nm + " (extra episodes)", [r[0] for r in res], len(newe)]); continue
    allx = existing_eps[ex["id"]] + newe; allx.sort(key=lambda x: (x.get("s", 99), x.get("e", 9999), x["t"]))
    json.dump(allx, open(f"src/data/showEpisodes/{ex['id']}.json", "w"), separators=(",", ":"))
    ex["episodes"] = len(allx); ex["hours"] = None if any(e["d"] == 0 for e in allx) else round(sum(e["d"] for e in allx) / 3600, 1)
    report["extended"].append([ex["title"], f"+{len(newe)} episodes -> {len(allx)}"])
chs = {c["id"]: c for c in doc["channels"]}
for pill, cid in PILL_CH.items():
    if not any(s["pill"] == pill for s in new_shows) : continue
    if cid not in chs:
        names = {"ch501": ("Ch 501", "Music TV"), "ch401": ("Ch 401", "Late Night & Talk")}; l, n = names.get(cid, (cid, cid)); chs[cid] = {"id": cid, "label": l, "name": n, "pills": []}; doc["channels"].append(chs[cid])
    if pill not in chs[cid]["pills"]: chs[cid]["pills"].append(pill)
doc["shows"] = sorted(doc["shows"] + new_shows, key=lambda s: (s["channelId"], s["pill"], s["title"].lower()))
doc["generated"] = TODAY
json.dump(doc, open("src/data/showDrawers.json", "w"), indent=1)
os.makedirs("reports/show-drawers", exist_ok=True); json.dump(report, open("reports/show-drawers/rest-report.json", "w"), indent=1)
print("added", len(new_shows), "total shows", len(doc["shows"]), "total episodes", sum(s["episodes"] for s in doc["shows"]))
for k in ("held_talk", "dropped", "duplicate", "too_few", "unplayable", "defaulted_to_drama"): print(k, len(report[k]))
