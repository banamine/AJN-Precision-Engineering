#!/usr/bin/env python3
"""Build src/data/organizerShowsManifest.json from the Archive folders
   https://archive.org/download/daily-highlights/M3U%20Organizer%20Output/{Classic TV,TV,Movies,Mixed,Music}/

Only 'Classic TV' and 'TV' feed the Classic TV guide (user decision 2026-10-08). Movies / Mixed / Music are
classified into a report only (reports/organizer-routing.json); they are NOT wired into any guide here.

Usage:
  python tools/build-organizer-manifest.py --cache DIR --existing classic-tv.json [--fetch]
    DIR/playlists/<folder>/<file>.m3u   (downloaded with --fetch when missing)
    DIR/meta/<md5(identifier)[:16]>.json (https://archive.org/metadata/<id>, fetched when missing)
    classic-tv.json = output of GET /api/schedule?guide=classic-tv  (what the guide shows today; used to avoid duplicates)

Rules (each is enforced here, not hoped for):
  * entry must be a media file that exists in the item's own file list, item not dark, file not private
  * prefer the item's `.ia.mp4`; else the original .mp4/.m4v/.webm; else an Archive-made .mp4 derivative; else drop (reported)
  * real duration from item metadata (`length`); entries without one are dropped, never guessed
  * one show = one channel: playlists are mapped to an EXISTING channel id, a dormant series-channel id, or a new `org-*` id
  * an episode already in ANY classic-tv channel is not added again (full path, playable path, file name, or S/E code in the same channel)
  * an episode currently sitting in the catch-all `item-unsorted` channel is PROMOTED (removed from Unsorted, shown in its show channel)
"""
import argparse, hashlib, json, os, re, sys, urllib.parse, urllib.request
from collections import Counter, defaultdict

BASE = "https://archive.org/download/daily-highlights/M3U%20Organizer%20Output/"
FOLDERS = ["Classic TV", "TV", "Movies", "Mixed", "Music"]
CLASSIC_FOLDERS = ["Classic TV", "TV"]            # priority order: first folder wins on duplicates
MEDIA_EXT = {"mp4", "m4v", "webm", "mkv", "avi", "mov", "flv", "mpg", "mpeg", "ogv", "wmv", "ts", "m3u8",
             "mp3", "m4a", "opus", "ogg", "flac", "wav", "aac", "wma"}
VIDEO_EXT = {"mp4", "m4v", "webm", "mkv", "avi", "mov", "flv", "mpg", "mpeg", "ogv", "wmv", "ts", "m3u8"}
BROWSER_EXT = {"mp4", "m4v", "webm"}
AUDIO_OK = {"mp3", "m4a", "opus", "ogg", "aac"}
MIN_NEW_CHANNEL_EPISODES = 3                      # stubs with fewer playable episodes never become a channel

