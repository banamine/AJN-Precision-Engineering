#!/usr/bin/env python3
"""Build the Shows (drawers) data from Archive.org metadata.  Run from the repo root:
    python tools/build-show-drawers.py [--max-seconds 150]
Resumable: metadata and probe results are cached in tools/.show-drawers-cache/ (git-ignore it).
Writes src/data/showDrawers.json and src/data/showEpisodes/<showId>.json.
Rules: plain .mp4 is primary (.ia.mp4 only if no plain twin); dark/restricted items are skipped; durations are the
Archive file `length` (no invented values); a show is 'verified' only if its first and last file answered a
Range request with 200/206 on the run date. Shows with no playable file are listed in the report, not shown.
"""
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error, datetime

CACHE = "tools/.show-drawers-cache"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AJN-drawers"}
T0 = time.time()
MAXS = float(sys.argv[sys.argv.index("--max-seconds") + 1]) if "--max-seconds" in sys.argv else 150.0

CHANNELS = [
  ("ch101", "Ch 101", "TV Classics", ["Sitcoms & Comedy", "Crime & Spy", "Westerns", "Sci-Fi", "Soaps & Drama"]),
  ("ch102", "Ch 102", "British", ["British"]),
  ("ch103", "Ch 103", "Cartoons", ["Cartoons"]),
  ("ch201", "Ch 201", "Movies", ["Movies"]),
  ("ch301", "Ch 301", "Documentary", ["Documentary"]),
  ("ch302", "Ch 302", "Science", ["Science"]),
  ("ch401", "Ch 401", "Late Night & Talk", ["Late Night & Talk"]),
  ("ch601", "Ch 601", "Reality", ["Reality"]),
]
PILL_CH = {p: c[0] for c in CHANNELS for p in c[3]}
SHOWS = []
def S(pill, title, items, rx=None, tags=(), in24=False):
    SHOWS.append(dict(pill=pill, title=title, items=[items] if isinstance(items, str) else list(items), rx=rx, tags=list(tags), in24=in24))

TVW = "01-tv-westerns-part-2-classical-western-theme-music-by-ennio-morricone-sergio-leones-boyhood-friend"
# ---- Westerns (same item/regex rules as tools/build-westerns-catalog.py)
S("Westerns", "Wagon Train", "wagon-train-s-01-e-101-ep-101-the-willy-moran-story", in24=True)
S("Westerns", "Tales of Wells Fargo", "tales-of-wells-fargo-s-06-e-30-royal-maroon", in24=True)
S("Westerns", "Rawhide", "rawhide-3-x-30-incident-of-the-wager-on-payday", r"rawhide", in24=True)
S("Westerns", "Wanted Dead or Alive", "wanted-dead-or-alive-s-01-e-01-ep-1-the-martin-poster", in24=True)
S("Westerns", "Branded", "branded-s-02-e-22-barbed-wire_202405", in24=True)
S("Westerns", "Bat Masterson", "bat-masterson-s-02-e-07-dead-men-dont-pay-debts", in24=True)
S("Westerns", "The Wild Wild West", "01-tv-fighting-crime", r"wild.?wild.?west", in24=True)
S("Westerns", "The Virginian", TVW, r"virginian", in24=True)
S("Westerns", "Have Gun Will Travel", TVW, r"have.?gun", in24=True)
S("Westerns", "The Texan", TVW, r"(^|/)the.?texan")
S("Westerns", "Sky King", "sky-king-1952-1959-complete-series")
S("Westerns", "Adventures of Superman", "the-adventures-of-superman-1951-1958-complete-series")
# ---- Crime & Spy
for t, i in [("Mission Impossible", "mission-impossible-1966-1973-complete-series_202609"), ("The Rockford Files", "the-rockford-files-1974-1980-complete-series"),
  ("Miami Vice", "miami-vice-1984-1990-complete-series"), ("The Fall Guy", "the-fall-guy-1981-1986"), ("In the Heat of the Night", "in-the-heat-of-the-night-1988-1985-complete-series"),
  ("77 Sunset Strip", "77-sunset-strip-1958-1964-complete-series"), ("Surfside 6", "surfside-6-1960-1962-complete-series"), ("Highway Patrol", "highway-patrol-1955-complete-series"),
  ("La Femme Nikita", "la-femme-nikita-1997-complete-series"), ("Silk Stalkings", "silk-stalkings-1991-1999-complete-series"), ("Route 66", "route-66-1960-1964-complete-series"),
  ("666 Park Avenue", "666-park-avenue-1.1"), ("Stalker", "stalker-1.01"), ("Mysterious Ways", "mysterious-ways-2.07"), ("Moon Over Miami", "moon-over-miami-1993"),
  ("Point Pleasant", "point-pleasant-1.01"), ("Peaceable Kingdom", "peacable-kingdom-1.3"), ("Cane", "cane-1.1"), ("Arrest and Trial", "ArrestAndTrial1963"),
  ("Department S", "department-s-complete-series-1970"), ("Dirk Gently", "dirk-gently-complete-series-2010"), ("Moonlighting", "moonlighting-season-1-e-01"), ("Ellery Queen", "ElleryQueenSeries")]:
    S("Crime & Spy", t, i)
