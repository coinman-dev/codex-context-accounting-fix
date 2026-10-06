"""Exercise the complete PS 5.1 installer offline in an isolated Windows profile."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def sha(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    if os.name != 'nt':
        raise OSError('This check runs on Windows')
    parser = argparse.ArgumentParser()
    parser.add_argument('--wsl-distro')
    args = parser.parse_args()
    test = ROOT / 'build' / ('powershell-test-' + uuid.uuid4().hex)
    package = test / 'package'
    home = test / 'home'
    assets = test / 'assets'
    assets.mkdir(parents=True)
    home.mkdir()
    vendor = ROOT / 'build/vendor-0.160.0-windows/package/vendor/x86_64-pc-windows-msvc'
    shutil.copytree(vendor, package)
    shutil.copy2(ROOT / 'patches/codex-0.159.2-reasoning-accounting.patch', package / 'source.patch')
    manifest = {'version': '0.160.0-reasoning.1', 'upstream_version': '0.160.0',
                'upstream_commit': 'a956835d020762cb2b570053af06f643a11c0ecc', 'platform': 'windows',
                'executable': 'bin/codex.exe', 'binary_sha256': sha(package / 'bin/codex.exe'),
                'patch_sha256': sha(package / 'source.patch'),
                'files': {p.relative_to(package).as_posix(): sha(p) for p in package.rglob('*') if p.is_file()}}
    (package / 'release-manifest.json').write_text(json.dumps(manifest))
    archive = assets / 'codex-0.160.0-reasoning-windows-x64.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for file in package.rglob('*'):
            if file.is_file():
                output.write(file, file.relative_to(package).as_posix())
    shutil.copy2(ROOT / 'scripts/install-helper.cjs', assets / 'install-helper.cjs')
    shutil.copy2(ROOT / 'bootstrap/preload.cjs', assets / 'preload.cjs')
    script = ROOT / 'install.ps1'
    flags = ['-WindowsOnly']
    if args.wsl_distro:
        linux = test / 'package-linux'
        linux_vendor = ROOT / 'build/vendor-0.160.0-linux/package/vendor/x86_64-unknown-linux-musl'
        shutil.copytree(linux_vendor, linux)
        shutil.copy2(package / 'source.patch', linux / 'source.patch')
        linux_manifest = {**manifest, 'platform': 'linux', 'executable': 'bin/codex',
                          'binary_sha256': sha(linux / 'bin/codex'),
                          'files': {p.relative_to(linux).as_posix(): sha(p) for p in linux.rglob('*') if p.is_file()}}
        (linux / 'release-manifest.json').write_text(json.dumps(linux_manifest))
        with zipfile.ZipFile(assets / 'codex-0.160.0-reasoning-linux-x64.zip', 'w', zipfile.ZIP_DEFLATED) as output:
            for file in linux.rglob('*'):
                if file.is_file():
                    output.write(file, file.relative_to(linux).as_posix())
        # Redirect only the test's WSL shell to a private home. The shipped script has no such override.
        setup = 'test_home="$HOME/Development/codex-context-accounting-fix/build/wsl-' + test.name + '"\nmkdir -p "$test_home/.codex"\nprintf "%s" "$test_home"\n'
        remote = subprocess.run(['wsl.exe', '-d', args.wsl_distro, '--', 'bash', '-s'], input=setup.encode(), capture_output=True, check=True).stdout.decode().strip()
        if any(char in remote for char in '\"\'`$\r\n '):
            raise ValueError('Use a WSL home path without shell metacharacters for this test')
        injected = '$wslScript = $wslScript.Replace("set -eu", "set -eu`nexport HOME=' + remote + '`nexport CODEX_HOME=' + remote + '/.codex")\n'
        script = test / 'install-test.ps1'
        script.write_text((ROOT / 'install.ps1').read_text().replace('function Invoke-WslAction', injected + 'function Invoke-WslAction'), encoding='utf-8')
        flags = ['-Distro', args.wsl_distro]
    metadata = {'schema': 1, 'tag': 'v0.160.0-reasoning.1', 'upstream_version': '0.160.0',
                'assets': {p.name: {'sha256': sha(p)} for p in assets.iterdir()}}
    (assets / 'release.json').write_text(json.dumps(metadata))
    env = {**os.environ, 'HOME': str(home), 'USERPROFILE': str(home), 'CODEX_HOME': str(home / '.codex'),
           'APPDATA': str(home / 'AppData/Roaming'), 'LOCALAPPDATA': str(home / 'AppData/Local')}
    Path(env['LOCALAPPDATA']).mkdir(parents=True)
    env['PSModuleAnalysisCachePath'] = str(home / 'ModuleAnalysisCache')
    settings = Path(env['APPDATA']) / 'Zed/settings.json'
    settings.parent.mkdir(parents=True)
    original = '// existing settings\n{"theme":"test",}\n'
    settings.write_text(original)
    base = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)]

    def run(*args):
        result = subprocess.run(base + list(args), env=env, capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace'))
        print(result.stdout.decode(errors='replace').strip())

    run(*flags, '-SkipCli', '-AssetDirectory', str(assets))
    current = home / '.codex/context-accounting-fix/current.json'
    installed = current.read_bytes()
    assert json.loads(installed)['version'] == '0.160.0-reasoning.1'
    run(*flags, '-Check')
    run(*flags, '-SkipCli', '-AssetDirectory', str(assets))
    run('-Rollback')
    assert current.read_bytes() == installed
    run('-Rollback')
    assert not current.exists()
    assert settings.read_text() == original
    if args.wsl_distro:
        # WSL fails after Windows was activated: the PowerShell coordinator must restore both.
        broken = "printf '%s\\n' 'model = [' > " + remote + '/.codex/config.toml\n'
        subprocess.run(['wsl.exe', '-d', args.wsl_distro, '--', 'bash', '-s'], input=broken.encode(), capture_output=True, check=True)
        result = subprocess.run(base + flags + ['-SkipCli', '-AssetDirectory', str(assets)], env=env, capture_output=True, timeout=180)
        assert result.returncode != 0, 'An invalid WSL profile must fail the whole installation'
        assert not current.exists() and settings.read_text() == original, 'Windows must roll back after a WSL startup failure'
        subprocess.run(['wsl.exe', '-d', args.wsl_distro, '--', 'bash', '-s'],
                       input=('test ! -e ' + remote + '/.codex/context-accounting-fix/current.json\n').encode(), capture_output=True, check=True)
        print('Cross-platform startup failure: Windows and WSL both restored automatically.')
    # Transport must reject tampered assets before activation.
    with (assets / 'preload.cjs').open('ab') as file:
        file.write(b'// tampered\n')
    result = subprocess.run(base + ['-WindowsOnly', '-SkipCli', '-AssetDirectory', str(assets)], env=env, capture_output=True, timeout=60)
    assert result.returncode != 0 and b'checksum mismatch' in result.stderr
    assert not current.exists()
    print('PowerShell 5.1: installation, startup checks, repeat installation, two rollbacks, and tamper rejection passed.')


if __name__ == '__main__':
    main()