# --------------------------------------------------------------------------------------------------------------
# ROUTES: playlist file stem -> disposition.  (same stem in 'Classic TV' and 'TV' = same show)
#   ("existing", channelId)            append only missing episodes to a channel that is already on the guide
#   ("series", channelId, name)        show already has a series-channel id (collections/series-config*); reuse that id
#   ("new", slug, name)                new channel  id = org-<slug>
#   ("split", {item-id: route, ...})   one playlist that mixes shows: route per Archive item
#   ("other", contract, note)          belongs in another guide (movies / audio-podcasts / news / music): not added here
#   ("skip", reason)
# --------------------------------------------------------------------------------------------------------------
ARCHIE = ("series", "classic-series-l4-archie-bunkers-place-complete-series", "Archie Bunker's Place")
S227, BENSON, BETTE = ("new", "227", "227"), ("new", "benson", "Benson"), ("new", "bette", "Bette")
ROUTES = {
    "70 Odd Couple": ("existing", "classic-70-odd-couple"),
    "90s movies": ("other", "movies", "movie"),
    "Adderly": ("new", "adderly", "Adderly"),
    "Andy G season 3": ("skip", "all items removed from Archive"),
    "Andy Griffith": ("existing", "item-the-andy-griffith-show"),
    "Archie Bunkers Place": ARCHIE,
    "Barney Miller": ("skip", "stub (<3 playable episodes)"),
    "Battlestar Gallitaca": ("skip", "all items removed from Archive"),
    "Benson,227,Archie,Bette": ("split", {
        "archie-bunkers-place-complete-series": ARCHIE, "227-complete_tv_series_ctv": S227,
        "benson-complete-tv-series-ctv": BENSON, "bette_tvseries_ctv": BETTE}),
    "Benson": BENSON,
    "Best video shorts music": ("other", "music", "music videos"),
    "Bette": BETTE,
    "Blacksheep": ("existing", "item-black-sheep-squadron"),
    "Bogart Movies": ("other", "movies", "movie"),
    "CWD": ("existing", "item-canada-s-worst-driver"),
    "Canadas Worst Drivers": ("existing", "item-canada-s-worst-driver"),
    "Carrol Burnett": ("new", "carol-burnett-show", "The Carol Burnett Show"),
    "Catch A Killer": ("existing", "item-forensics-catching-the-killer"),
    "Cheers": ("existing", "item-cheers"),
    "Classic Docs": ("new", "classic-documentaries", "Classic Documentaries"),
    "Clint walker": ("skip", "all items removed from Archive"),
    "Corner Gas1-2": ("existing", "item-corner-gas"),
    "Cowerdly Dog": ("new", "courage-the-cowardly-dog", "Courage the Cowardly Dog"),
    "Croc Hunter": ("new", "crocodile-hunter-diaries", "The Crocodile Hunter Diaries"),
    "Danger man": ("new", "danger-man", "Danger Man"),
    "Dick van dyke 1-5": ("new", "dick-van-dyke-show", "The Dick Van Dyke Show"),
    "Discover History": ("existing", "item-doc-documentaries-misc"),
    "Dog Day Afternoon": ("other", "movies", "movie"),
    "Doomwatch 70": ("skip", "all items removed from Archive"),
    "Dr Hudson Secrets J": ("skip", "all items removed from Archive"),
    "Dr Who": ("skip", "all items removed from Archive"),
    "Dual Survivor 2": ("new", "dual-survival", "Dual Survival"),
    "Dual3": ("new", "dual-survival", "Dual Survival"),
    "Enemies Foreign And Domestic": ("skip", "stub (<3 playable episodes)"),
    "Feb PODCASTS 24": ("other", "audio-podcasts", "audio podcast files"),
    "Fleming": ("new", "fleming", "Fleming: The Man Who Would Be Bond"),
    "Flying Cadet": ("existing", "item-adventures-of-the-flying-cadets"),
    "Good Times": S227,   # file is named Good Times but every entry is item 227-complete_TV_Series_CTV
    "High Incident": ("existing", "item-high-incident"),
    "Hogan Family": ("skip", "stub; different show from Hogan's Heroes (never merge)"),
    "Hogans Heroes 1 2": ("series", "classic-series-hogans-heroes", "Hogan's Heroes"),
    "Home Improvement": ("existing", "item-home-improvement"),
    "How its Made": ("existing", "item-doc-how-it-s-made"),
    "Interpol calling": ("skip", "all items removed from Archive"),
    "Jack and Bobby": ("series", "classic-series-l4-jack-bobby-1x-01-pilot", "Jack & Bobby"),
    "Jack of all Trades": ("new", "jack-of-all-trades", "Jack of All Trades"),
    "Joe Biden": ("skip", "news clip, not a TV show"),
    "Little Cheynne": ("skip", "stub (<3 playable episodes)"),
    "Logans Run": ("skip", "all items removed from Archive"),
    "MAYDAY": ("existing", "classic-mayday"),
    "MIT Computing": ("skip", "3-episode tech how-to series; not classic TV (ask)"),
    "Mantracker": ("existing", "item-doc-mantracker"),
    "Master Catoons": ("skip", "dump list: 1,328 Paul Harvey mp3 + videos already in Unsorted/Docs"),
    "Maud": ("skip", "all items removed from Archive"),
    "Memorial Days1": ("skip", "stub (<3 playable episodes)"),
    "Micheal Jackson Live": ("other", "music", "concert/music video"),
    "Mini Alex Archive": ("existing", "classic-ajn-archive-1"),
    "Mission Impossible": ("skip", "stub (<3 playable episodes)"),
    "More War": ("existing", "item-doc-documentaries-misc"),
    "My Thre Sons": ("new", "my-three-sons", "My Three Sons"),
    "New vet": ("new", "new-breed-vets", "New Breed Vets"),
    "News Radio": ("new", "newsradio", "NewsRadio"),
    "North South": ("existing", "item-north-and-south"),
    "Odd Couple": ("existing", "item-the-odd-couple-2015"),
    "Odysee 5": ("series", "classic-series-l4-odyssey-5-s01e01-e02-ws-dvdrip-xvid-bia", "Odyssey 5"),
    "Petticoat Junction Full": ("existing", "classic-petticoat"),
    "petticoat": ("existing", "classic-petticoat"),
    "Price is Right": ("skip", "E! True Hollywood Story clips, not the show"),
    "Primrose Greengage BW Movies": ("other", "movies", "movie"),
    "Rat Patrol": ("existing", "classic-rat-patrol"),
    "River Monsters": ("existing", "classic-river-monsters"),
    "Rise And Fall Of Rome": ("skip", "all items removed from Archive"),
    "SURGICAL SPIRIT (1989-95)": ("skip", "stub (<3 playable episodes)"),
    "Schitts Creek": ("existing", "item-schitt-s-creek"),
    "Search": ("skip", "stub (<3 playable episodes)"),
    "Smihonian": ("existing", "item-doc-smithsonian"),
    "SpiderMan Series": ("skip", "stub (<3 playable episodes)"),
    "Sports Grand Prix": ("skip", "stub; sports, not classic TV"),
    "Street 2000": ("new", "the-street", "The $treet"),
    "The Angry Beavers": ("existing", "item-the-angry-beavers"),
    "The Fugitive": ("existing", "classic-the-fugitive"),
    "The Girl from U.N.C.L.E": ("new", "girl-from-uncle", "The Girl from U.N.C.L.E."),
    "The Invisable Man": ("skip", "stub (<3 playable episodes)"),
    "The Midnight Run Action Pack": ("other", "movies", "TV movies"),
    "The Protectors": ("existing", "item-the-protectors"),
    "The Secret Life of Machines": ("skip", "stub (<3 playable episodes)"),
    "The Sopranos": ("existing", "classic-the-sopranos"),
    "The Uneverse": ("skip", "stub (<3 playable episodes)"),
    "The Waltons": ("skip", "all items removed from Archive"),
    "TheSimpleLife1998": ("new", "the-simple-life", "The Simple Life (1998)"),
    "Trouble With Larry": ("new", "trouble-with-larry", "The Trouble with Larry"),
    "Tucker Carlson": ("other", "news", "news clips"),
    "Twighlight Zone Color 5": ("new", "twilight-zone-colorized", "The Twilight Zone (Colorized)"),
    "WWar Color": ("new", "world-wars-in-colour", "World Wars in Colour"),
    "Walton Reunions": ("new", "waltons-reunion-movies", "The Waltons Reunion Movies"),
    "Western Movies": ("other", "movies", "movie"),
    "Yancy Derringer": ("new", "yancy-derringer", "Yancy Derringer"),
    "airplane repo": ("skip", "all items removed from Archive"),
    "ancient aliens 20 21": ("new", "ancient-aliens", "Ancient Aliens"),
    "battalion2": ("skip", "dump list: 1,328 Paul Harvey mp3 + videos already in Unsorted/Docs"),
    "bossum buddies": ("skip", "all items removed from Archive"),
    "get Smart": ("new", "get-smart", "Get Smart"),
    "hillbilly elegy": ("other", "movies", "movie"),
    "johhny Carson": ("new", "tonight-show-johnny-carson", "The Tonight Show Starring Johnny Carson"),
    "lillyhammer": ("new", "lilyhammer", "Lilyhammer"),
    "lonnie 1-2": ("skip", "all items removed from Archive"),
    "man from atlantis time machine bottle": ("skip", "all items removed from Archive"),
    "my paul harvey": ("other", "audio-podcasts", "Paul Harvey audio"),
    "news master": ("skip", "all items removed from Archive"),
    "pirate high sea": ("existing", "item-pirates-of-the-high-seas"),
    "robin hood mix": ("skip", "unrelated clips mix"),
    "skinwalkerranch": ("new", "secret-of-skinwalker-ranch", "The Secret of Skinwalker Ranch"),
    "the addams family": ("existing", "item-the-addams-family"),
    "undermind 65": ("existing", "item-undermind"),
    "wagon-somthing out": ("split", {"something-is-out-there-1988_202210": ("new", "something-is-out-there", "Something Is Out There (1988)")}),
}

