import json, os, subprocess, sys, tempfile, unittest
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools")
sys.path.insert(0, T)
from extra_channels_lib import make_row, validate

def f(n, fmt, src, length, size): return {"name": n, "format": fmt, "source": src, "length": length, "size": str(int(size))}
def item(ident, title, cat, status="provisional"):
    return {"identifier": ident, "title": title, "category": cat, "status": status,
            "playback": {"type": "archive-embed", "url": "https://archive.org/embed/" + ident}}

class Converter(unittest.TestCase):
    def test_end_to_end(self):
        d = tempfile.mkdtemp(); os.makedirs(d + "/meta")
        base = {"schema": "ajn.extraChannelsManifest.v1", "channels": [
            {"guideId": "classic-tv", "id": "tvx-x", "name": "X", "group": "Classic TV",
             "rows": [make_row("already-there", "a.mp4", "A", 5000, 100)]}]}
        h1 = {"items": [
            item("show-1", "001 nypd blue", "Classic TV"),
            item("album-1", "Greatest Hits", "Music"),
            item("talk-1", "Talk", "News/Talk archives"),
            item("radio-1", "Radio", "Old-Time/Radio archives"),
            item("misc-1", "Misc", "Unsorted - review"),
            item("no-meta", "No Meta", "Classic TV"),
            item("already-there", "Dup", "Classic TV"),
            item("parked", "Parked", "Unsorted - review", "deferred_owner_decision")]}
        meta = {
          "show-1": {"metadata": {"title": "001 nypd blue"}, "files": [
              f("ep1.mkv", "Matroska", "original", "1500", 9e8), f("ep1.mp4", "h.264", "derivative", "1500", 3e8),
              f("ep2.mp4", "Matroska", "original", "1800", 4e8),          # mismatch -> deferred
              f("ep3.mp4", "h.264", "original", None, 4e8),              # unknown duration -> deferred
              f("clip.mp4", "h.264", "original", "12", 5e6),             # <30s -> skipped
              f("cover.jpg", "JPEG", "original", None, 1000)]},
          "album-1": {"files": [f("t1.mp3", "VBR MP3", "original", "200.4", 5e6), f("t1_64kb.mp3", "64Kbps MP3", "derivative", "200", 1e6),
                                 f("t2.mp3", "VBR MP3", "original", "3:20", 6e6)]},
          "talk-1": {"files": [f("show.mp4", "h.264", "original", "3600", 9e8)]},
          "radio-1": {"files": [f("ep.mp3", "MP3", "original", "1800", 2e7), f("ep.mp4", "h.264", "derivative", "1800", 8e7)]},
          "misc-1": {"files": [f("a.mp4", "h.264", "original", "600", 1e8)]}}
        for k, v in meta.items(): json.dump(v, open(f"{d}/meta/{k}.json", "w"))
        json.dump(h1, open(d + "/h1.json", "w")); json.dump(base, open(d + "/base.json", "w"))
        r = subprocess.run([sys.executable, "-I", T + "/build_extra_channels.py", "--h1", d + "/h1.json", "--meta-dir", d + "/meta",
                            "--base", d + "/base.json", "--out", d + "/out.json", "--sidecar-out", d + "/side.json", "--report", d + "/rep.json"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out, side, rep = (json.load(open(f"{d}/{n}.json")) for n in ("out", "side", "rep"))
        ch = {c["id"]: c for c in out["channels"]}; sc = {c["id"]: c for c in side["channels"]}
        self.assertEqual(ch["h1-show-1"]["name"], "001 NYPD Blue")
        self.assertEqual([x["file"] for x in ch["h1-show-1"]["rows"]], ["ep1.mp4"])                 # h.264 derivative beat Matroska original
        self.assertEqual({x["reason"][:18] for x in rep["deferredFiles"]["show-1"]}, {"container_mismatch", "duration_unknown"})
        self.assertEqual(rep["skippedFiles"]["show-1"], [["clip.mp4", "under_30_seconds"]])
        self.assertEqual([x["file"] for x in sc["h1-album-1-audio"]["rows"]], ["t1.mp3", "t2.mp3"])   # VBR MP3 preferred per stem
        self.assertEqual(sc["h1-album-1-audio"]["rows"][1]["durationSeconds"], 200)
        self.assertEqual((sc["h1-album-1-audio"]["guideId"], sc["h1-album-1-audio"]["group"]), ("audio-vault", "Music"))
        self.assertEqual(ch["h1-talk-1"]["group"], "News"); self.assertEqual(ch["h1-talk-1"]["guideId"], "cable-tv")
        self.assertIn("h1-radio-1-audio", sc); self.assertIn("h1-radio-1", ch)                      # audio and video split, not mixed
        self.assertEqual(ch["h1-misc-1"]["group"], "Unsorted - review")
        self.assertEqual(rep["needsMetadata"], ["no-meta"]); self.assertEqual(rep["alreadyInManifest"], ["already-there"])
        self.assertEqual(rep["deferredOwnerDecisionItems"], 1); self.assertEqual(rep["validationProblems"], [])
        self.assertEqual(validate(out), []); self.assertEqual(validate(side), [])
        self.assertTrue(all(c["id"] != "h1-parked" for c in out["channels"]))                       # deferred item kept out, not deleted from h1

if __name__ == "__main__": unittest.main(verbosity=1)
