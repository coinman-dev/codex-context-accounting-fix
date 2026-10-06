"""Download the upstream-pinned V8 archive and bindings for a release build."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    version = subprocess.check_output(
        ['python3' if os.name != 'nt' else 'python', str(source / '.github/scripts/rusty_v8_bazel.py'),
         'resolved-v8-crate-version'], cwd=source, text=True).strip()
    profile = 'ptrcomp_sandbox_release'
    stem = f'{profile}_{args.target}'
    manifest_name = f'rusty_v8_{stem}.sha256'
    trusted = source / f'third_party/v8/rusty_v8_{version.replace(".", "_")}_release_manifests.sha256'
    hashes = dict((line.split()[1], line.split()[0]) for line in trusted.read_text().splitlines())
    destination = source.parent / 'v8' / args.target
    destination.mkdir(parents=True, exist_ok=True)
    base = f'https://github.com/openai/codex/releases/download/rusty-v8-v{version}/'
    manifest = urlopen(base + manifest_name, timeout=60).read()
    if hashlib.sha256(manifest).hexdigest() != hashes[manifest_name]:
        raise ValueError('V8 manifest checksum mismatch')
    files = dict((line.split()[1], line.split()[0]) for line in manifest.decode().splitlines())
    for name, expected in files.items():
        if Path(name).name != name:
            raise ValueError('Invalid V8 asset name')
        target = destination / name
        with urlopen(base + name, timeout=120) as response, target.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise ValueError(f'V8 checksum mismatch: {name}')
    archive_name = f'rusty_v8_{stem}.lib.gz' if 'windows' in args.target else f'librusty_v8_{stem}.a.gz'
    values = {'RUSTY_V8_ARCHIVE': str(destination / archive_name),
              'RUSTY_V8_SRC_BINDING_PATH': str(destination / f'src_binding_{stem}.rs')}
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as output:
        for name, value in values.items():
            output.write(f'{name}={value}\n')
    print('Verified upstream V8 assets:', args.target)


if __name__ == '__main__':
    main()