# --------------------------------------------------------------------------------------------------------------
# MIXED folder (user decision 2026-10-08: de-duplicate and add the missing files).  Same route types, plus
#   ("kw", [(regex, route), ...])   playlist mixes shows: classify each entry by its cleaned title; unmatched entries fall
#                                   back to the show name written before S01E01 / 1x01 / "Season n" (>= 3 episodes -> channel)
# Playlists that ARE an existing classic-* channel (the daily-highlights cap of 60) are topped up to the full list.
# Not added (reported): news/talk dumps, movies, music, audio, empty files, all-dark lists.
# --------------------------------------------------------------------------------------------------------------
BAG = {"org-cousteau-odyssey", "org-americas-funniest-home-videos", "org-cartoon-favs", "org-colorized-classics", "org-vhs-40-year-mixed-shows", "org-history-play-in-order", "org-irish-rte",
       "org-complete-earth-studies", "classic-dave-s-classic-british-tv-movies", "classic-big-western-zone", "classic-info-survior",
       "classic-fact-fake-news", "classic-liberal-hivemind2", "classic-classic-music-video"}   # mixed bags: S/E-code de-dupe is meaningless
NEWS_TALK_IDS = re.compile(r"(alex-jones-show|david-knight-show|prisonplanet|infowars|the-david-knight)", re.I)
NO_NEWS = ("skip", "news / talk dump (not added to Classic TV)")
KW_LIB = [   # shared show aliases for playlists that mix shows
    (r"^(the )?rifleman", ("new", "the-rifleman", "The Rifleman")),
    (r"^wagon train", ("new", "wagon-train", "Wagon Train")),
    (r"^my favorite martian", ("new", "my-favorite-martian", "My Favorite Martian")),
    (r"^(the )?benny hill", ("new", "benny-hill-show", "The Benny Hill Show")),
    (r"^cannon\b", ("new", "cannon", "Cannon")),
    (r"^don rickles", ("new", "don-rickles", "Don Rickles")),
    (r"^(the )?bob newhart", ("new", "bob-newhart-show", "The Bob Newhart Show")),
    (r"^mama.?s (family|\d)", ("new", "mamas-family", "Mama's Family")),
    (r"^in search of", ("new", "in-search-of", "In Search Of...")),
    (r"^(the )?honeymooners", ("skip", "The Honeymooners has its own ordered channel; duplicates only")),
    (r"^(the )?waltons", ("series", "classic-series-l4-bobbywalton", "The Waltons")),
    (r"^(the )?rat patrol", ("existing", "classic-rat-patrol")),
    (r"^mayday", ("existing", "classic-mayday")),
    (r"^dave allen", ("new", "dave-allen-at-large", "Dave Allen at Large")),
    (r"^(the )?alfred hitchcock", ("new", "alfred-hitchcock-hour", "The Alfred Hitchcock Hour")),
    (r"^black ?sheep", ("existing", "item-black-sheep-squadron")),
    (r"^lilyhammer", ("existing", "org-lilyhammer")),
    (r"^(the )?addams family", ("existing", "item-the-addams-family")),
    (r"^i love lucy", ("new", "i-love-lucy", "I Love Lucy")),
    (r"^still standing", ("new", "still-standing", "Still Standing")),
    (r"^the new addams family", ("new", "the-new-addams-family", "The New Addams Family")),
    (r"^(the )?jeff foxworthy", ("new", "jeff-foxworthy-show", "The Jeff Foxworthy Show")),
    (r"^carter country", ("new", "carter-country", "Carter Country")),
    (r"^veronica", ("new", "veronicas-closet", "Veronica's Closet")),
    (r"^bewitched", ("new", "bewitched", "Bewitched")),
    (r"^hotel\b", ("new", "hotel", "Hotel")),
    (r"^ancient aliens", ("existing", "org-ancient-aliens")),
    (r"^mtm\b|^mary tyler moore", ("new", "mary-tyler-moore-show", "The Mary Tyler Moore Show")),
    (r"^adam ?12", ("new", "adam-12", "Adam-12")),
    (r"^route ?66", ("new", "route-66", "Route 66")),
    (r"^(the )?dick van dyke", ("existing", "org-dick-van-dyke-show")),
    (r"^(the )?carol burnett", ("existing", "org-carol-burnett-show")),
]
MIXED_ROUTES = {
    "40 +year": ("new", "vhs-40-year-mixed-shows", "VHS 40+ Year Mixed Shows"),
    "40+": ("new", "vhs-40-year-mixed-shows", "VHS 40+ Year Mixed Shows"),
    "80 movies": ("other", "movies", "TV movies"),
    "9000 infowars": ("skip", "news dump (1,789 clips); not added to Classic TV - ask"),
    "A Team": ("new", "a-team", "The A-Team"),
    "AFHVideos": ("new", "americas-funniest-home-videos", "America's Funniest Home Videos"),
    "merged_playlist": ("new", "americas-funniest-home-videos", "America's Funniest Home Videos"),
    "Academy award winner movies": ("other", "movies", "movie"),
    "Alein 3": ("kw", KW_LIB),
    "Alex 24": ("skip", "news dump (9,831 clips); channel classic-alex-24 keeps its 60 - ask before adding"),
    "BIG WESTERN ZONE": ("existing", "classic-big-western-zone"),
    "BIG WESTERN ZONE_cleaned": ("existing", "classic-big-western-zone"),
    "BIG WESTERN ZONE_cleaned_cleaned": ("existing", "classic-big-western-zone"),
    "BW in Color": ("new", "colorized-classics", "Colorized Classics"),
    "colorizeed movies": ("new", "colorized-classics", "Colorized Classics"),
    "Buck Rogers": ("new", "buck-rogers", "Buck Rogers in the 25th Century"),
    "CanadianFilm Archive": ("other", "movies", "movie"),
    "Cartoon Favs": ("new", "cartoon-favs", "Cartoon Favs"),
    "list1 cartoons radio": ("new", "cartoon-favs", "Cartoon Favs"),
    "Chico and The Man": ("new", "chico-and-the-man", "Chico and the Man"),
    "Classic Music Video": ("other", "music", "music videos"),
    "Complete Earth Studies Series": ("new", "complete-earth-studies", "Complete Earth Studies"),
    "DAVE'S CLASSIC BRITISH TV & MOVIES": ("existing", "classic-dave-s-classic-british-tv-movies"),
    "Due South": ("new", "due-south", "Due South"),
    "History play in order": ("new", "history-play-in-order", "History (Play in Order)"),
    "Info Survior": ("skip", "moved to the Cable TV guide as INFO WARS SURVIVAL (2026-10-08)"),
    "Irish RTE": ("new", "irish-rte", "Irish RTE"),
    "Liberal Hivemind2": ("existing", "classic-liberal-hivemind2"),
    "all big movies": ("other", "movies", "movie"),
    "banamine": ("skip", "5,806-row mixed dump incl. 2,656 audio files; belongs to Audio, not Classic TV"),
    "banamine_cleaned": ("kw", KW_LIB),
    "benny lucy ourgang": ("kw", KW_LIB),
    "knockitoffnow89": ("kw", KW_LIB),
    "bob newhart": ("new", "bob-newhart-show", "The Bob Newhart Show"),
    "cousteau": ("new", "cousteau-odyssey", "The Cousteau Odyssey"),
    "fact-fake-news": ("existing", "classic-fact-fake-news"),
    "green acres 1-2": ("new", "green-acres", "Green Acres"),
    "hogans": ("series", "classic-series-hogans-heroes", "Hogan's Heroes"),
    "lhop": ("series", "classic-series-l4-bobbyprairie", "Little House on the Prairie"),
    "mamas family'": ("new", "mamas-family", "Mama's Family"),
}

