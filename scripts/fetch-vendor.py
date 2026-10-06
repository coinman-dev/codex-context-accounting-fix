"""Download the matching official Codex platform package and verify its integrity."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import tarfile
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=["linux", "windows"])
    parser.add_argument("--version", default="0.159.2")
    args = parser.parse_args()
    platform = "linux-x64" if args.platform == "linux" else "win32-x64"
    target = "x86_64-unknown-linux-musl" if args.platform == "linux" else "x86_64-pc-windows-msvc"
    root = Path(__file__).resolve().parents[1] / "build" / ("vendor-" + args.version + "-" + args.platform)
    if root.exists():
        raise FileExistsError(f"Vendor directory already exists: {root}")
    if not __import__('re').fullmatch(r"\d+\.\d+\.\d+", args.version):
        raise ValueError("Expected a numeric upstream version")
    meta_url = f"https://registry.npmjs.org/@openai%2fcodex/{args.version}-{platform}"
    metadata = json.load(urlopen(Request(meta_url, headers={"User-Agent": "codex-context-accounting-fix"}), timeout=30))
    assert metadata["name"] == "@openai/codex" and metadata["version"] == f"{args.version}-{platform}"
    archive = root.parent / f"codex-{args.version}-{platform}.tgz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    sha512 = hashlib.sha512()
    with urlopen(metadata["dist"]["tarball"], timeout=60) as response, archive.open("xb") as output:
        for block in iter(lambda: response.read(1024 * 1024), b""):
            output.write(block)
            sha512.update(block)
    integrity = "sha512-" + base64.b64encode(sha512.digest()).decode("ascii")
    if integrity != metadata["dist"]["integrity"]:
        raise ValueError("The downloaded package failed SHA-512 verification")
    root.mkdir()
    with tarfile.open(archive, "r:gz") as package:
        package.extractall(root, filter="data")
    vendor = root / "package/vendor" / target
    package_info = json.loads((vendor / "codex-package.json").read_text(encoding="utf-8"))
    assert package_info["version"] == args.version
    print(vendor)


if __name__ == "__main__":
    main()
