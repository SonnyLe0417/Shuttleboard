"""Offline setup tests: synthetic ZIPs only; no model loading or network access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    "checkpoint_setup", Path(__file__).with_name("prepare-tracknet-v3-checkpoints.py")
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class CheckpointSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.runtime = Path(self.temporary.name)
        self.data = self.runtime / "data"
        self.data.mkdir()
        self.ckpts = self.runtime / "ckpts"
        self.archive = self.data / "TrackNetV3_ckpts.zip"
        self.contents = {name: f"test-only {name}".encode() for name in setup.CHECKPOINTS}

    def bundle(self, extras=(), omit=()):
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, content in self.contents.items():
                if name not in omit:
                    archive.writestr(f"upstream/ckpts/{name}", content)
            for name, content in extras:
                if isinstance(name, str):
                    # ZipInfo normalizes Windows backslashes during construction;
                    # restore the raw name to model an archive from another tool.
                    raw_name = name
                    name = zipfile.ZipInfo(name)
                    name.filename = raw_name
                archive.writestr(name, content)

    def prepare(self, download=False):
        with contextlib.redirect_stdout(io.StringIO()):
            setup.prepare(self.runtime, download=download)

    def test_extracts_only_allowed_basenames_and_records_provenance(self):
        self.bundle([("unrelated.py", b"not extracted")])
        self.prepare()
        self.assertEqual(set(path.name for path in self.ckpts.iterdir()), {*setup.CHECKPOINTS, "provenance.json"})
        for name, content in self.contents.items():
            self.assertEqual((self.ckpts / name).read_bytes(), content)
        provenance = json.loads((self.ckpts / "provenance.json").read_text())
        self.assertEqual(provenance["source_commit"], setup.SOURCE_COMMIT)
        self.assertEqual(provenance["download_id"], setup.DOWNLOAD_ID)
        self.assertEqual(provenance["archive_sha256"], setup.sha256(self.archive))
        self.assertEqual(provenance["verification"], "archive-matched")
        for name in setup.CHECKPOINTS:
            self.assertEqual(provenance["checkpoints"][name]["sha256"], setup.sha256(self.ckpts / name))

    def test_repeat_preserves_files_and_manifest(self):
        self.bundle()
        self.prepare()
        before = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.ckpts.iterdir()}
        with patch.object(setup.subprocess, "run", side_effect=AssertionError("must not download")):
            self.prepare(download=True)
        after = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.ckpts.iterdir()}
        self.assertEqual(before, after)

    def test_existing_files_without_archive_skip_download_and_mark_local_provenance(self):
        self.ckpts.mkdir()
        for name, content in self.contents.items():
            (self.ckpts / name).write_bytes(content)
        with patch.object(setup.subprocess, "run", side_effect=AssertionError("must not download")):
            self.prepare(download=True)
        provenance = json.loads((self.ckpts / "provenance.json").read_text())
        self.assertIsNone(provenance["archive_sha256"])
        self.assertEqual(provenance["verification"], "existing-local-hashes-only")

    def test_existing_mismatch_does_not_overwrite_or_publish_other_files(self):
        self.bundle()
        self.ckpts.mkdir()
        checkpoint = self.ckpts / setup.CHECKPOINTS[0]
        checkpoint.write_bytes(b"user checkpoint")
        with self.assertRaisesRegex(ValueError, "refusing overwrite"):
            self.prepare()
        self.assertEqual(checkpoint.read_bytes(), b"user checkpoint")
        self.assertEqual(list(self.ckpts.iterdir()), [checkpoint])

    def test_matching_partial_install_is_completed(self):
        self.bundle()
        self.ckpts.mkdir()
        name = setup.CHECKPOINTS[0]
        checkpoint = self.ckpts / name
        checkpoint.write_bytes(self.contents[name])
        before = checkpoint.stat().st_mtime_ns
        self.prepare()
        self.assertEqual(checkpoint.stat().st_mtime_ns, before)
        self.assertTrue((self.ckpts / setup.CHECKPOINTS[1]).exists())

    def test_modified_checkpoint_fails_manifest_verification(self):
        self.bundle()
        self.prepare()
        (self.ckpts / setup.CHECKPOINTS[0]).write_bytes(b"changed by user")
        with self.assertRaisesRegex(ValueError, "differs from provenance"):
            self.prepare()

    def test_changed_archive_fails_recorded_hash(self):
        self.bundle()
        self.prepare()
        self.bundle([("new-file", b"changed archive")])
        with self.assertRaisesRegex(ValueError, "Archive differs from recorded SHA256"):
            self.prepare()

    def test_different_source_commit_is_not_overwritten(self):
        self.bundle()
        self.prepare()
        manifest = self.ckpts / "provenance.json"
        record = json.loads(manifest.read_text())
        record["source_commit"] = "different"
        manifest.write_text(json.dumps(record))
        before = manifest.read_bytes()
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.prepare()
        self.assertEqual(manifest.read_bytes(), before)

    def test_unsafe_archive_paths_are_rejected_before_publishing(self):
        for path in ("../escape", "/absolute", "C:/absolute", "folder\\escape", "folder/../escape"):
            with self.subTest(path=path):
                self.bundle([(path, b"unsafe")])
                with self.assertRaisesRegex(ValueError, "Unsafe archive member"):
                    self.prepare()
                self.assertEqual(list(self.ckpts.iterdir()), [])

    def test_archive_symlink_is_rejected(self):
        member = zipfile.ZipInfo("linked")
        member.create_system = 3
        member.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.bundle([(member, b"../target")])
        with self.assertRaisesRegex(ValueError, "Non-regular archive member"):
            self.prepare()

    def test_duplicate_basename_is_rejected(self):
        self.bundle([(f"other/{setup.CHECKPOINTS[0]}", b"duplicate")])
        with self.assertRaisesRegex(ValueError, "Duplicate checkpoint basename"):
            self.prepare()

    def test_missing_checkpoint_is_rejected(self):
        self.bundle(omit=[setup.CHECKPOINTS[1]])
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.prepare()

    def test_checkpoint_size_limit_is_enforced(self):
        self.bundle()
        with patch.object(setup, "MAX_CHECKPOINT_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "Invalid checkpoint size"):
                self.prepare()

    def test_non_zip_download_does_not_publish(self):
        def fake_download(arguments, check):
            self.assertTrue(check)
            self.assertEqual(arguments[1:4], ["-m", "gdown", setup.DOWNLOAD_ID])
            Path(arguments[-1]).write_bytes(b"<html>Drive quota exceeded</html>")

        with patch.object(setup.subprocess, "run", side_effect=fake_download):
            with self.assertRaises(zipfile.BadZipFile):
                self.prepare(download=True)
        self.assertFalse(self.archive.exists())
        self.assertEqual(list(self.ckpts.iterdir()), [])

    def test_download_is_staged_then_published(self):
        def fake_download(arguments, check):
            with zipfile.ZipFile(arguments[-1], "w") as archive:
                for name, content in self.contents.items():
                    archive.writestr(name, content)

        with patch.object(setup.subprocess, "run", side_effect=fake_download) as download:
            self.prepare(download=True)
        download.assert_called_once()
        self.assertTrue(self.archive.exists())
        self.assertTrue((self.ckpts / "provenance.json").exists())

    def test_missing_assets_require_explicit_download(self):
        with self.assertRaisesRegex(ValueError, "use --download"):
            self.prepare()

    def test_exclusive_copy_never_overwrites(self):
        source = self.data / "new"
        destination = self.data / "existing"
        source.write_bytes(b"new content")
        destination.write_bytes(b"original content")
        with self.assertRaises(FileExistsError):
            setup.copy_new(source, destination)
        self.assertEqual(destination.read_bytes(), b"original content")


if __name__ == "__main__":
    unittest.main()