# ---------------------------------------------------------------------------------------------- helpers
def md5id(i): return hashlib.md5(i.encode()).hexdigest()[:16]

def http_get(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "ajn-organizer-manifest/1"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest + ".tmp", "wb") as f:
        f.write(r.read())
    os.replace(dest + ".tmp", dest)

def list_folder(folder, cache, fetch):
    cached = os.path.join(cache, "playlists", folder)
    if os.path.isdir(cached):
        return sorted(n for n in os.listdir(cached) if n.lower().endswith((".m3u", ".m3u8")))
    if not fetch:
        sys.exit(f"missing {cached} (pass --fetch)")
    os.makedirs(cached, exist_ok=True)
    html = urllib.request.urlopen(BASE + urllib.parse.quote(folder) + "/", timeout=120).read().decode("utf8", "replace")
    names = [urllib.parse.unquote(h) for h in re.findall(r'<td><a href="([^"]+)"', html)
             if not h.startswith(("?", "/", "http", "../")) and h.lower().endswith((".m3u", ".m3u8"))]
    for n in names:
        http_get(BASE + urllib.parse.quote(folder) + "/" + urllib.parse.quote(n), os.path.join(cached, n))
    return sorted(names)

def parse_playlist(path):
    rows, title = [], None
    for line in open(path, encoding="utf8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#PLAYLIST"):
            continue
        if line.startswith("#EXTINF"):
            m = re.search(r'tvg-name="([^"]*)"', line)
            t = m.group(1).strip() if m else ""
            if not t:
                m = re.search(r'group-title="[^"]*"\s*,(.*)$', line) or re.search(r',([^,]*)$', line)
                t = m.group(1).strip() if m else ""
            title = t
            continue
        if line.startswith("#"):
            continue
        rows.append({"url": line, "title": title or ""})
        title = None
    return rows

