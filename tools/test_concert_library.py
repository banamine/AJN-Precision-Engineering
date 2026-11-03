#!/usr/bin/env python3
"""Offline tests for tools/build-concert-library.py. Fixtures mirror real @paris-portland metadata (2026-11-03 sample):
length as "02:40" or "554.14", track as "1/7" / "01" / duplicated, JPEG + JPEG Thumb + __ia_thumb.jpg, VBR MP3 derivative next to FLAC original.
Run: python tools/test_concert_library.py"""
import importlib.util, json, os, sys, tempfile, unittest
here = os.path.dirname(os.path.abspath(__file__))
s = importlib.util.spec_from_file_location("bcl", os.path.join(here, "build-concert-library.py")); B = importlib.util.module_from_spec(s); sys.modules["bcl"] = B; s.loader.exec_module(B)

def mp3(name, length, **kw): return {"name": name, "format": "VBR MP3", "source": kw.pop("source", "derivative"), "length": length, **kw}
def item(files, **md): return {"metadata": {"title": "Gin Blossoms Pittsburgh PA 1996", "date": "1996-03-18", "collection": ["fmradioarchive"], **md}, "files": files}
def hit(ident, subject=("live concert",), language=("eng",), mediatype="audio", title=None): 
    return {"fields": {"identifier": ident, "title": title or ident, "subject": list(subject), "language": list(language) if language else None, "mediatype": mediatype}}
CFG = dict(B.DEFAULTS)

class Units(unittest.TestCase):
    def test_seconds_both_formats(self):
        self.assertEqual(B.parse_seconds("02:40"), 160); self.assertEqual(B.parse_seconds("1:02:03"), 3723)
        self.assertAlmostEqual(B.parse_seconds("554.14"), 554.14); self.assertEqual(B.parse_seconds(""), 0); self.assertEqual(B.parse_seconds("n/a"), 0); self.assertEqual(B.parse_seconds(None), 0)
    def test_title_cleaning(self):
        for raw, want in [("01 Highwire.mp3", "Highwire"), ("1-born-under-a-bad-sign.mp3", "born-under-a-bad-sign"), ("03. The Shape I'm In.mp3", "The Shape I'm In"),
                          ("Track 04 - Foo_Bar.mp3", "Foo Bar"), ("Roomful Of Blues - 01 - Instrumental.mp3", "Roomful Of Blues - 01 - Instrumental")]:
            self.assertEqual(B.clean_track_title({"name": raw}), want, raw)
        self.assertEqual(B.clean_track_title({"name": "x.mp3", "title": "Real Title"}), "Real Title")
    def test_select_prefers_originals_drops_private_and_short(self):
        m = item([mp3("a.mp3", "02:40"), mp3("b.mp3", "00:15"), mp3("c.mp3", "03:00", private="true"), {"name": "z.flac", "format": "Flac", "source": "original", "length": "200"}])
        t, short = B.select_tracks(m, 30); self.assertEqual([x["name"] for x in t], ["a.mp3"]); self.assertEqual(short, 1)
        m2 = item([mp3("orig.mp3", "100", source="original"), mp3("der.mp3", "100", source="derivative")])
        self.assertEqual([x["name"] for x in B.select_tracks(m2, 30)[0]], ["orig.mp3"])
    def test_order_by_track_only_when_unique(self):
        uniq = item([mp3("b.mp3", "100", track="2/3"), mp3("a.mp3", "100", track="3/3"), mp3("c.mp3", "100", track="1/3")])
        self.assertEqual([x["name"] for x in B.select_tracks(uniq, 30)[0]], ["c.mp3", "b.mp3", "a.mp3"])
        dup = item([mp3("Roomful - 02.mp3", "100", track="2/14"), mp3("Roomful - 10.mp3", "100", track="15/27"), mp3("Roomful - 01.mp3", "100", track="2/14")])  # real: duplicated track values
        self.assertEqual([x["name"] for x in B.select_tracks(dup, 30)[0]], ["Roomful - 01.mp3", "Roomful - 02.mp3", "Roomful - 10.mp3"], "falls back to natural filename order")
    def test_art_rules(self):
        m = item([{"name": "Show.JPG", "format": "JPEG"}, {"name": "Show_thumb.jpg", "format": "JPEG Thumb"}, {"name": "__ia_thumb.jpg", "format": "Item Tile"}, {"name": "WWW.FLACAUDIO.COM.jpg", "format": "JPEG"}])
        self.assertEqual(B.pick_art(m), ("Show.JPG", "Show_thumb.jpg"))
        self.assertEqual(B.pick_art(item([{"name": "__ia_thumb.jpg", "format": "Item Tile"}])), (None, None), "explicit none, never the item tile")
        self.assertEqual(B.pick_art(item([{"name": "sub/cover.jpg", "format": "JPEG"}])), (None, None))
    def test_classify(self):
        self.assertEqual(B.classify(["Blues", "KFOG"], "Roomful of Blues", ""), "jazz-blues")
        self.assertEqual(B.classify(["Live Concert"], "Gin Blossoms", "Alt-rockers in concert. American alternative rock band formed in Tempe"), "rock")
        self.assertEqual(B.classify(["Live Concert", "FM Broadcast"], "Some Show", "A great night."), "unclassified")
        self.assertEqual(B.classify([], "X", "He once heard some jazz."), "unclassified", "one passing description mention is not enough")
    def test_admission_reasons(self):
        self.assertEqual(B.admission_reason({"is_dark": True, "metadata": {"t": 1}}, {}), "dark item")
        self.assertEqual(B.admission_reason({"metadata": {"access-restricted-item": "true"}}, {}), "access-restricted")
        self.assertEqual(B.admission_reason({"metadata": {"collection": ["inlibrary", "x"]}}, {}), "loan/lending collection")
        self.assertEqual(B.admission_reason({"__ajn_status": "NOT_FOUND"}, {}), "metadata not found")
        self.assertIsNone(B.admission_reason(item([]), {}))

