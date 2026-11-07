#!/usr/bin/env python3
"""Test resolve() in build-organizer-manifest.py for verified/unverified .mkv."""

import importlib.util
import os
import unittest

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "build_organizer_manifest",
    os.path.join(here, "build-organizer-manifest.py"),
)
bom = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bom)


class TestResolveMkv(unittest.TestCase):
    def setUp(self):
        bom.MKV_VERIFIED.clear()

    def tearDown(self):
        bom.MKV_VERIFIED.clear()

    def test_picks_ia_mp4_when_both_exist(self):
        ident = "test-show"
        # Register mkv as verified
        bom.MKV_VERIFIED[f"/download/{ident}/Episode 01.mkv"] = {
            "status": "verified",
            "browserPlayable": True,
            "hasCues": True,
        }
        meta = {
            ident: {
                "state": "ok",
                "id": ident,
                "files": {
                    "episode 01.mkv": {"name": "Episode 01.mkv", "priv": False, "len": 1800, "size": 500000000, "src": "original"},
                    "episode 01.ia.mp4": {"name": "Episode 01.ia.mp4", "priv": False, "len": 1800, "size": 300000000, "src": "derivative"},
                },
            }
        }
        status, pick, kind, _ = bom.resolve(ident, "Episode 01.mkv", meta)
        self.assertEqual(status, "ok")
        self.assertEqual(kind, "video")
        self.assertEqual(pick["name"], "Episode 01.ia.mp4")

    def test_picks_verified_mkv_when_no_mp4_exists(self):
        ident = "test-show"
        bom.MKV_VERIFIED[f"/download/{ident}/Episode 01.mkv"] = {
            "status": "verified",
            "browserPlayable": True,
            "hasCues": True,
        }
        meta = {
            ident: {
                "state": "ok",
                "id": ident,
                "files": {
                    "episode 01.mkv": {"name": "Episode 01.mkv", "priv": False, "len": 1800, "size": 500000000, "src": "original"},
                },
            }
        }
        status, pick, kind, _ = bom.resolve(ident, "Episode 01.mkv", meta)
        self.assertEqual(status, "ok")
        self.assertEqual(kind, "video")
        self.assertEqual(pick["name"], "Episode 01.mkv")

    def test_returns_needs_transcode_for_unverified_mkv(self):
        ident = "test-show"
        meta = {
            ident: {
                "state": "ok",
                "id": ident,
                "files": {
                    "episode 01.mkv": {"name": "Episode 01.mkv", "priv": False, "len": 1800, "size": 500000000, "src": "original"},
                },
            }
        }
        status, pick, kind, _ = bom.resolve(ident, "Episode 01.mkv", meta)
        self.assertEqual(status, "needs_transcode")
        self.assertIsNone(pick)


if __name__ == "__main__":
    unittest.main()