def split_ia(url):
    u = url.strip()
    m = re.match(r'^https?://ia\d+\.[a-z]+\.archive\.org/\d+/items/([^/]+)/(.+)$', u, re.I) or \
        re.match(r'^https?://(?:www\.)?archive\.org/download/([^/]+)/(.+)$', u, re.I)
    if not m:
        return None
    return urllib.parse.unquote(m.group(1)), urllib.parse.unquote(m.group(2).split("?")[0])

def bn_key(path):  # file-name key, ignores folders / extension / .ia / punctuation
    s = path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower().replace(".ia", "")
    return re.sub(r'[^a-z0-9]', '', s)

def ep_code(text):
    t = text.lower()
    m = re.search(r's(\d{1,2})\s*[ .\-_]?e(\d{1,3})', t) or re.search(r'\b(\d{1,2})x(\d{2,3})\b', t)
    return f"s{int(m.group(1)):02d}e{int(m.group(2)):03d}" if m else None

def clean_title(row_title, path):
    t = row_title.strip()
    if not t or t.lower().startswith("http") or "group-title" in t:
        t = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    t = t.replace(".ia", "") if t.endswith(".ia") else t
    t = re.sub(r'[_]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def natural(s): return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', s)]

def show_name_from_title(t):
    t = re.sub(r"^\s*[\d.\-_ ]+(?=[A-Za-z])", "", t)
    m = re.match(r"^(.*?)[\s\-\u2013_:(]*(?:\d{4}\)?\s*)?(?:s\d{1,2}\s?[ .\-_]?e\d{1,3}|\d{1,2}x\d{2}|season\s*\d+)", t, re.I)
    name = re.sub(r"\s+", " ", (m.group(1) if m else "")).strip(" -_:(")
    return name if len(name) >= 3 else None