S("Crime & Spy", "The Avengers", ["the-avengers-s01-e15-the-frighteners-1961", "the-avengers-s01-e06-girl-on-a-trapeze-1961", "the-avengers-s01-e01-hot-snow-act-1", "the-avengers-s02-s06-1962-1969"])
S("Crime & Spy", "Riptide", ["riptide-s1", "riptide-s2", "riptide-s3"])
S("Crime & Spy", "Hart to Hart", ["hart-to-hart-s01", "hart-to-hart-s02", "hart-to-hart-s04"])
S("Crime & Spy", "Cagney & Lacey", ["cagney-lacey-s-01", "cagney-and-lacey-season-2", "cagney-lacey-s-03", "cagney-lacey-s-04"])
# ---- Sitcoms
for t, i in [("Parker Lewis Can't Lose", "parker-lewis-cant-lose-1990-and-ferris-bueller-the-tv-series"), ("Do Over", "being-erica--do-over"), ("The Trouble with Normal", "the-trouble-with-normal-2000"),
  ("Less Than Perfect", "less-than-perfect-2002-06-sitcom"), ("Freddie", "freddie-2005-06"), ("Love, Inc.", "love-inc.-2005"), ("Getting Personal", "getting-personal-1998-sitcom"),
  ("Some of My Best Friends", "some-of-my-best-friends-1.1"), ("Damon", "damon-1.03"), ("Dweebs", "dweebs1995cbs"), ("A.U.S.A.", "a.u.s.a.-2003"), ("Sibs", "sibs-1991"),
  ("Maggie Winters", "maggie-winters"), ("For Your Love", "vts-01-1_20220924"), ("The Brian Benben Show", "the-brian-benben-show-1.2"), ("Ned and Stacey", "Ned_and_Stacey"),
  ("Day by Day", "Day_by_Day_1988"), ("Veronica's Closet", "veronicascloset"), ("Still Standing", "stillstanding2002"), ("The Jeff Foxworthy Show", "JeffFoxworthyShow"),
  ("Big Day", "Big_Day_2006"), ("Indebted", "indebted2020"), ("Carter Country", "CarterCountry"), ("F Troop", "f-troop-1965-complete-series"),
  ("The Super Dave Osborne Show", "the-super-dave-osborne-show-1987-1991-complete-series"), ("Sanford and Son", "sanford-and-son-s1"), ("Malcolm in the Middle", "malcolm-in-the-middle-s1"),
  ("Archie Bunker's Place", "archie-bunkers-place-s1"), ("The Jeffersons", "the-jeffersons-s1")]:
    S("Sitcoms & Comedy", t, i)
