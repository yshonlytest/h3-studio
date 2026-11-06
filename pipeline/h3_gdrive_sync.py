#!/usr/bin/env python3
"""Google Drive background sync module for H3 Studio with folder deduplication, timestamped naming, and non-blocking upload."""

from __future__ import annotations
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

LOGGER = logging.getLogger(__name__)
try:
    from pipeline.config import DEFAULT_GDRIVE_CACHE, DEFAULT_SCRATCH_DIR, get_gdrive_public_share
    CACHE_FILE = DEFAULT_GDRIVE_CACHE
except ImportError:
    DEFAULT_SCRATCH_DIR = Path("scratch")
    CACHE_FILE = DEFAULT_SCRATCH_DIR / "gdrive_folder_cache.json"

    def get_gdrive_public_share() -> bool:
        return False


@dataclass(frozen=True)
class GDriveUploadResult:
    ok: bool
    file_id: str | None = None
    web_url: str | None = None
    folder_id: str | None = None
    error: str | None = None
    timestamp: str = ""


def _find_gdrive_binary() -> str | None:
    agy_bin = Path(os.path.expanduser("~/.gemini/antigravity/bin/gdrive"))
    if agy_bin.is_file() and os.access(agy_bin, os.X_OK):
        return str(agy_bin)
    system_which = shutil.which("gdrive")
    if system_which:
        return system_which
    return None


def get_or_create_folder(folder_name: str = "H3-Studio") -> str | None:
    """Find existing folder or create one, caching its ID to avoid duplicate folders."""
    gdrive_bin = _find_gdrive_binary()
    if not gdrive_bin:
        LOGGER.warning("gdrive binary not found.")
        return None

    # Check local cache first:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if CACHE_FILE.is_file():
        try:
            cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            if folder_name in cache:
                return cache[folder_name]
        except Exception as e:
            LOGGER.warning(f"Failed to read folder cache: {e}")

    # Search Drive for existing folder by exact name:
    cmd_search = [gdrive_bin, "readonly", "search", "--name-exact", folder_name, "--type", "folder", "--json"]
    try:
        res = subprocess.run(cmd_search, capture_output=True, text=True, check=True, timeout=30.0)
        raw_text = res.stdout.strip()
        if raw_text:
            data = json.loads(raw_text)
            items = data if isinstance(data, list) else (data.get("files") or data.get("items") or [])
            if items and isinstance(items, list):
                folder_id = items[0].get("id")
                if folder_id:
                    _save_folder_cache(folder_name, folder_id)
                    return folder_id
    except Exception as err:
        LOGGER.warning(f"Error querying gdrive folder: {err}")

    # If not found, create new folder:
    cmd_mkdir = [gdrive_bin, "mutate", "mkdir", folder_name]
    try:
        res = subprocess.run(cmd_mkdir, capture_output=True, text=True, check=True, timeout=30.0)
        # e.g. "Created folder: H3-Studio (ID: <folder_id>)"
        folder_id = None
        for line in res.stdout.splitlines():
            if "(ID:" in line:
                folder_id = line.split("(ID:")[-1].replace(")", "").strip()
                break
        if not folder_id:
            # Fallback search again:
            folder_id = _extract_file_id_fallback(gdrive_bin, folder_name)
        if folder_id:
            _save_folder_cache(folder_name, folder_id)
            return folder_id
    except Exception as err:
        LOGGER.error(f"Failed to create gdrive folder {folder_name}: {err}")
    return None