def classify_kw(rules, row_title, rel):
    t = clean_title(row_title, rel)
    key = re.sub(r"^[\d.\-_ ]+(?=[A-Za-z])", "", t).lower()
    for rx, route in rules:
        if re.search(rx, key): return route
    nm = show_name_from_title(t)
    if not nm: return None
    slug = re.sub(r"[^a-z0-9]+", "-", nm.lower()).strip("-")
    return ("new", slug, nm.title()) if slug else None

class Meta:
    def __init__(self, cache, fetch):
        self.cache, self.fetch, self.mem = cache, fetch, {}
    def get(self, ident):
        k = ident.lower()
        if k in self.mem: return self.mem[k]
        f = os.path.join(self.cache, "meta", md5id(ident) + ".json")
        if not os.path.exists(f):
            if not self.fetch: self.mem[k] = None; return None
            os.makedirs(os.path.dirname(f), exist_ok=True)
            http_get("https://archive.org/metadata/" + urllib.parse.quote(ident, safe=""), f)
        d = json.load(open(f))
        if not d or not d.get("files") or d.get("is_dark"):
            self.mem[k] = {"state": "dark", "id": ident}; return self.mem[k]
        files = {}
        for x in d["files"]:
            try: ln = float(x.get("length") or 0)
            except ValueError: ln = 0
            files[x["name"].lower()] = {"name": x["name"], "src": x.get("source", ""), "priv": x.get("private") == "true",
                                       "size": int(x.get("size") or 0), "len": ln}
        self.mem[k] = {"state": "ok", "id": d.get("metadata", {}).get("identifier", ident), "files": files,
                       "thumb": "__ia_thumb.jpg" if "__ia_thumb.jpg" in files else None}
        return self.mem[k]

def resolve(ident, path, meta):
    """-> (status, file-name-as-stored, kind, item). status ok|dark|file_missing|private|needs_transcode|nonmedia|no_duration"""
    ext = path.rsplit(".", 1)[-1].lower() if "." in path.rsplit("/", 1)[-1] else ""
    if ext not in MEDIA_EXT: return "nonmedia", None, None, None
    it = meta.get(ident)
    if not it or it["state"] != "ok": return "dark", None, None, None
    files, f = it["files"], it["files"].get(path.lower())
    if not f: return "file_missing", None, None, it
    if f["priv"]: return "private", None, None, it
    stem, kind = path.rsplit(".", 1)[0].lower(), ("video" if ext in VIDEO_EXT else "audio")
    pick = None
    if kind == "video":
        ia = files.get(stem + ".ia.mp4")
        if ia and not ia["priv"]: pick = ia
        elif ext in BROWSER_EXT: pick = f
        else:
            d = files.get(stem + ".mp4")
            if d and not d["priv"] and d["src"] == "derivative": pick = d
    else:
        if ext in AUDIO_OK: pick = f
        else:
            d = files.get(stem + ".mp3")
            if d and d["src"] == "derivative": pick = d
    if not pick: return "needs_transcode", None, kind, it
    if pick["len"] <= 0 and f["len"] > 0: pick = dict(pick, len=f["len"])
    if pick["len"] < 30 or pick["size"] < 100000: return "no_duration", None, kind, it   # placeholder stubs (e.g. 2.4 KB files) are not episodes
    return "ok", pick, kind, it