S("Sitcoms & Comedy", "All in the Family", ["all-in-the-family-s1", "all-in-the-family-s2", "all-in-the-family-s3", "all-in-the-family-s4"])
S("Sitcoms & Comedy", "Home Improvement", ["home-improvement-s1_202606", "home-improvement-s2", "home-improvement-s6"])
# ---- Drama (moved here from the Western playlist, where they were misfiled)
S("Soaps & Drama", "Naked City", "naked-city-s-01-e-01-meridian")
S("Soaps & Drama", "Man with a Camera", "man-with-a-camera-s-01-e-04-turntable")
S("Soaps & Drama", "Johnny Staccato", "johnny-staccato.-s-01-e-26.-a-nice-little-town")
S("Soaps & Drama", "The Twilight Zone", "04-twilight-zone-s-01-e-04-16-millimeter-shrine")
# ---- Sci-Fi
for t, i in [("Knight Rider", "knight-rider-1982-1986-complete-series_202609"), ("Sapphire and Steel", "sapphire-and-steel-complete-series-1979"), ("K-9", "k-9-complete-tv-series-2010"),
  ("K-9 and Company", "k-9-and-company-1981"), ("Hex", "Hex2004"), ("Eastwick", "eastwick"), ("The New Addams Family", "newaddamsfamily"),
  ("The Worst Witch + Weirdsister College", "worst_witch_weirdsister_college"), ("Young Indiana Jones", "The_Adventures_of_Young_Indiana_Jones_Episode17")]:
    S("Sci-Fi", t, i)
S("Sci-Fi", "Superboy", ["superboy-s1", "superboy-s2", "superboy-s3", "superboy-s4"])
# ---- Soaps & Drama (modern adult dramas carry a TV-MA tag)
for t, i in [("Knots Landing", "knots-landing-1979-1993"), ("Falcon Crest", "falcon-crest-1981-1990-complete-series"), ("Rich Man, Poor Man Book 2", "rich-man-poor-man-book-2-1976-complete"),
  ("L.A. Law", "la-law-1986-1994-complete-series"), ("Picket Fences", "picket-fences-1992-complete-series"), ("Hart of Dixie", "hart-of-dixie-2011-2015-complete-series"),
  ("Popular", "popular-1999-2001"), ("Edgemont", "edgemont-2000-05"), ("Life as We Know It", "life-as-we-know-it-2004"), ("Palmetto Pointe", "palmetto-pointe-2005"),
  ("Sweet Valley High", "sweet-valley-high"), ("Greetings from Tucson", "greetings-from-tucson-1.02"), ("Life Unexpected", "life-unexpected-2010"), ("Men in Trees", "men-in-trees"),
  ("Ed", "ed-2.20"), ("Hotel", "hotel_202312"), ("Brotherhood of Poland, New Hampshire", "brotherhood-of-poland-new-hampshire-2003")]:
    S("Soaps & Drama", t, i)
for t, i in [("House of Cards", "house-of-cards-2013-2018-complete-series"), ("Ozark", "ozark-20172022-complete-series"), ("Queen of the South", "queen-of-the-south-2016-complete-series"),
  ("Wentworth", "wentworth-2013-2021-complete-series"), ("Suits", "suits-2011-2019-complete-series"), ("Damages", "damages-2007-2012-complete-series"),
  ("Bates Motel", "bates-motel-2013-2017-complete-series"), ("Weeds", "weeds-2005-2012-complete-series"), ("Nurse Jackie", "nurse-jackie-2009-complete-series")]:
    S("Soaps & Drama", t, i, tags=["TV-MA"])
# ---- British
for t, i in [("Fawlty Towers", "the-complete-fawlty-towers"), ("The Thin Blue Line", "the-complete-thin-blue-line"), ("On the Buses", "on-the-buses-the-ultimate-collection"),
  ("WKUK", "wkuk-the-complete-series"), ("First of the Summer Wine", "s-01-e-00-pilot"), ("Agatha Christie Hour", "achx3")]:
    S("British", t, i)
