import email.message
import importlib.util
import io
import os
import json
import tempfile
import unittest
import urllib.error
from unittest import mock


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

    def test_rate_limit_retries_three_times_with_pacing_and_honors_retry_after(self):
        clock = FakeClock()
        attempts = []
        headers = email.message.Message()
        headers["Retry-After"] = "2"

        def opener(_request, timeout):
            attempts.append(timeout)
            raise urllib.error.HTTPError(
                "https://archive.org/test", 429, "rate limited", headers, None
            )

        client = builder.ArchiveClient(
            opener=opener, clock=clock.now, sleeper=clock.sleep
        )
        with self.assertRaises(builder.ArchiveFetchStopped):
            client.get("https://archive.org/test")
        self.assertEqual(attempts, [120, 120, 120, 120])
        self.assertEqual(clock.value, 6.0)
        self.assertTrue(client._stopped)

    def test_retry_after_is_capped_at_sixty_seconds(self):
        clock = FakeClock()
        headers = email.message.Message()
        headers["Retry-After"] = "300"

        def opener(_request, timeout):
            raise urllib.error.HTTPError(
                "https://archive.org/test", 503, "unavailable", headers, None
            )

        client = builder.ArchiveClient(
            opener=opener, clock=clock.now, sleeper=clock.sleep
        )
        with self.assertRaises(builder.ArchiveFetchStopped):
            client.get("https://archive.org/test")
        self.assertEqual(clock.value, 180.0)
        self.assertTrue(client._stopped)

    def test_list5_upsert_keeps_original_channel_position(self):
        channels = [
            {"id": "before", "name": "Before"},
            {"id": "mx-movies-classics-list", "name": "Old"},
            {"id": "after", "name": "After"},
        ]
        index = builder.upsert_channel_preserving_position(
            channels, {"id": "mx-movies-classics-list", "name": "Updated"}
        )
        self.assertEqual(index, 1)
        self.assertEqual([c["id"] for c in channels], [
            "before", "mx-movies-classics-list", "after"
        ])
        self.assertEqual(channels[1]["name"], "Updated")

    def test_list5_short_and_tv_title_rows_are_reported_and_held_by_default(self):
        rows = [
            {"identifier": "movie", "title": "Long feature", "durationSeconds": 5400},
            {"identifier": "short", "title": "Short film", "durationSeconds": 1200},
            {"identifier": "episode", "title": "Show S01E01", "durationSeconds": 1500},
        ]
        included, held = builder.filter_list5_movie_rows(rows)
        self.assertEqual([r["identifier"] for r in included], ["movie"])
        self.assertEqual(
            {(r["identifier"], r["rule"]) for r in held},
            {("short", "film_under_45_minutes"), ("episode", "film_under_45_minutes"),
             ("episode", "tv_episode_title")},
        )
        included_keep, held_keep = builder.filter_list5_movie_rows(rows, keep_short=True)
        self.assertEqual([r["identifier"] for r in included_keep], ["movie", "short", "episode"])
        self.assertEqual(held_keep, [])

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


class InAppScanTests(unittest.TestCase):
    def test_archive_json_cache_strips_uploader_fields(self):
        raw = json.dumps({
            "metadata": {"identifier": "fixture", "title": "Feature", "uploader": "test@example.invalid"},
            "files": [{"name": "Feature.mp4", "size": "1000000"}],
            "nested": [{"uploader_email": "test@example.invalid"}],
        }).encode()
        sanitized = builder.sanitize_archive_json(raw)
        data = json.loads(sanitized)
        self.assertNotIn("uploader", data["metadata"])
        self.assertNotIn("uploader_email", data["nested"][0])
        self.assertEqual(data["metadata"]["identifier"], "fixture")
        self.assertEqual(data["files"][0]["name"], "Feature.mp4")

    def test_identifier_scan_requires_whole_identifier(self):
        self.assertTrue(builder.text_has_identifier('{"identifier":"film_2024"}', "film_2024"))
        self.assertTrue(builder.text_has_identifier("url=/download/film-2024/file.mp4", "film-2024"))
        self.assertFalse(builder.text_has_identifier("film_2024-extra", "film_2024"))
        self.assertFalse(builder.text_has_identifier("prefixfilm_2024", "film_2024"))
        self.assertEqual(
            builder.identifiers_in_text(
                "film_2024-extra /download/film-2024/file.mp4",
                ["film_2024", "film-2024"],
            ),
            {"film-2024"},
        )

    def test_test_files_are_not_app_references(self):
        for name in ("test-infobattalion-lists.ts", "src/news/news.test.ts", "test_infobattalion_builder.py"):
            self.assertTrue(builder.is_test_file(name), name)
        for name in ("guideRegistry.ts", "src/data/extraChannelsManifest.json", "server/latest-test.ts"):
            self.assertFalse(builder.is_test_file(name), name)