def existing_index(path):
    d = json.load(open(path))
    chans = d["channels"] if isinstance(d, dict) else d
    keys, codes, by_chan = {}, defaultdict(set), {}
    unsorted = set()
    for c in chans:
        by_chan[c["id"]] = c["name"]
        for p in c["programs"]:
            ap = p.get("archivePath") or ""
            m = re.match(r'^/download/([^/]+)/(.+)$', ap)
            if not m: continue
            ident, rel = m.group(1).lower(), urllib.parse.unquote(m.group(2)).split("?")[0].lower()
            for k in ((ident, rel), ("bn", bn_key(rel))):
                keys.setdefault(k, set()).add(c["id"])
            code = ep_code(rel.rsplit("/", 1)[-1])
            if code: codes[c["id"]].add(code)
            if c["id"] == "item-unsorted": unsorted.add((ident, rel))
    return keys, codes, by_chan, unsorted

# ----------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True); ap.add_argument("--existing", required=True)
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--out", default="src/data/organizerShowsManifest.json")
    ap.add_argument("--report", default="reports/organizer-routing.json")
    a = ap.parse_args()
    meta = Meta(a.cache, a.fetch)
    ex_keys, ex_codes, ex_names, ex_unsorted = existing_index(a.existing)

    playlists = {f: list_folder(f, a.cache, a.fetch) for f in FOLDERS}
    report = {"playlists": [], "unrouted": [], "other_contracts": defaultdict(list)}
    rows_by_channel, names = defaultdict(list), {}
    seen_global, code_seen = set(), defaultdict(set)
    counts = Counter()
    promoted = []

    for folder in CLASSIC_FOLDERS + ["Mixed"]:
        for fn in playlists[folder]:
            stem = re.sub(r"\.m3u8?$", "", fn, flags=re.I) if re.search(r"\.m3u8?$", fn, re.I) else re.sub(r"m3u$", "", fn, flags=re.I)
            table = MIXED_ROUTES if folder == "Mixed" else ROUTES
            route = table.get(stem) or (None if folder == "Mixed" else next((v for k, v in ROUTES.items() if len(k) > 6 and stem.startswith(k)), None))
            entries = parse_playlist(os.path.join(a.cache, "playlists", folder, fn))
            rec = {"folder": folder, "file": fn, "entries": len(entries), "route": None, "added": 0, "already_in_guide": 0,
                   "dup_of_earlier_playlist": 0, "dropped": Counter()}
            if route is None:
                if folder == "Mixed":
                    for e in entries:
                        sp = split_ia(e["url"])
                        rec["dropped"]["external_url" if not sp else resolve(sp[0], sp[1], meta)[0]] += 1
                    rec["dropped"] = dict(rec["dropped"]); rec["route"] = ["skip", "not routed: " + ("empty file" if not entries else "no playable TV episodes / not a TV show")]
                    report["playlists"].append(rec); continue
                report["unrouted"].append(f"{folder}/{fn}"); report["playlists"].append(rec); continue
            rec["route"] = list(route[:3]) if route[0] not in ("split", "kw") else route[0]
            for e in entries:
                sp = split_ia(e["url"])
                if not sp: rec["dropped"]["external_url"] += 1; continue
                ident, rel = sp
                r = route
                if r[0] == "split":
                    r = r[1].get(ident.lower())
                    if r is None: rec["dropped"]["other_show_in_mixed_playlist"] += 1; continue
                if r[0] == "kw":
                    r = classify_kw(r[1], e["title"], rel)
                    if r is None: rec["dropped"]["unrecognised_show_in_mixed_playlist"] += 1; continue
                if folder == "Mixed" and NEWS_TALK_IDS.search(ident) and r[0] in ("existing", "new", "series"):
                    rec["dropped"]["news_talk_dump"] += 1; continue
                if folder == "Mixed" and fn.startswith("Irish RTE") and ident.lower() == "irish-films":
                    rec["dropped"]["movie_in_series_playlist"] += 1; report["other_contracts"]["movies"].append(f"{folder}/{fn}"); continue
                if r[0] in ("skip", "other"):
                    rec["dropped"][r[0]] += 1
                    if r[0] == "other": report["other_contracts"][r[1]].append(f"{folder}/{fn}")
                    continue
                st, pick, kind, it = resolve(ident, rel, meta)
                if st != "ok": rec["dropped"][st] += 1; continue
                if kind != "video": rec["dropped"]["audio_in_tv_playlist"] += 1; continue
                real_ident = it["id"]
                playable = pick["name"]
                pk = (real_ident.lower(), playable.lower()); ok_ = (ident.lower(), rel.lower())
                if pk in seen_global or ok_ in seen_global:
                    rec["dup_of_earlier_playlist"] += 1; continue
                seen_global.update([pk, ok_])
                chan_id = r[1] if r[0] == "existing" else (f"org-{r[1]}" if r[0] == "new" else r[1])
                name = ex_names.get(chan_id) or (r[2] if len(r) > 2 else chan_id)
                # promotion from the catch-all Unsorted channel
                if pk in ex_unsorted or ok_ in ex_unsorted:
                    promoted.append({"identifier": real_ident, "file": playable})
                    elsewhere = None
                else:
                    hit = ex_keys.get(pk) or ex_keys.get(ok_) or ex_keys.get(("bn", bn_key(rel))) or set()
                    hit = {h for h in hit if h != "item-unsorted"}
                    elsewhere = hit
                if elsewhere:
                    rec["already_in_guide"] += 1; continue
                code = ep_code(rel.rsplit("/", 1)[-1])
                if code and chan_id not in BAG and (code in ex_codes.get(chan_id, set()) or code in code_seen[chan_id]):
                    rec["dropped"]["same_episode_code_already_in_channel"] += 1; continue
                if code: code_seen[chan_id].add(code)
                title = clean_title(e["title"], rel)
                rows_by_channel[chan_id].append({
                    "id": "org-" + hashlib.md5(f"{real_ident}/{playable}".encode()).hexdigest()[:14],
                    "channelId": chan_id, "channelName": name, "identifier": real_ident, "file": playable, "title": title,
                    "series": name, "bytes": pick["size"], "durationSeconds": round(pick["len"]),
                    "thumb": it["thumb"], "_new": r[0] == "new", "_order": natural(rel)})
                rec["added"] += 1
            rec["dropped"] = dict(rec["dropped"]); report["playlists"].append(rec)

    # stubs: a brand-new channel needs >= MIN_NEW_CHANNEL_EPISODES
    items, new_channels, stubbed = [], {}, {}
    for cid, rows in rows_by_channel.items():
        if rows[0]["_new"] and len(rows) < MIN_NEW_CHANNEL_EPISODES:
            stubbed[cid] = len(rows); continue
        rows.sort(key=lambda x: x["_order"])
        if rows[0]["_new"]: new_channels[cid] = (rows[0]["channelName"], len(rows))
        for x in rows:
            x.pop("_new"); x.pop("_order"); items.append(x)

    # Movies / Mixed / Music: classification only
    for folder in ("Movies", "Music"):
        for fn in playlists[folder]:
            entries = parse_playlist(os.path.join(a.cache, "playlists", folder, fn))
            c = Counter()
            for e in entries:
                sp = split_ia(e["url"])
                if not sp: c["external"] += 1; continue
                st, pick, kind, it = resolve(sp[0], sp[1], meta)
                c[f"{st}:{kind}" if st == "ok" else st] += 1
            report["playlists"].append({"folder": folder, "file": fn, "entries": len(entries), "status": dict(c), "route": "not wired (report only)"})

    manifest = {"schema": "ajn.archiveShowSourcesManifest.v1", "generatedAt": "2026-10-08",
                "promoteFromUnsorted": [{"identifier": i, "file": f} for i, f in sorted({(p["identifier"], p["file"]) for p in promoted})],
                "items": items}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(manifest, open(a.out, "w"), separators=(",", ":"))
    report["new_channels"] = {k: {"name": v[0], "episodes": v[1]} for k, v in sorted(new_channels.items())}
    report["merged_into_existing"] = dict(Counter(x["channelId"] for x in items if x["channelId"] not in new_channels))
    report["stub_channels_not_created"] = stubbed
    report["promoted_from_unsorted"] = len(manifest["promoteFromUnsorted"])
    report["other_contracts"] = {k: sorted(set(v)) for k, v in report["other_contracts"].items()}
    os.makedirs(os.path.dirname(a.report), exist_ok=True)
    json.dump(report, open(a.report, "w"), indent=1)
    print(json.dumps({"rows": len(items), "new_channels": len(new_channels), "merged_channels": len(report["merged_into_existing"]),
                      "promoted": report["promoted_from_unsorted"], "unrouted": report["unrouted"], "stubs": stubbed}, indent=1))

if __name__ == "__main__":
    main()