# ---- Cartoons
for t, i in [("Galaxy Rangers", "adventures-of-the-galaxy-rangers-complete-series-1986"), ("Defenders of the Earth", "defenders-of-the-earth-complete-series-1986"), ("Dragon's Lair", "dragons-lair-complete-series-1984"),
  ("Lazer Tag Academy", "lazer-tag-academy-complete-series-1986"), ("Sectaurs", "sectaurs-s-01-e-05-battle-of-the-hyve"), ("The Fonz and the Happy Days Gang", "the-fonz-and-the-happy-days-gang-complete-series-1980"),
  ("The Neverending Story", "the-neverending-story-tas-complete-series-1995"), ("Monchhichis", "monchhichis-complete-series-1983"), ("Doctor Dolittle", "doctor-dolittle-complete-series-1970"),
  ("Tom Terrific", "Tom_Terrific"), ("Amby & Dexter", "Amby_and_Dexter"), ("Earthworm Jim", "earthworm-jim-complete-series"), ("Street Fighter II V", "street-fighter-ii-v-the-collection"),
  ("You're Under Arrest: The Movie", "youre-under-arrest-the-motion-picture"), ("The Junkman", "the-junkman"), ("Hyper Street Racing", "hyper-street-racing-type-b"),
  ("Transformers: The Movie", "the-transforrmers-the-movie-special-collectors-edition")]:
    S("Cartoons", t, i)
S("Cartoons", "Conan the Adventurer", ["conan-the-adventurer-complete-series-1992", "conan-the-adventurer-complete-series-1997", "conan-and-the-young-warriors-1994"])
S("Cartoons", "The Original Transformers", ["the-original-transformers", "the-original-transformers-season-2-part-1", "the-original-transformers-season-2-part-2", "the-original-transformers-season-3-part-1", "the-original-transformers-season-3-part-2-season-4"])
S("Cartoons", "Jacob Two-Two", ["jacob-two-two-vs-the-hooded-fang", "jacob-two-two-and-the-book-of-magic"])
S("Cartoons", "The Brave Little Toaster", ["brave-little-toaster-goes-to-mars", "the-brave-little-toaster-to-the-rescue"])
S("Sitcoms & Comedy", "Beavis and Butt-Head", "beavis-butt-head-most-wanted", tags=["TV-MA"])
S("Cartoons", "Drawn Together", "drawn-together-the-complete-series", tags=["TV-MA"])
# ---- Movies (one single-film item each)
for t, i in [("The Last Starfighter", "the-last-starfighter-1984_202601"), ("The Adventures of Buckaroo Banzai", "the-adventures-of-buckaroo-banzai-1984"), ("Beastmaster Trilogy", "beastmaster-trilogy-1982-1996"),
  ("The Land That Time Forgot", "the-land-that-time-forgot-duology-1974-1977"), ("Allan Quatermain Films", "alan-quatermain-films-1985-1986"), ("Doc Savage: The Man of Bronze", "doc-savage-the-man-of-bronze-1975_202511"),
  ("Remo Williams", "remo-williams-the-adventure-begins-1985_202512"), ("Dreamscape", "dreamscape-1984_202601"), ("The Last Dragon", "the-last-dragon-1985_20251229"), ("Runaway", "runaway-1984_202512"),
  ("Timeline", "timeline-2003"), ("Jake Speed", "jake-speed-1986"), ("The Last Chase", "the-last-chase-1981_202512"), ("Gymkata", "gymkata-1985_202512"),
  ("Josh Kirby: Time Warrior", "josh-kirby-time-warrior-complete-movie-collection-1995"), ("Warriors of Virtue", "warriors-of-virtue-1997-2002"), ("Warlords of Atlantis", "warlords-of-the-deep-1978"),
  ("Mistress of Atlantis", "mistress-of-atlantis-1932_202511"), ("Lost Horizon", "lost-horizon-1937-1973"), ("Five Weeks in a Balloon", "five-weeks-in-a-balloon-1962"), ("The Humanoid", "the-humanoid-1979"),
  ("Baby: Secret of the Lost Legend", "baby-secret-of-the-lost-legend-1985"), ("Circle of Iron", "the-silent-flute-1978"), ("Anonymous Rex", "anonymous-rex-2004"),
  ("The Return of Sherlock Holmes", "the-return-of-sherlock-holmes-1987_202601"), ("Young Sherlock Holmes", "young-sherlock-holmes-1985_202512"), ("Sherlock Holmes Returns", "1994-baker-street-sherlock-holmes-returns-1993"),
  ("The Assassination Bureau", "the-assassination-bureau-1969_202601"), ("I Spy Returns", "i-spy-returns-1994"), ("Hands of a Murderer", "hands-of-a-murderer-1990"), ("Biggles: Adventures in Time", "biggles-adventures-in-time-1986"),
  ("A Low Down Dirty Shame", "a-low-down-dirty-shame-1994"), ("House Film Series", "house-film-series-1985-1992"), ("Fu Manchu Films", "fu-manchu-movies-1965-to-1969"), ("The Fiendish Plot of Dr. Fu Manchu", "the-fiendish-plot-of-dr-fu-manchu-1980"),
  ("Captain Kronos: Vampire Hunter", "captain-kronos-vampire-hunter-1974_202511"), ("Countess Dracula", "countess-dracula-1971_202511"), ("Night of the Blood Beast", "night-of-the-blood-beast-1958_202511"),
  ("Dead Heat", "dead-heat-1988_202511"), ("Bridge Across Time", "bridge-across-time-1985"), ("The Final Programme", "the-final-programme-1973_202512"), ("SHE: Security Hazards Expert", "she-security-hazards-expert-1980"),
  ("Royal Flash", "royal-flash-1975_202601"), ("Angel on My Shoulder", "angel-on-my-shoulder-1980")]:
    S("Movies", t, i)
