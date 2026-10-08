"""Assemble download metadata after both platform artifacts pass their checks."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'build/dist'
TAG = 'v0.160.0-reasoning.1'


def sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    assets = {}
    platforms = {}
    for platform in ('windows', 'linux'):
        name = f'codex-0.160.0-reasoning-{platform}-x64.zip'
        archive = DIST / name
        with zipfile.ZipFile(archive) as package:
            manifest = json.loads(package.read('release-manifest.json'))
            if manifest['version'] != TAG[1:] or manifest['platform'] != platform:
                raise ValueError('Unexpected platform archive')
            for file, expected in manifest['files'].items():
                if hashlib.sha256(package.read(file)).hexdigest() != expected:
                    raise ValueError('Archive file checksum mismatch: ' + file)
            patch = ROOT / 'patches/codex-0.159.2-reasoning-accounting.patch'
            if sha(patch) != manifest['patch_sha256']:
                raise ValueError('Archive patch differs from the checked-in patch')
        assets[name] = {'sha256': sha(archive), 'bytes': archive.stat().st_size}
        platforms[platform] = {'build_target': manifest['build_target'], 'binary_sha256': manifest['binary_sha256']}
    for source, name in ((ROOT / 'install.ps1', 'install.ps1'),
                         (ROOT / 'scripts/install-helper.cjs', 'install-helper.cjs'),
                         (ROOT / 'scripts/cleanup.cjs', 'cleanup.cjs'),
                         (ROOT / 'bootstrap/preload.cjs', 'preload.cjs'),
                         (ROOT / 'patches/codex-0.159.2-reasoning-accounting.patch', 'source.patch')):
        destination = DIST / name
        shutil.copy2(source, destination)
        assets[name] = {'sha256': sha(destination), 'bytes': destination.stat().st_size}
    release = {'schema': 1, 'tag': TAG, 'upstream_version': '0.160.0',
               'upstream_commit': 'a956835d020762cb2b570053af06f643a11c0ecc',
               'patch_sha256': sha(ROOT / 'patches/codex-0.159.2-reasoning-accounting.patch'),
               'requirements': {'windows': 'Windows 10/11 x64, PowerShell 5.1+, Node.js 20+ (Zed copy is supported)',
                                'wsl': 'WSL2 x86_64, glibc 2.35+, libssl.so.3, libcap.so.2, Python 3, Node.js 20+'},
               'platforms': platforms, 'assets': assets}
    (DIST / 'release.json').write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
    checksums = {name: data['sha256'] for name, data in assets.items()}
    checksums['release.json'] = sha(DIST / 'release.json')
    (DIST / 'SHA256SUMS').write_text(''.join(f'{value}  {name}\n' for name, value in sorted(checksums.items())), encoding='utf-8')
    print(json.dumps(release, indent=2))


if __name__ == '__main__':
    main()