def _save_folder_cache(folder_name: str, folder_id: str) -> None:
    cache = {}
    if CACHE_FILE.is_file():
        try:
            cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    cache[folder_name] = folder_id
    CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def sync_upload(
    file_path: Path,
    folder_name: str = "H3-Studio",
    make_public: bool | None = None,
) -> GDriveUploadResult:
    """Synchronously upload a file to Google Drive with deduplication and timestamped naming."""
    if make_public is None:
        make_public = get_gdrive_public_share()
    gdrive_bin = _find_gdrive_binary()
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    if not gdrive_bin:
        return GDriveUploadResult(ok=False, error="gdrive binary not installed", timestamp=now_str)

    target_path = Path(file_path).resolve()
    if not target_path.is_file():
        return GDriveUploadResult(ok=False, error=f"File not found: {target_path}", timestamp=now_str)

    folder_id = get_or_create_folder(folder_name)

    # Copy with timestamped name in scratch to avoid collision:
    scratch_dir = DEFAULT_SCRATCH_DIR / "gdrive_upload_staging"
    scratch_dir.mkdir(parents=True, exist_ok=True)
    staged_filename = f"{target_path.stem}_{now_str}{target_path.suffix}"
    staged_path = scratch_dir / staged_filename
    shutil.copy2(target_path, staged_path)

    # Upload command:
    cmd_upload = [gdrive_bin, "mutate", "upload", str(staged_path)]
    if folder_id:
        cmd_upload.extend(["--parent", folder_id])

    try:
        res = subprocess.run(cmd_upload, capture_output=True, text=True, check=True, timeout=180.0)
        # Parse ID from output: e.g. "Uploaded: filename (ID: 1Mx8Jq5gCK1ie4toOkO-818bsYf2_g1pQ)"
        file_id = None
        for line in res.stdout.splitlines():
            if "(ID:" in line:
                file_id = line.split("(ID:")[-1].replace(")", "").strip()
                break

        if not file_id:
            # Fallback search for recently uploaded file
            file_id = _extract_file_id_fallback(gdrive_bin, staged_filename)

        if not file_id:
            return GDriveUploadResult(ok=False, error="Failed to parse file ID from gdrive output", timestamp=now_str)

        # Make shareable if requested:
        web_url = None
        if make_public:
            cmd_share = [gdrive_bin, "mutate", "share", file_id, "--role", "reader", "--type", "anyone"]
            subprocess.run(cmd_share, capture_output=True, text=True, timeout=30.0)

            # Get Web URL only when public sharing is explicitly enabled:
            cmd_url = [gdrive_bin, "readonly", "url", file_id]
            res_url = subprocess.run(cmd_url, capture_output=True, text=True, timeout=30.0)
            if res_url.returncode == 0 and res_url.stdout.strip():
                web_url = res_url.stdout.strip()

        # Cleanup staged file:
        if staged_path.is_file():
            staged_path.unlink()

        return GDriveUploadResult(
            ok=True,
            file_id=file_id,
            web_url=web_url,
            folder_id=folder_id,
            timestamp=now_str,
        )
    except Exception as err:
        return GDriveUploadResult(ok=False, error=str(err), timestamp=now_str)


def _extract_file_id_fallback(gdrive_bin: str, filename: str) -> str | None:
    try:
        cmd = [gdrive_bin, "readonly", "search", "--name-exact", filename, "--json"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30.0)
        data = json.loads(res.stdout) if res.stdout.strip() else {}
        items = data.get("files") or data.get("items") or (data if isinstance(data, list) else [])
        if items:
            return items[0].get("id")
    except Exception as exc:
        LOGGER.debug("GDrive file ID fallback search failed for %s: %s", filename, exc)
    return None


def dispatch_async_upload(
    file_path: Path,
    folder_name: str = "H3-Studio",
    on_complete: callable | None = None,
) -> subprocess.Popen:
    """Non-blocking detached background process upload. Returns Popen handle immediately."""
    manifest_log = file_path.with_suffix(".gdrive.json")
    cmd = [sys.executable, "-m", "pipeline.h3_gdrive_sync", str(file_path.resolve()), folder_name]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    print(f"[GDrive Sync] ☁️ Spawned detached background upload process (PID: {proc.pid}) for {file_path.name}", flush=True)
    return proc


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_file = Path(sys.argv[1]).resolve()
        folder = sys.argv[2] if len(sys.argv) > 2 else "H3-Studio"
        r = sync_upload(test_file, folder_name=folder)
        manifest_log = test_file.with_suffix(".gdrive.json")
        manifest_log.write_text(json.dumps(asdict(r), indent=2), encoding="utf-8")
        status_msg = f"web_url={r.web_url}" if r.web_url else "backed up privately (sharing disabled)"
        print(f"GDrive Sync result for {test_file.name}: {status_msg if r.ok else r.error}")
    else:
        print("Usage: python3 -m pipeline.h3_gdrive_sync <file_path> [folder_name]")