# ---- Documentary
S("Documentary", "In Search Of", "in-search-of-s-00-e-03-the-outer-space-connection-1975")
S("Documentary", "Unsolved Mysteries", ["unsolved-mysteries-ufos", "unsolved-mysteries-ghosts", "unsolved-mysteries-bizarre-murders"])
S("Documentary", "Wildlife on One", ["wildlife-on-one-s23e-05-thunderbirds-1996-x264", "wildlife-on-one-s23e09-gannets-the-storm-birds-1996-x264", "wildlife-on-one-s18e06-enter-the-dragons-1991-x264-vhsrf",
  "wildlife-on-one-s01e02-behind.the-jaws-1977-x264", "wildlife-on-one-s22e05-sea-otters-the-clam-busters-1995-x264-vhsrf", "wildlife-on-one-s17e01-blubber-lovers-1989-x264-vhsrf",
  "wildlife-on-one-s11e05-a-touch-of-the-butterflies-1983-x264", "wildlife-on-one-s02e03-garden-jungle-1977-x264", "wildlife-on-one-s22e03-night-of-the-leopard-1995-x264-vhsrf",
  "wildlife-on-one-s07e02-wild-otter-1981-x264", "wildlife-on-one-s11e03-kuiseb-the-vanishing-river-1983-x264", "wildlife-on-one-s22e08-nightgliders-1995-vhsrf",
  "wildlife.on-one-s22e06-rainbow-warriors-1995-vhsrf", "wildlife-on-one-s27e04-ospreys-the-fish-hawks-1999-x264"])
S("Documentary", "Nature (PBS)", ["nature-s03e14-kitum-the-elephant-cave-1985-x264-vhsrf", "nature-s18e07-humpback-whales-2000-x264-VHSrf", "nature-s16e16-the-wild-side-of-new-york-1998-x264-vhs"])
S("Documentary", "David Attenborough's World of Wildlife", ["david-attenboroughs-world-of-wildlife-dragons-and-chameleons-1996-VHSrf", "david-attenboroughs-world-of-wildlife-underwater-wonderlands-1995-vhsrf"])
S("Documentary", "Frontline", ["frontline-s20e08-the-monster-that-ate-hollywood-2001-x264-vhs", "frontline-s20e010-inside-the-terror-network-2002-x264-vhs"])
for t, i in [("Ocean World Musical", "ocean-world-musical-1991-x264"), ("The Dinosaurs!", "the-dinosaurs-1992.x264-LDrf"), ("Kingdom of the Ice Bear", "kingdom-of-the-ice-bear-bbcv4081-1986-x264-vhsrf"),
  ("HMS Pandora: In Pursuit of the Bounty", "hms-pandora-in-pursuit-of-the-bounty-1984-x264-vhs"), ("The World About Us: The Last Great Race on Earth", "the-world-about-us-s07e06-the-last-great-race-on-earth-1979-x264"),
  ("Satoyama III: Japan's Secret Forest", "satoyama-iii-japans-secret-forest-special-edition-2008-BD-x264")]:
    S("Documentary", t, i)
