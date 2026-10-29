import email.message
import importlib.util
import io
import os
import unittest
import urllib.error


SPEC = importlib.util.spec_from_file_location(
    "infobattalion_builder",
    os.path.join(os.path.dirname(__file__), "tools", "build-infobattalion-lists.py"),
)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def row(identifier, duration=60, size=150_000):
    return {
        "id": f"row-{identifier}",
        "identifier": identifier,
        "file": f"{identifier}.mp4",
        "title": identifier,
        "durationSeconds": duration,
        "bytes": size,
    }


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class InfobattalionBuilderTests(unittest.TestCase):
    def test_manifest_guides_normalize_video_documentary_and_audio_items(self):
        guides = builder.manifest_guides(
            {"channels": [{
                "guideId": "movies-classics-vault",
                "rows": [{"identifier": "Filmography-Childhood-Productions"}],
            }]},
            [{"id": "Documentary-Item"}],
            [{"itemId": "Radio-Item"}],
        )
        self.assertEqual(guides["filmography-childhood-productions"], {"movies-classics-vault"})
        self.assertEqual(guides["documentary-item"], {"science-documentaries"})
        self.assertEqual(guides["radio-item"], {"audio-podcasts"})
        self.assertEqual(builder.SOURCE_GUIDES["cartoons"], "classic-tv")

    def test_deferred_light_rows_are_explicit_and_stable(self):
        old_ids = {"cx-existing", "tvx-existing"}
        old_deferred = {"tvx-existing"}
        self.assertTrue(builder.should_defer_light_rows("cx-new", old_ids, old_deferred, True))
        self.assertFalse(builder.should_defer_light_rows("cx-existing", old_ids, old_deferred, True))
        self.assertTrue(builder.should_defer_light_rows("tvx-existing", old_ids, old_deferred, False))
        self.assertTrue(builder.manifest_channel("classic-tv", "cx-new", "New", "Cartoons", [], True)["deferLightRows"])
        self.assertNotIn("deferLightRows", builder.manifest_channel("classic-tv", "cx-existing", "Old", "Cartoons", []))

    def test_cartoon_show_channel_and_single_catchall(self):
        channels, rejected = builder.cartoon_channels([
            ("show-a", "Show A", [row("a1"), row("a2"), row("a3")]),
            ("show-b", "Show B", [row("b1"), row("b2")]),
        ])
        self.assertEqual(
            [(c["id"], c["name"], c["guideId"], c["group"], len(c["rows"])) for c in channels],
            [
                ("cx-show-a", "Show A", "classic-tv", "Cartoons", 3),
                ("cx-classic-cartoons", "Classic Cartoons", "classic-tv", "Cartoons", 2),
            ],
        )
        self.assertEqual(rejected, {})

    def test_cartoon_placeholder_rows_are_rejected(self):
        channels, rejected = builder.cartoon_channels([
            ("show-a", "Show A", [
                row("short", duration=29),
                row("tiny", size=99_999),
                row("eligible"),
            ])
        ])
        self.assertEqual(channels[0]["id"], "cx-classic-cartoons")
        self.assertEqual([r["id"] for r in channels[0]["rows"]], ["row-eligible"])
        self.assertEqual(rejected, {"duration_under_30_seconds": 1, "size_under_100kb": 1})

    def test_request_starts_are_spaced(self):
        clock = FakeClock()
        starts = []

        def opener(_request, timeout):
            self.assertEqual(timeout, 120)
            starts.append(clock.now())
            return FakeResponse(b"{}")

        client = builder.ArchiveClient(opener=opener, clock=clock.now, sleeper=clock.sleep)
        for _ in range(3):
            self.assertEqual(client.get("https://archive.org/test"), b"{}")
        self.assertEqual(starts, [0.0, 1.55, 3.1])

    def test_rate_limit_stops_without_retry(self):
        attempts = []
        headers = email.message.Message()
        headers["Retry-After"] = "60"

        def opener(_request, timeout):
            attempts.append(timeout)
            raise urllib.error.HTTPError(
                "https://archive.org/test", 429, "rate limited", headers, None
            )

        client = builder.ArchiveClient(opener=opener)
        with self.assertRaises(builder.ArchiveFetchStopped):
            client.get("https://archive.org/test")
        self.assertEqual(attempts, [120])
        self.assertTrue(client._stopped)

    def test_redirect_hop_is_paced_and_followed_explicitly(self):
        clock = FakeClock()
        calls = []
        headers = email.message.Message()
        headers["Location"] = "https://archive.org/metadata/target"

        def opener(request, timeout):
            calls.append((request.full_url, clock.now()))
            if request.full_url.endswith("/redirect"):
                raise urllib.error.HTTPError(request.full_url, 302, "redirect", headers, None)
            return FakeResponse(b"metadata")

        client = builder.ArchiveClient(opener=opener, clock=clock.now, sleeper=clock.sleep)
        self.assertEqual(client.get("https://archive.org/metadata/redirect"), b"metadata")
        self.assertEqual([url for url, _ in calls], [
            "https://archive.org/metadata/redirect",
            "https://archive.org/metadata/target",
        ])
        self.assertGreaterEqual((calls[1][1] - calls[0][1]) * 1000, 1550)

    def test_non_archive_redirect_is_rejected(self):
        headers = email.message.Message()
        headers["Location"] = "https://example.com/metadata"

        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 302, "redirect", headers, None)

        client = builder.ArchiveClient(opener=opener)
        with self.assertRaises(builder.ArchiveFetchStopped):
            client.get("https://archive.org/metadata/redirect")

    def test_clean_rebuild_scan_excludes_generated_rows_before_reset(self):
        extra_path = "/tmp/source/extra.json"
        docs_path = "/tmp/source/docs.json"
        audio_path = "/tmp/source/audio.json"
        extra = {"channels": [
            {"id": "cx-classic-cartoons", "rows": [{"identifier": "cartoon-generated"}]},
            {"id": "tvx-old", "rows": [{"identifier": "tv-generated"}]},
            {"id": "hand-curated", "rows": [{"identifier": "keep"}]},
        ]}
        docs = [{"id": "generated-doc", "_ib": 1}, {"id": "curated-doc"}]
        audio = [{"itemId": "generated-audio", "_ib": 1}, {"itemId": "curated-audio"}]
        self.assertEqual(
            builder.ungenerated_payload(extra_path, extra, extra_path, docs_path, audio_path),
            {"channels": [{"id": "hand-curated", "rows": [{"identifier": "keep"}]}]},
        )
        self.assertEqual(builder.ungenerated_payload(docs_path, docs, extra_path, docs_path, audio_path), [{"id": "curated-doc"}])
        self.assertEqual(builder.ungenerated_payload(audio_path, audio, extra_path, docs_path, audio_path), [{"itemId": "curated-audio"}])
        self.assertEqual(len(extra["channels"]), 3)
        self.assertEqual(len(docs), 2)
        self.assertEqual(len(audio), 2)


if __name__ == "__main__":
    unittest.main()
