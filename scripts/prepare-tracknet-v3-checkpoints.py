"""Prepare only the two upstream checkpoints without loading or overwriting them."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

SOURCE_REPOSITORY = "https://github.com/qaz812345/TrackNetV3.git"
SOURCE_COMMIT = "6eda442ada1740573f200f836d93edc9a541ee86"
DOWNLOAD_ID = "1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA"
CHECKPOINTS = ("TrackNet_best.pt", "InpaintNet_best.pt")
MAX_CHECKPOINT_BYTES = 2 * 1024**3


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def reject_link(path):
    if path.is_symlink() or (
        path.exists()
        and getattr(path.lstat(), "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    ):
        raise ValueError(f"Refusing linked/reparse-point asset: {path}")


def copy_new(source, destination):
    """Exclusive creation also protects against a concurrent writer."""
    with source.open("rb") as source_stream:
        output = destination.open("xb")
        try:
            with output:
                shutil.copyfileobj(source_stream, output)
        except BaseException:
            destination.unlink()  # Only the file exclusively created above.
            raise


def extract_checkpoints(archive, staging):
    """Validate the complete member list, then stream allowlisted basenames only."""
    with zipfile.ZipFile(archive) as bundle:
        selected = {}
        for member in bundle.infolist():
            # ZipInfo normalizes backslashes (and truncates NULs) on Windows.
            # Validate the original name before using any normalized basename.
            name = member.orig_filename
            path = PurePosixPath(name)
            if (
                path.is_absolute()
                or "\\" in name
                or ":" in name
                or ".." in path.parts
                or "\x00" in name
            ):
                raise ValueError(f"Unsafe archive member: {name!r}")
            kind = stat.S_IFMT(member.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError(f"Non-regular archive member: {name!r}")
            if member.is_dir() or path.name not in CHECKPOINTS:
                continue
            if kind == stat.S_IFDIR or member.flag_bits & 1:
                raise ValueError(f"Invalid checkpoint member: {name!r}")
            if path.name in selected:
                raise ValueError(f"Duplicate checkpoint basename: {path.name}")
            if not 0 < member.file_size <= MAX_CHECKPOINT_BYTES:
                raise ValueError(f"Invalid checkpoint size: {name!r}")
            selected[path.name] = member
        if set(selected) != set(CHECKPOINTS):
            raise ValueError("Archive must contain exactly one of each required checkpoint basename")
        for name, member in selected.items():
            # No member paths are ever used as output paths. Reading to EOF checks ZIP CRC.
            with bundle.open(member) as source, (staging / name).open("xb") as output:
                shutil.copyfileobj(source, output)


def prepare(runtime, download=False):
    runtime = Path(runtime).absolute()
    ckpts = runtime / "ckpts"
    data = runtime / "data"
    for directory in (runtime, ckpts, data):
        reject_link(directory)
        directory.mkdir(parents=True, exist_ok=True)
    archive = data / "TrackNetV3_ckpts.zip"
    manifest_path = ckpts / "provenance.json"
    for path in (archive, manifest_path, *(ckpts / name for name in CHECKPOINTS)):
        reject_link(path)
        if path.exists() and not path.is_file():
            raise ValueError(f"Expected a regular file: {path}")

    manifest = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            manifest.get("source_repository") != SOURCE_REPOSITORY
            or manifest.get("source_commit") != SOURCE_COMMIT
            or manifest.get("download_id") != DOWNLOAD_ID
            or set(manifest.get("checkpoints", {})) != set(CHECKPOINTS)
        ):
            raise ValueError("Existing provenance does not match the pinned checkpoint source")

    existing = {}
    for name in CHECKPOINTS:
        path = ckpts / name
        if path.exists():
            if not 0 < path.stat().st_size <= MAX_CHECKPOINT_BYTES:
                raise ValueError(f"Invalid existing checkpoint size: {path}")
            existing[name] = sha256(path)
            if manifest and existing[name] != manifest["checkpoints"][name]["sha256"]:
                raise ValueError(f"Existing checkpoint differs from provenance: {name}")

    with tempfile.TemporaryDirectory(prefix="tracknet-checkpoints-", dir=data) as temporary:
        staging = Path(temporary)
        candidate = archive if archive.exists() else None
        downloaded = False
        if candidate is None and len(existing) != len(CHECKPOINTS):
            if not download:
                raise ValueError(f"Missing checkpoints and archive: {archive}; use --download")
            candidate = staging / archive.name
            subprocess.run(
                [sys.executable, "-m", "gdown", DOWNLOAD_ID, "--output", str(candidate)],
                check=True,
            )
            downloaded = True

        archive_hash = None
        if candidate is not None:
            archive_hash = sha256(candidate)
            if manifest and manifest.get("archive_sha256") not in (None, archive_hash):
                raise ValueError("Archive differs from recorded SHA256; leaving existing assets intact")
            extract_checkpoints(candidate, staging)
            hashes = {name: sha256(staging / name) for name in CHECKPOINTS}
            for name, digest in hashes.items():
                if name in existing and existing[name] != digest:
                    raise ValueError(f"Existing checkpoint differs from archive: {name}; refusing overwrite")
                if manifest and manifest["checkpoints"][name]["sha256"] != digest:
                    raise ValueError(f"Archive checkpoint differs from provenance: {name}")
        else:
            hashes = existing

        # All available evidence has been checked before publishing any missing assets.
        if downloaded:
            copy_new(candidate, archive)
        for name in CHECKPOINTS:
            if name not in existing:
                copy_new(staging / name, ckpts / name)
        if manifest is None:
            record = {
                "schema_version": 1,
                "source_repository": SOURCE_REPOSITORY,
                "source_commit": SOURCE_COMMIT,
                "download_id": DOWNLOAD_ID,
                "source_url": f"https://drive.google.com/file/d/{DOWNLOAD_ID}/view",
                "archive_sha256": archive_hash,
                "verification": "archive-matched" if archive_hash else "existing-local-hashes-only",
                "checkpoints": {
                    name: {"sha256": hashes[name], "bytes": (ckpts / name).stat().st_size}
                    for name in CHECKPOINTS
                },
            }
            staged_manifest = staging / manifest_path.name
            staged_manifest.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            copy_new(staged_manifest, manifest_path)
        print(f"Verified checkpoints: {ckpts}")
        print(f"Provenance: {manifest_path}")
        if candidate is None:
            print("No archive available; hashes describe existing local files, not authenticated upstream bytes.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-dir", required=True, type=Path)
    parser.add_argument("--download", action="store_true", help="Download only if a checkpoint and archive are missing")
    args = parser.parse_args()
    try:
        prepare(args.runtime_dir, args.download)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Checkpoint setup failed: {error}\n")


if __name__ == "__main__":
    main()
