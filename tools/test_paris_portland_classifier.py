"""Tests for tools/paris_portland_classifier.py and the --two-pool merge (Entries 028/030/032). Run: python3 tools/test_paris_portland_classifier.py"""
import importlib.util, os, sys, unittest
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
import paris_portland_classifier as P
spec = importlib.util.spec_from_file_location("bcl", os.path.join(here, "build-concert-library.py")); B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
LIVE, FM = P.LIVE, P.FM
def c(title, topics=(), item_id="x"): return P.classify_final(item_id, title, list(topics))

class ClassifierTests(unittest.TestCase):
    def test_live_concert_tag_is_final(self):
        r = c("Eddie Palmieri Newport NPR Jazz Profiles", ["Live Concert", "NPR"]); self.assertEqual((r["bucket"], r["reason"]), (LIVE, "TAG_LIVE_CONCERT"))
    def test_whole_tag_not_substring(self):
        self.assertEqual(c("Some Gig", ["npr member station"])["reason"], "AUDIT_REVIEW_UNVERIFIED_VENUE")   # 'kboo' / 'npr' substrings must not match
        self.assertEqual(c("Some Gig", ["kboo"])["bucket"], FM)
    def test_fm_tag_series(self):
        r = c("Kim Paris Melting Pot", ["freeform portland", "melting pot"]); self.assertEqual(r["bucket"], FM); self.assertTrue(r["reason"].startswith("TAG_FM_BROADCAST"))
    def test_title_series_and_venue(self):
        self.assertEqual(c("Mountain Stage 2001")["reason"], "TITLE_FM_SERIES_MATCH")
        self.assertEqual(c("Joan Baez Live at Kezar Stadium 1975")["reason"], "TITLE_COMPOUND_VENUE_MATCH")
        self.assertEqual(c("Crowded House Live at E-Werk Koeln")["reason"], "TITLE_COMPOUND_VENUE_MATCH")
    def test_no_silent_default_and_no_surname_venue(self):
        r = c("Raoul Van Hall Studio Works"); self.assertEqual((r["bucket"], r["reason"]), (LIVE, "AUDIT_REVIEW_UNVERIFIED_VENUE"))
    def test_fm_tagged_disambiguation(self):
        self.assertEqual(c("Los Lobos-WFUV FM Broadcast NY 2002", ["fm broadcast"])["reason"], "FM_LIVE_CONCERT_PERFORMANCE")
        self.assertEqual(c("Rolling Stones Story BBC Radio Bob Harris 2003", ["fm broadcast"])["reason"], "FM_FEATURE_OR_DOCUMENTARY")
        self.assertEqual(c("Bud Powell Jazz Profiles NPR Nancy Wilson 2008", ["fm broadcast"])["bucket"], FM)       # Entry 032: 'profiles?'
        self.assertEqual(c("John Pizzarelli 2001 NPR Piano Jazz M.McPartland", ["fm broadcast"])["bucket"], FM)     # Entry 032: 'piano jazz'
        self.assertEqual(c("Muddy Waters Tribute 1983 WXRT Chicago", ["fm broadcast"])["bucket"], LIVE)            # Entry 032: no bare 'tribute'
        self.assertEqual(c("Roy Orbison Showtime Los Angeles", ["fm broadcast"])["bucket"], LIVE)                   # Entry 032: no bare 'show'
        self.assertEqual(c("Dave Brubeck Radio Show 1980", ["fm broadcast"])["bucket"], FM)

class MergeTests(unittest.TestCase):
    def test_merge_never_rewrites_existing(self):
        ex = {"schema": "s", "source": "a", "pools": [{"id": "p1", "concerts": [{"id": "old", "date": "2000", "tracks": []}]}]}
        nw = {"pools": [{"id": "p1", "concerts": [{"id": "new", "date": "1999", "tracks": []}, {"id": "old", "date": "X", "tracks": []}]}, {"id": "p2", "concerts": [{"id": "n2", "date": "", "tracks": []}]}]}
        m = B.merge_pools(ex, nw)
        self.assertEqual([x["id"] for x in m["pools"]], ["p1", "p2"]); self.assertEqual([x["id"] for x in m["pools"][0]["concerts"]], ["new", "old"])
        self.assertEqual(m["pools"][0]["concerts"][1]["date"], "2000")   # existing entry untouched, duplicate id not re-added
if __name__ == "__main__": unittest.main()
