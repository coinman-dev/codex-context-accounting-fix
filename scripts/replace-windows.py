"""Replace a staged Windows Codex build while preserving its previous binary."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    if os.name != "nt":
        raise OSError("This replacement is for the Windows installation")
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    args = parser.parse_args()
    root = Path.home() / ".codex/context-accounting-fix"
    manifest_path = root / "current.json"
    original = manifest_path.read_bytes()
    manifest = json.loads(original)
    if manifest.get("platform") != "Windows" or not manifest["version"].startswith("0.159.2-reasoning-"):
        raise ValueError("Unexpected installed Codex version")
    target = (root / manifest["executable"]).resolve(strict=True)
    if target.parent != (root / manifest["version"] / "bin").resolve(strict=True) or target.name != "codex.exe":
        raise ValueError("The target path does not match the managed Windows installation")
    if sha256(target) != manifest["binary_sha256"]:
        raise ValueError("Installed binary changed since its manifest was written")
    if not args.binary.is_file():
        raise FileNotFoundError(args.binary)
    incoming_hash = sha256(args.binary)
    if incoming_hash == manifest["binary_sha256"]:
        raise ValueError("The replacement binary is identical to the installed one")
    version = subprocess.run([str(args.binary), "--version"], capture_output=True, text=True,
                             timeout=20, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
    if version.stdout.strip() != "codex-cli 0.159.2":
        raise ValueError("The replacement must be built from Codex 0.159.2")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = target.with_name(f"codex.exe.before-crlf-{stamp}.bak")
    staged = target.with_name(f"codex.exe.crlf-{stamp}.tmp")
    if backup.exists() or staged.exists():
        raise FileExistsError("Backup or staging filename already exists")
    shutil.copy2(target, backup)
    shutil.copy2(args.binary, staged)
    if sha256(staged) != incoming_hash or manifest_path.read_bytes() != original:
        raise RuntimeError("Files changed during staging; the installed executable was not replaced")
    os.replace(staged, target)
    try:
        version = subprocess.run([str(target), "--version"], capture_output=True, text=True,
                                 timeout=20, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
        if version.stdout.strip() != "codex-cli 0.159.2":
            raise ValueError("The replacement did not start correctly")
    except Exception:
        os.replace(backup, target)
        raise
    manifest["binary_sha256"] = incoming_hash
    manifest["windows_sql_migrations"] = "CRLF"
    manifest["previous_binary"] = str(backup.relative_to(root)).replace("\\", "/")
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    temporary_manifest = root / f"current.json.crlf-{stamp}.tmp"
    temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary_manifest, manifest_path)
    print(json.dumps({"version": manifest["version"], "binary_sha256": incoming_hash,
                      "backup": str(backup), "migration_line_endings": "CRLF"}, indent=2))


if __name__ == "__main__":
    main()
