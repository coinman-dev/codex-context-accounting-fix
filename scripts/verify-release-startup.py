"""Check actual release archives through installed Zed adapters in private profiles."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--wsl-distro', default='Ubuntu')
    args = parser.parse_args()
    fixture = ROOT / 'build' / ('release-startup-' + uuid.uuid4().hex)
    home = fixture / 'home with spaces'
    local = home / 'AppData/Local'
    local.mkdir(parents=True)
    target = Path(os.environ['LOCALAPPDATA']) / 'Zed'
    link = local / 'Zed'
    quote = lambda value: "'" + str(value).replace("'", "''") + "'"
    subprocess.run(['powershell.exe', '-NoProfile', '-Command',
                    f'New-Item -ItemType Junction -Path {quote(link)} -Target {quote(target)} | Out-Null'], check=True, capture_output=True)
    setup = '''set -eu
test_home="$HOME/Development/codex-context-accounting-fix/build/''' + fixture.name + '''"
mkdir -p "$test_home/.codex" "$test_home/.local/share" "$test_home/.config/zed"
ln -s "$HOME/.local/share/zed" "$test_home/.local/share/zed"
printf '%s\n' '{"theme":"test"}' > "$test_home/.config/zed/settings.json"
printf '%s' "$test_home"
'''
    remote = subprocess.run(['wsl.exe', '-d', args.wsl_distro, '--', 'bash', '-s'], input=setup.encode(), capture_output=True, check=True).stdout.decode().strip()
    if any(char in remote for char in '\"\'`$\r\n '):
        raise ValueError('The private WSL path contains shell metacharacters')
    injected = '$wslScript = $wslScript.Replace("set -eu", "set -eu`nexport HOME=' + remote + '`nexport CODEX_HOME=' + remote + '/.codex")\n'
    script = fixture / 'install-test.ps1'
    script.write_text((ROOT / 'install.ps1').read_text().replace('function Invoke-WslAction', injected + 'function Invoke-WslAction'), encoding='utf-8')
    env = {**os.environ, 'HOME': str(home), 'USERPROFILE': str(home), 'CODEX_HOME': str(home / '.codex'),
           'APPDATA': str(home / 'AppData/Roaming'), 'LOCALAPPDATA': str(local),
           'PSModuleAnalysisCachePath': str(fixture / 'ModuleAnalysisCache')}
    base = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)]

    def run(*options):
        result = subprocess.run(base + list(options), env=env, capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace'))
        print(result.stdout.decode(errors='replace').strip())

    try:
        run('-Distro', args.wsl_distro, '-SkipCli', '-AssetDirectory', str(args.assets.resolve()))
        proof = json.loads((home / '.codex/context-accounting-fix/startup-validation.json').read_text())
        assert proof['app_server'] == 'passed' and proof['acp'] in ('passed', 'authentication-required')
        command = 'cat ' + remote + '/.codex/context-accounting-fix/startup-validation.json\n'
        remote_proof = json.loads(subprocess.run(['wsl.exe', '-d', args.wsl_distro, '--', 'bash', '-s'], input=command.encode(), capture_output=True, check=True).stdout)
        assert remote_proof['app_server'] == 'passed' and remote_proof['acp'] in ('passed', 'authentication-required')
        (fixture / 'proof.json').write_text(json.dumps({'windows': proof, 'wsl': remote_proof}, indent=2))
        run('-Distro', args.wsl_distro, '-Check')
    finally:
        if (home / '.codex/context-accounting-fix/last-powershell-install.json').exists():
            run('-Rollback')
    print('Release archives: Windows and WSL app-server + stock ACP startup verified; unauthenticated profiles report sign-in required; no inference requests.')


if __name__ == '__main__':
    main()
