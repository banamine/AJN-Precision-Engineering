import sys, os, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from classify_lib import clean_title, title_from_identifier, classify_item, file_kind, title_flags, ID_RX

class Titles(unittest.TestCase):
    def test_acronyms(self):
        self.assertEqual(title_from_identifier("001-nypd-blue"), "001 NYPD Blue")
        self.assertEqual(clean_title("001 Nypd Blue"), "001 NYPD Blue")
        self.assertEqual(clean_title("Aldo Nova Ball And Chain Mtv 2"), "Aldo Nova Ball And Chain MTV 2")
        self.assertEqual(clean_title("Iron Maiden Rock In Rio 2019 Full Show Hd"), "Iron Maiden Rock In Rio 2019 Full Show HD")
    def test_season_episode(self):
        self.assertEqual(clean_title("S 01 E 29 Indian Fever"), "S01E29 Indian Fever")
        self.assertEqual(clean_title("Amazing Stories 1985 S 01"), "Amazing Stories 1985 S01")
        self.assertEqual(clean_title("Show s1e5 Pilot"), "Show S01E05 Pilot")
    def test_preserves_intentional_case(self):
        self.assertEqual(clean_title("Back To The Future"), "Back To The Future")
        self.assertEqual(clean_title("CATHERINE AUSTIN FITTS - STAR WARS"), "CATHERINE AUSTIN FITTS - STAR WARS")
        self.assertEqual(title_from_identifier("ColdWarInSoviet1"), "Cold War In Soviet1")
        self.assertEqual(title_from_identifier("Y2mate.comAndyKaufmanOrson1982XrGl"), "Y2mate comAndyKaufmanOrson1982XrGl")
    def test_lowercase_and_slug(self):
        self.assertEqual(clean_title("boy-and-his-train"), "Boy and His Train")
        self.assertEqual(clean_title("no longer in print"), "No Longer in Print")
        self.assertEqual(clean_title("junglebook-1942-hd"), "Junglebook 1942 HD")
    def test_dotted_and_tails(self):
        self.assertEqual(clean_title("The. Avengers. 1965. S 04 E 09. The. Hour. That. Never. Was"), "The Avengers 1965 S04E09 The Hour That Never Was")
        self.assertEqual(title_from_identifier("homicide-s-02e-35-coincidence.ia"), "Homicide S02E35 Coincidence")
        self.assertEqual(clean_title("Spider-Man (1967)"), "Spider-Man (1967)")
        self.assertEqual(clean_title("The Avengers S 04e 03. The. Cybernauts"), "The Avengers S04E03 The Cybernauts")
        self.assertEqual(clean_title("Krull. 1983.1080p. Blu Ray.x 264. YIFY"), "Krull 1983 1080p Blu Ray x 264 YIFY")
        self.assertEqual(clean_title("T. H. E. Cat"), "T.H.E. Cat")
        self.assertEqual(clean_title("Peter.Gunn s 1"), "Peter Gunn S01")
        self.assertEqual(clean_title("Dr. Strangelove or How I Learned"), "Dr. Strangelove or How I Learned")
        self.assertEqual(clean_title("Mr. Smith Goes to Washington"), "Mr. Smith Goes to Washington")
    def test_flags(self):
        for t in ("MV", "782", "mov5", "img_3552-1", "tt0057603"): self.assertIn("title_low_information", title_flags(t), t)
        self.assertEqual(title_flags("Frontier Circus"), [])

class Classify(unittest.TestCase):
    def test_ready_video(self):
        c = classify_item("a-show", "A Show S01E01", "Classic TV", "movies", ["h.264", "Metadata"])
        self.assertEqual((c["mediaKind"], c["contentType"], c["conflicts"]), ("video", "episode", []))
    def test_conflict(self):
        c = classify_item("x", "X", None, "movies", ["VBR MP3"])
        self.assertTrue(c["conflicts"]); self.assertEqual(c["mediaKind"], "conflict")
    def test_no_evidence(self):
        self.assertEqual(classify_item("0251114-1101", "0251114 1101", None, None, [])["evidence"], 0)
    def test_regex_types(self):
        self.assertEqual(classify_item("q", "Queen Greatest Hits Full Album", None, "audio", ["VBR MP3"])["contentType"], "music")
        self.assertEqual(classify_item("w", "Pawn Sacrifice (2014) 720p BluRay", None, "movies", ["h.264"])["contentType"], "movie")
        self.assertEqual(classify_item("o", "Old Time Radio Mystery Hour", None, "audio", ["MP3"])["contentType"], "radio")
    def test_file_kind(self):
        self.assertEqual(file_kind("a.mp4", "h.264"), ("video", None))
        self.assertEqual(file_kind("a.mp4", "Matroska")[1][:18], "container_mismatch")
        self.assertEqual(file_kind("a.mp3", "VBR MP3"), ("audio", None))
        self.assertEqual(file_kind("a.jpg", "JPEG")[0], "other")
    def test_identifier_charset(self):
        self.assertTrue(ID_RX.match("04-for-as-long_202606")); self.assertFalse(ID_RX.match("bad id/with slash"))

if __name__ == "__main__": unittest.main(verbosity=1)