class List5IntegrationTests(unittest.TestCase):
    def test_partial_list5_build_only_fetches_new_ids_and_preserves_other_data(self):
        existing_id = "already-in-target-guide"
        new_id = "fixture-new-list5-film"
        extra = {
            "schema": "ajn.extraChannelsManifest.v1",
            "channels": [
                {"guideId": "movies-classics-vault", "id": "before", "name": "Before", "rows": []},
                {"guideId": "movies-classics-vault", "id": "mx-movies-classics-list",
                 "name": "Movies Classics (list)", "group": "Movies",
                 "rows": [row(existing_id, duration=4000)]},
                {"guideId": "classic-tv", "id": "after", "name": "After", "rows": []},
            ],
        }
        docs = [{"id": "curated-doc"}]
        audio = [{"id": "curated-audio"}]
        with tempfile.TemporaryDirectory() as temp:
            cache = os.path.join(temp, "cache")
            extra_path = os.path.join(temp, "extra.json")
            docs_path = os.path.join(temp, "docs.json")
            audio_path = os.path.join(temp, "audio.json")
            report_path = os.path.join(temp, "report.json")
            for path, payload in ((extra_path, extra), (docs_path, docs), (audio_path, audio)):
                with open(path, "w", encoding="utf-8") as stream:
                    json.dump(payload, stream)
            empty = {"id": 1, "members": []}
            response = {
                "value": [
                    {**empty, "id": list_id,
                     "members": [{"identifier": existing_id}, {"identifier": new_id}]
                     if list_id == 5 else []}
                    for list_id in (1, 2, 3, 4, 5, 6, 10)
                ]
            }
            requests = []

            def archive_get(url):
                requests.append(url)
                if url.endswith("/services/users/@infobattalion/lists"):
                    return json.dumps(response).encode()
                if url.endswith("/metadata/" + new_id):
                    return json.dumps({
                        "metadata": {"identifier": new_id, "title": "Feature Film"},
                        "files": [{
                            "name": "Feature Film.mp4", "size": "2000000",
                            "length": "5400", "source": "original", "private": "false",
                        }],
                    }).encode()
                raise AssertionError(f"unexpected Archive request: {url}")

            argv = [
                "build-infobattalion-lists.py", "--cache", cache, "--fetch", "--lists", "5",
                "--extra", extra_path, "--docs", docs_path, "--audio", audio_path,
                "--report", report_path,
            ]
            with mock.patch.object(builder.ARCHIVE, "get", side_effect=archive_get), \
                    mock.patch("sys.argv", argv):
                builder.main()

            self.assertEqual(len(requests), 2)
            self.assertTrue(requests[0].endswith("/services/users/@infobattalion/lists"))
            self.assertTrue(requests[1].endswith("/metadata/" + new_id))
            with open(extra_path, encoding="utf-8") as stream:
                rebuilt = json.load(stream)
            self.assertEqual(
                [c["id"] for c in rebuilt["channels"]],
                ["before", "mx-movies-classics-list", "after"],
            )
            self.assertEqual(rebuilt["channels"][0], extra["channels"][0])
            self.assertEqual(rebuilt["channels"][2], extra["channels"][2])
            self.assertEqual(len(rebuilt["channels"][1]["rows"]), 2)
            with open(docs_path, encoding="utf-8") as stream:
                self.assertEqual(json.load(stream), docs)
            with open(audio_path, encoding="utf-8") as stream:
                self.assertEqual(json.load(stream), audio)
            with open(report_path, encoding="utf-8") as stream:
                report = json.load(stream)
            new_status = next(x for x in report["movies_item_statuses"] if x["identifier"] == new_id)
            self.assertEqual(new_status["title"], "Feature Film")
            self.assertEqual(new_status["status"], "ADMIT")
            self.assertTrue(new_status["included"])


