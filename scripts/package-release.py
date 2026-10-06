"""Bundle a patched CLI with the matching official platform resources."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.160.0'
COMMIT = 'a956835d020762cb2b570053af06f643a11c0ecc'
TAG = 'v0.160.0-reasoning.1'


def sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['windows', 'linux'], required=True)
    parser.add_argument('--binary', required=True, type=Path)
    args = parser.parse_args()
    windows = args.platform == 'windows'
    target = 'x86_64-pc-windows-msvc' if windows else 'x86_64-unknown-linux-gnu'
    helper_target = target if windows else 'x86_64-unknown-linux-musl'
    vendor = ROOT / f'build/vendor-{VERSION}-{args.platform}/package/vendor/{helper_target}'
    package = json.loads((vendor / 'codex-package.json').read_text())
    if package['version'] != VERSION:
        raise ValueError('Official helper version mismatch')
    dist = ROOT / 'build/dist'
    dist.mkdir(parents=True, exist_ok=True)
    stage = ROOT / f'build/package-{args.platform}'
    if stage.exists():
        raise FileExistsError(stage)
    shutil.copytree(vendor, stage)
    binary = stage / 'bin' / ('codex.exe' if windows else 'codex')
    shutil.copy2(args.binary, binary)
    binary.chmod(0o755)
    if subprocess.check_output([str(binary), '--version'], text=True).strip() != f'codex-cli {VERSION}':
        raise ValueError('Unexpected CLI version')
    package['target'] = target
    (stage / 'codex-package.json').write_text(json.dumps(package, indent=2) + '\n')
    patch = ROOT / 'patches/codex-0.159.2-reasoning-accounting.patch'
    shutil.copy2(patch, stage / 'source.patch')
    shutil.copy2(ROOT / 'LICENSE', stage / 'LICENSE')
    manifest = {'version': TAG.removeprefix('v'), 'upstream_version': VERSION,
                'upstream_commit': COMMIT, 'platform': args.platform, 'build_target': target,
                'patch_sha256': sha(patch), 'binary_sha256': sha(binary),
                'executable': 'bin/' + binary.name,
                'files': {p.relative_to(stage).as_posix(): sha(p) for p in sorted(stage.rglob('*')) if p.is_file()}}
    (stage / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = dist / f'codex-{VERSION}-reasoning-{args.platform}-x64.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                output.write(path, path.relative_to(stage).as_posix())
    (dist / (archive.name + '.sha256')).write_text(f'{sha(archive)}  {archive.name}\n')
    print(archive)


if __name__ == '__main__':
    main()
