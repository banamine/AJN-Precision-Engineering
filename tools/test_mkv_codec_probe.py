#!/usr/bin/env python3
"""Offline tests for mkv_codec_probe.py using ffmpeg-generated fixtures."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import mkv_codec_probe


class TestMkvCodecProbe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = shutil.which("ffmpeg")
        if not cls.ffmpeg:
            print("ffmpeg not installed; skipping test_mkv_codec_probe.py", file=sys.stderr)
            return

        cls.temp_dir = tempfile.mkdtemp(prefix="mkv_probe_test_")
        cls.has_x265 = False

        # Test if libx265 is available
        try:
            res = subprocess.run([cls.ffmpeg, "-encoders"], capture_output=True, text=True)
            if "libx265" in res.stdout:
                cls.has_x265 = True
        except Exception:
            pass

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "temp_dir") and os.path.isdir(cls.temp_dir):
            shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_mkv_fixtures(self):
        if not self.ffmpeg:
            self.skipTest("ffmpeg not installed")

        # 1. h264 + aac
        h264_aac = os.path.join(self.temp_dir, "h264_aac.mkv")
        cmd1 = [
            self.ffmpeg, "-y",
            "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-c:v", "libx264", "-c:a", "aac",
            h264_aac,
        ]
        subprocess.run(cmd1, capture_output=True, check=True)
        with open(h264_aac, "rb") as f:
            data = f.read()
        res1 = mkv_codec_probe.probe(lambda a, b: data[a:b + 1])
        self.assertEqual(res1["status"], "verified")
        self.assertTrue(res1["browserPlayable"])
        self.assertEqual(res1["videoNorm"], "h264")
        self.assertEqual(res1["audioNorm"], "aac")
        self.assertTrue(res1["hasCues"])

        # 2. hevc + aac (if libx265 is supported)
        if self.has_x265:
            hevc_aac = os.path.join(self.temp_dir, "hevc_aac.mkv")
            cmd2 = [
                self.ffmpeg, "-y",
                "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
                "-f", "lavfi", "-i", "sine=duration=1",
                "-c:v", "libx265", "-c:a", "aac",
                hevc_aac,
            ]
            r = subprocess.run(cmd2, capture_output=True)
            if r.returncode == 0 and os.path.isfile(hevc_aac):
                with open(hevc_aac, "rb") as f:
                    data = f.read()
                res2 = mkv_codec_probe.probe(lambda a, b: data[a:b + 1])
                self.assertEqual(res2["status"], "verified")
                self.assertFalse(res2["browserPlayable"])
                self.assertIn("video=hevc", res2.get("reason", ""))

        # 3. h264 + ac3
        h264_ac3 = os.path.join(self.temp_dir, "h264_ac3.mkv")
        cmd3 = [
            self.ffmpeg, "-y",
            "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-c:v", "libx264", "-c:a", "ac3",
            h264_ac3,
        ]
        subprocess.run(cmd3, capture_output=True, check=True)
        with open(h264_ac3, "rb") as f:
            data = f.read()
        res3 = mkv_codec_probe.probe(lambda a, b: data[a:b + 1])
        self.assertEqual(res3["status"], "verified")
        self.assertFalse(res3["browserPlayable"])
        self.assertIn("audio=ac3", res3.get("reason", ""))

        # 4. h264 + aac with 300 KB .ass subtitle as FIRST stream (track list > 64 KB)
        ass_path = os.path.join(self.temp_dir, "large.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write("[Script Info]\nTitle: Test\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
            # Style definitions go into CodecPrivate in the TrackEntry header
            for idx in range(1200):
                f.write(f"Style: Style{idx:04d},Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n")
            f.write("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
            f.write("Dialogue: 0,0:00:00.00,0:00:01.00,Style0000,,0,0,0,,Hello world\n")

        large_tracks = os.path.join(self.temp_dir, "large_tracks.mkv")
        cmd4 = [
            self.ffmpeg, "-y",
            "-i", ass_path,
            "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-map", "0:s", "-map", "1:v", "-map", "2:a",
            "-c:s", "ass", "-c:v", "libx264", "-c:a", "aac",
            large_tracks,
        ]
        subprocess.run(cmd4, capture_output=True, check=True)
        with open(large_tracks, "rb") as f:
            data = f.read()
        res4 = mkv_codec_probe.probe(lambda a, b: data[a:b + 1])
        self.assertEqual(res4["status"], "verified")
        self.assertTrue(res4["browserPlayable"])
        self.assertEqual(res4.get("requests"), 3)

        # 5. junk file
        junk_data = b"This is not a matroska file at all. Just random junk data."
        res5 = mkv_codec_probe.probe(lambda a, b: junk_data[a:b + 1])
        self.assertEqual(res5["status"], "unverified")


if __name__ == "__main__":
    unittest.main()