# ---- Science
S("Science", "NOVA", ["nova-s26e16-electric-heart-1999-x264-vhsrf", "nova-s10e10-signs.of.the-apes-songs-of-the-whales-1983-x264-ldrf_202602", "nova-s24e16-wild-wolves-with-david-attenborough-1997-vhsrf", "nova-s12e07-the-shape-of-things-1985-x264-ldrf"])
S("Science", "Madness (BBC, 1991)", "madness-bbc-1991.x264.vhsrf")
S("Science", "Y2K: Invasion of the Millennium Bug", "y2k-invasion.of.the-millennium-bug-1998")
# ---- Late Night & Talk
S("Late Night & Talk", "The Tonight Show", "the-tonight-show-starring-johnny-carson")
S("Late Night & Talk", "The Phil Donahue Show", ["phil-donahue-show", "the-phil-donahue-show-1976-1992"])
# ---- Reality
for t, i in [("Lizard Lick Towing", "lizard-lick-towing-2011-complete-series"), ("South Beach Tow", "south-beach-tow-2011"), ("Hardcore Pawn: Chicago", "hardcore-pawn-chicago-2013-complete-series")]:
    S("Reality", t, i)
S("Sitcoms & Comedy", "Trailer Park Boys", "trailer-park-boys-s8")
S("Reality", "The Osbournes", ["the-osbournes-s2_202608", "the-osbournes-2.5"])
S("Reality", "Kenny vs. Spenny", ["kenny-vs-spenny-s5", "kenny-vs-spenny-s6"])

def http(url, headers=None, method="GET"):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=dict(UA, **(headers or {})), method=method), timeout=60)
        return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception as e: return "ERR:" + type(e).__name__, b""

def out_of_time(): return time.time() - T0 > MAXS
def jload(p, d):
    return json.load(open(p)) if os.path.exists(p) else d

def item_meta(item):
    p = f"{CACHE}/meta/{hashlib.sha1(item.encode()).hexdigest()[:16]}.json"
    if os.path.exists(p): return json.load(open(p))
    if out_of_time(): return None
    time.sleep(0.8)
    s, b = http("https://archive.org/metadata/" + urllib.parse.quote(item))
    if s != 200: return {"item": item, "status": s, "files": []}
    d = json.loads(b or b"{}")
    r = {"item": item, "status": 200, "dark": bool(d.get("is_dark")), "restricted": d.get("metadata", {}).get("access-restricted-item") == "true",
         "files": [[f["name"], f.get("length", "")] for f in d.get("files", []) if f["name"].lower().endswith(".mp4")]}
    os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(r, open(p, "w"))
    return r

def season_ep(name):
    for pat in (r"[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})", r"[Ss]-?(\d{1,2})[ ._-]*EP?[ ._-]*(\d{1,3})", r"(\d{1,2})x(\d{1,3})"):
        m = re.search(pat, name)
        if m: return int(m.group(1)), int(m.group(2))
    return None, None
def clean(name):
    t = os.path.splitext(os.path.basename(name))[0]; t = re.sub(r"\.ia$", "", t)
    return re.sub(r"\s+", " ", re.sub(r"[_.]+", " ", t)).strip()
def slug(t): return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")