class SourceSwitchTests(unittest.TestCase):
    def test_fail_closed(self):
        self.assertFalse(any(builder.source_switches({}).values()))
        off = {"sources": {"infobattalion": {"enabled": False, "lists": {"movies": True}}}}
        self.assertFalse(builder.source_switches(off)["movies"])
        on = {"sources": {"infobattalion": {"enabled": True, "lists": {"movies": True, "atlas": False}}}}
        sw = builder.source_switches(on)
        self.assertTrue(sw["movies"])
        self.assertFalse(sw["atlas"])
        self.assertFalse(sw["tv"], "a source missing from the config is off")

    def test_repo_config_enables_current_sources(self):
        import json
        sw = builder.source_switches(json.load(open(os.path.join(os.path.dirname(__file__), "config", "catalog-refresh.json"))))
        self.assertTrue(all(sw.values()), sw)

    def test_overrides_validate(self):
        import json, tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"items": {"Some_Item": "tv"}}, f)
        self.assertEqual(builder.load_overrides(f.name), {"some_item": "tv"})
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"items": {"x": "documentary"}}, f)
        with self.assertRaises(ValueError):
            builder.load_overrides(f.name)
        self.assertEqual(builder.load_overrides(os.path.join(os.path.dirname(__file__), "config", "catalog-overrides.json")), {})


class MovieListClassificationTests(unittest.TestCase):
    def ep(self, title, duration):
        return {"identifier": "x", "file": f"{title}.mp4", "title": title, "durationSeconds": duration}

    def test_feature_film_stays_a_movie(self):
        film = [self.ep("Night of the Living Dead", 5760)]
        self.assertEqual(builder.classify_movie_list_item(film, film), ("movie", film))

    def test_episode_titles_move_to_tv(self):
        eps = [self.ep("Show S01E01", 1500), self.ep("Show S01E02", 1500), self.ep("Show S01E03", 1500)]
        kind, rows = builder.classify_movie_list_item([], eps)
        self.assertEqual(kind, "tv")
        self.assertEqual(len(rows), 3)

    def test_three_short_untitled_files_move_to_tv(self):
        eps = [self.ep("Pilot", 1320), self.ep("The Big Game", 1320), self.ep("Road Trip", 1320)]
        self.assertEqual(builder.classify_movie_list_item([], eps)[0], "tv")

    def test_two_short_untitled_files_are_not_guessed_as_tv(self):
        eps = [self.ep("Making Of", 1320), self.ep("Interview", 1320)]
        self.assertEqual(builder.classify_movie_list_item([], eps), ("none", []))

    def test_owner_override_wins(self):
        film = [self.ep("A Film", 5760)]
        eps = [self.ep("Show S01E01", 1500), self.ep("Show S01E02", 1500)]
        self.assertEqual(builder.classify_movie_list_item(film, film, "skip"), ("none", []))
        self.assertEqual(builder.classify_movie_list_item(film, eps, "tv"), ("tv", eps))
        self.assertEqual(builder.classify_movie_list_item([], eps, "movie"), ("movie", eps))
        self.assertEqual(builder.classify_movie_list_item([], [], "tv"), ("none", []))

    def test_single_short_file_is_dropped_not_rerouted(self):
        self.assertEqual(builder.classify_movie_list_item([], [self.ep("Trailer", 700)]), ("none", []))

    def test_long_two_part_tv_titles_move_to_tv(self):
        eps = [self.ep("Miniseries Part 1 of 2", 5400), self.ep("Miniseries Part 2 of 2", 5400)]
        self.assertEqual(builder.classify_movie_list_item([], eps)[0], "tv")


if __name__ == "__main__":
    unittest.main()
