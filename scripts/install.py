"""Stage a verified Codex build and a portable Node preload for codex-acp."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--preload', type=Path, required=True)
    parser.add_argument('--patch', type=Path, required=True)
    parser.add_argument('--vendor-root', type=Path)
    args = parser.parse_args()
    assert args.binary.is_file() and args.preload.is_file() and args.patch.is_file()
    windows = os.name == 'nt'
    user_dir = Path.home()
    root = user_dir / '.codex/context-accounting-fix'
    patch_hash = digest(args.patch)
    version = '0.159.2-reasoning-' + patch_hash[:10]
    release_dir = root / version
    assert not release_dir.exists(), 'Inspect the existing release before overwriting it'
    release_dir.mkdir(parents=True)
    executable = release_dir / 'bin' / ('codex.exe' if windows else 'codex')
    zed_dir = Path(os.environ['LOCALAPPDATA']) / 'Zed' if windows else user_dir / '.local/share/zed'
    target = 'x86_64-pc-windows-msvc' if windows else 'x86_64-unknown-linux-musl'
    pkg = 'codex-win32-x64' if windows else 'codex-linux-x64'
    official_root = args.vendor_root or zed_dir / f'external_agents/registry/npx/codex-acp/node_modules/@openai/{pkg}/vendor/{target}'
    package = json.loads((official_root / 'codex-package.json').read_text(encoding='utf-8'))
    assert package['version'] == '0.159.2', 'Use helper resources matching the patched source version'
    (release_dir / 'bin').mkdir()
    helpers = []
    for item in official_root.iterdir():
        if item.name == 'bin':
            for helper in item.iterdir():
                if helper.is_file() and helper.name != executable.name:
                    shutil.copy2(helper, release_dir / 'bin' / helper.name)
                    helpers.append(helper.name)
        elif item.is_dir():
            shutil.copytree(item, release_dir / item.name)
        elif item.is_file():
            shutil.copy2(item, release_dir / item.name)
    shutil.copy2(args.binary, executable)
    if not windows:
        executable.chmod(0o755)
    assert digest(args.binary) == digest(executable)
    built_target = 'x86_64-pc-windows-msvc' if windows else 'x86_64-unknown-linux-gnu'
    package['target'] = built_target
    (release_dir / 'codex-package.json').write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
    result = subprocess.run(
        [str(executable), '--version'], capture_output=True, text=True, timeout=20, check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if windows else 0,
    )
    assert result.stdout.strip() == 'codex-cli 0.159.2'
    shutil.copy2(args.patch, release_dir / 'source.patch')
    manifest = {
        'executable': executable.relative_to(root).as_posix(),
        'version': version,
        'upstream_commit': 'ff6aec96948b70d94983af2641a6b67c94faeff5',
        'binary_sha256': digest(executable),
        'patch_sha256': patch_hash,
        'installed_at': datetime.now(timezone.utc).isoformat(),
        'platform': 'Windows' if windows else 'Ubuntu',
        'build_target': built_target,
        'official_helper_target': target,
        'official_helper_files': helpers,
    }
    # Resolve the preload through built-in modules and an absolute home path;
    # do not allow a project-local node_modules package to shadow the loader.
    shutil.copy2(args.preload, root / 'preload.cjs')
    bootstrap = (
        'import{homedir}from"node:os";import{join}from"node:path";'
        'import{pathToFileURL}from"node:url";'
        'await import(pathToFileURL(join(homedir(),".codex","context-accounting-fix","preload.cjs")).href);'
    )
    option = '--import=data:text/javascript,' + quote(bootstrap, safe='') + '#codex-context-accounting-fix'
    (root / 'bootstrap-source.mjs').write_text(bootstrap + '\n', encoding='utf-8')
    (root / 'node-options.txt').write_text(option + '\n', encoding='utf-8')
    temp = root / 'current.json.tmp'
    temp.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, root / 'current.json')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