def episodes_for(show):
    eps, seen, notes = [], set(), []
    for item in show["items"]:
        m = item_meta(item)
        if m is None: return None, ["pending"]
        if m["status"] != 200: notes.append(f"{item}: metadata {m['status']}"); continue
        if m.get("dark") or m.get("restricted"): notes.append(f"{item}: dark/restricted"); continue
        names = {n for n, _ in m["files"]}
        for name, length in sorted(m["files"]):
            if show["rx"] and not re.search(show["rx"], name, re.I): continue
            if re.search(r"[ ._-](trailer|sample)(\.mp4)?$", name, re.I): continue
            if name.lower().endswith(".ia.mp4") and name[:-7] + ".mp4" in names: continue
            try: d = float(length)
            except (TypeError, ValueError): d = 0
            if length not in ("", None) and d < 120: continue   # a real but tiny file; unknown length ("") is kept with d=0
            s, e = season_ep(name)
            key = ("se", s, e) if s is not None and len(show["items"]) == 1 else ("f", clean(name).lower())
            if key in seen: continue
            seen.add(key)
            eps.append({"t": clean(name), "p": "/download/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(name), "d": int(round(d)),
                        **({"s": s, "e": e} if s is not None else {})})
    eps.sort(key=lambda x: (x.get("s", 99), x.get("e", 9999), x["t"]))
    return eps, notes

def main():
    probes = jload(f"{CACHE}/probe.json", {})
    today = datetime.date.today().isoformat()
    shows_out, report = [], {"empty": [], "unverified": [], "pending": []}
    os.makedirs("src/data/showEpisodes", exist_ok=True)
    seen_ids = set()
    for sh in SHOWS:
        eps, notes = episodes_for(sh)
        if eps is None: report["pending"].append(sh["title"]); continue
        if not eps: report["empty"].append([sh["title"], notes]); continue
        sid = slug(sh["title"]); assert sid not in seen_ids, sid; seen_ids.add(sid)
        sample = [eps[0]["p"], eps[-1]["p"]] if len(eps) > 1 else [eps[0]["p"]]
        for p in sample:
            if p not in probes and not out_of_time():
                time.sleep(0.4); st, _ = http("https://archive.org" + p, {"Range": "bytes=0-0"}); probes[p] = [st, today]
                json.dump(probes, open(f"{CACHE}/probe.json", "w"))
        res = [probes.get(p) for p in sample]
        if any(r is None for r in res): report["pending"].append(sh["title"]); continue
        ok = all(r[0] in (200, 206) for r in res)
        if not ok: report["unverified"].append([sh["title"], [r[0] for r in res]])
        json.dump(eps, open(f"src/data/showEpisodes/{sid}.json", "w"), separators=(",", ":"))
        shows_out.append({"id": sid, "title": sh["title"], "channelId": PILL_CH[sh["pill"]], "pill": sh["pill"], "tags": sh["tags"],
                          "episodes": len(eps), "hours": None if any(e["d"] == 0 for e in eps) else round(sum(e["d"] for e in eps) / 3600, 1), "in24x7": sh["in24"],
                          "verification": {"ok": ok, "date": res[0][1], "method": "range-sample-first-last"}})
    if report["pending"]:
        print("PENDING (run again):", len(report["pending"])); json.dump(report, open(f"{CACHE}/report.json", "w"), indent=1); return
    doc = {"schema": 1, "generated": today, "channels": [{"id": c, "label": l, "name": n, "pills": p} for c, l, n, p in CHANNELS], "shows": shows_out}
    json.dump(doc, open("src/data/showDrawers.json", "w"), indent=1)
    os.makedirs("reports/show-drawers", exist_ok=True)
    json.dump(report, open("reports/show-drawers/build-report.json", "w"), indent=1)
    print("shows", len(shows_out), "episodes", sum(s["episodes"] for s in shows_out), "empty", len(report["empty"]), "unverified", len(report["unverified"]))
    for e in report["empty"]: print("EMPTY", e)
    for e in report["unverified"]: print("UNVERIFIED", e)

if __name__ == "__main__": main()