class Pipeline(unittest.TestCase):
    def run_build(self, hits, metas):
        return B.build(hits, lambda i: metas.get(i), CFG)
    def test_funnel_and_reasons(self):
        good = item([mp3("01 A.mp3", "02:40"), mp3("02 B.mp3", "03:00")], description="<p>Alt rock band live. https://youtu.be/abc123</p>")
        hits = [hit("good"), hit("nonlive", subject=("fm broadcast",)), hit("spanish", language=("spa",)), hit("nolang", language=None), hit("dark"), hit("loan"), hit("empty"), hit("coll", mediatype="collection")]
        metas = {"good": good, "dark": {"is_dark": True, "metadata": {"title": "d"}, "files": []}, "loan": item([mp3("a.mp3", "100")], collection=["inlibrary"]),
                 "empty": item([{"name": "a.flac", "format": "Flac", "length": "100"}])}
        r = self.run_build(hits, metas); f = r["funnel"]
        self.assertEqual(list(f.values()), [8, 6, 4, 2, 1, 1], f"{dict(f)}")  # monotonic: dark+loan fall at not_restricted? see below
        self.assertEqual([c["id"] for c in r["candidates"]], ["good"])
        self.assertIn("non-English", r["rejected"]); self.assertIn("dark item", r["rejected"]); self.assertIn("no playable mp3", r["rejected"]); self.assertIn("mediatype collection", r["rejected"])
        self.assertEqual(r["needs_decision"]["language_missing"], ["nolang"], "missing language is excluded and listed, not guessed")
    def test_missing_language_can_be_included(self):
        cfg = dict(CFG, includeMissingLanguage=True); r = B.build([hit("nolang", language=None)], lambda i: item([mp3("a.mp3", "100")]), cfg)
        self.assertEqual(len(r["candidates"]), 1)
    def test_duplicates_by_title_date_and_md5(self):
        a = item([mp3("a.mp3", "100", md5="m1")]); b = item([mp3("a.mp3", "100", md5="m2")]); c = item([mp3("z.mp3", "100", md5="m1")], title="Different Title", date="2001-01-01")
        r = self.run_build([hit("a1"), hit("a2"), hit("a3")], {"a1": a, "a2": b, "a3": c})
        self.assertEqual([c["id"] for c in r["candidates"]], ["a1"]); self.assertEqual({d["identifier"] for d in r["duplicates"]}, {"a2", "a3"})
    def test_missing_metadata_is_rejected_not_success(self):
        r = self.run_build([hit("gone")], {}); self.assertEqual(r["candidates"], []); self.assertEqual(r["rejected"]["metadata not found"], ["gone"])
    def test_manifest_shape_deterministic_and_no_deferred_fields(self):
        m = item([mp3("01 Highwire.mp3", "02:40", size="3000000"), mp3("02 Day Job.mp3", "04:04")], description="Long write-up " + "x" * 500 + " https://www.youtube.com/watch?v=zzz",
                 subject=["Live Concert", "Blues"])
        m["files"] += [{"name": "Show.JPG", "format": "JPEG"}, {"name": "Show_thumb.jpg", "format": "JPEG Thumb"}]
        r = self.run_build([hit("g", subject=("Live Concert",))], {"g": m}); man = B.pools_manifest(r["candidates"]); man2 = B.pools_manifest(r["candidates"])
        self.assertEqual(json.dumps(man, sort_keys=True), json.dumps(man2, sort_keys=True))
        blob = json.dumps(man); self.assertNotIn("youtube", blob); self.assertNotIn("xxxx", blob); self.assertNotIn("generatedAt", blob)
        pool = man["pools"][0]; self.assertEqual((pool["id"], pool["name"], pool["group"]), ("concert-pool-jazz-blues", "Live Concerts: Jazz & Blues", "Live Concerts"))
        c = pool["concerts"][0]; self.assertEqual((c["id"], c["art"], c["thumb"]), ("g", "Show.JPG", "Show_thumb.jpg"))
        self.assertEqual([t["t"] for t in c["tracks"]], ["Highwire", "Day Job"]); self.assertEqual(c["tracks"][0]["d"], 160); self.assertEqual(c["tracks"][0]["b"], 3000000)
        self.assertEqual([d["identifier"] for d in B.deferred_metadata(r["candidates"])], ["g"], "write-up + YouTube are logged for later")

class Overrides(unittest.TestCase):
    def test_override_beats_keywords_and_validates(self):
        m = item([mp3("a.mp3", "100")], creator="Boz Scaggs", description="FM broadcast of a concert.")
        r = B.build([hit("boz")], lambda i: m, CFG, {"byCreator": {"boz scaggs": "soul-funk-hiphop"}}); self.assertEqual(r["candidates"][0]["pool"], "soul-funk-hiphop")
        r = B.build([hit("boz")], lambda i: m, CFG, {"byIdentifier": {"boz": "rock"}, "byCreator": {"Boz Scaggs": "soul-funk-hiphop"}}); self.assertEqual(r["candidates"][0]["pool"], "rock", "identifier wins over creator")
        self.assertEqual(B.build([hit("boz")], lambda i: m, CFG, {})["candidates"][0]["pool"], "unclassified", "no override, no keywords -> explicit Unclassified")
        with self.assertRaises(ValueError): B.build([hit("boz")], lambda i: m, CFG, {"byIdentifier": {"boz": "no-such-pool"}})

class Cli(unittest.TestCase):
    def test_fail_closed_when_disabled_and_gates(self):
        with tempfile.TemporaryDirectory() as d:
            cfgp = os.path.join(d, "cfg.json")
            with open(cfgp, "w") as fh: json.dump({"sources": {"paris-portland": {"enabled": False}}}, fh)
            self.assertEqual(B.main(["--config", cfgp, "--out", os.path.join(d, "o.json"), "--reports", d, "--cache", d]), 2)
            self.assertFalse(os.path.exists(os.path.join(d, "o.json")))

class Staging(unittest.TestCase):
    def _cands(self):
        out = []
        for pool, n in [("rock", 40), ("jazz-blues", 20), ("electronic", 2), ("unclassified", 3)]:
            for i in range(n):
                f = "a#b&c.mp3" if (pool == "rock" and i == 7) else "t.mp3"
                out.append({"id": f"{pool}-{i:02d}", "pool": pool, "tracks": [{"f": f, "t": "t", "d": 100}]})
        return out
    def test_every_pool_present_exact_size_deterministic_special_chars(self):
        a = B.stratified_sample(self._cands(), 12); b = B.stratified_sample(list(reversed(self._cands())), 12)
        self.assertEqual([c["id"] for c in a], [c["id"] for c in b]); self.assertEqual(len(a), 12)
        self.assertEqual({c["pool"] for c in a}, {"rock", "jazz-blues", "electronic", "unclassified"})
        self.assertIn("rock-07", [c["id"] for c in a])
        self.assertNotEqual([c["id"] for c in a if c["pool"] == "rock"][:3], ["rock-00", "rock-01", "rock-02"])

if __name__ == "__main__": unittest.main(verbosity=1)
