#requires -Version 5.1
<#
.SYNOPSIS
Install the patched Codex 0.160.0 for Windows and existing WSL2 Codex profiles.
.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\install.ps1
.EXAMPLE
.\install.ps1 -Distro Ubuntu -WslOnly
.EXAMPLE
.\install.ps1 -Rollback
#>
[CmdletBinding()]
param(
    [ValidatePattern('^v0\.160\.0-reasoning\.1$')][string]$Release = 'v0.160.0-reasoning.1',
    [string[]]$Distro,
    [switch]$WindowsOnly,
    [switch]$WslOnly,
    [switch]$SkipZed,
    [switch]$SkipCli,
    [switch]$Rollback,
    [switch]$Check,
    [string]$AssetDirectory
)
$ErrorActionPreference = 'Stop'
if ($WindowsOnly -and $WslOnly) { throw 'Choose either -WindowsOnly or -WslOnly.' }
if ($Rollback -and $Check) { throw 'Choose either -Rollback or -Check.' }
if ($env:OS -ne 'Windows_NT') { throw 'Run install.ps1 from Windows PowerShell.' }
$repo = 'coinman-dev/codex-context-accounting-fix'
$root = Join-Path $env:USERPROFILE '.codex\context-accounting-fix'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$transactionId = [guid]::NewGuid().ToString('N')

function Write-JsonFile($File, $Value) {
    $directory = Split-Path -Parent $File
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    [System.IO.File]::WriteAllText($File, ($Value | ConvertTo-Json -Depth 32), $utf8)
}
function Get-Sha256([string]$File) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Quote-ProcessArgument([string]$Value) {
    # CommandLineToArgvW quoting, including trailing backslashes in quoted paths.
    if ($Value -and $Value -notmatch '[\s"]') { return $Value }
    return '"' + ([regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
}
function Invoke-Captured([string]$Executable, [string[]]$Arguments, [string]$InputText = '') {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8
    $info.StandardErrorEncoding = $utf8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if ($InputText) { $process.StandardInput.Write($InputText.Replace("`r`n", "`n")) }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(180000)) { $process.Kill(); throw "Process timed out: $Executable" }
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "$Executable failed ($($process.ExitCode)): $errors$output" }
    return $output.Trim()
}
function Find-WindowsNode {
    $candidates = @()
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $zedNode = Join-Path $env:LOCALAPPDATA 'Zed\node'
    if (Test-Path -LiteralPath $zedNode) {
        $candidates += @(Get-ChildItem -LiteralPath $zedNode -Filter node.exe -Recurse -File | Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        try {
            $version = Invoke-Captured $candidate @('--version')
            if ($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { return $candidate }
        } catch { }
    }
    throw 'Node.js 20+ was not found. Launch the Codex agent in Zed once, or install Node.js, then run this script again.'
}
function Get-WslDistros {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return @() }
    $listing = & wsl.exe --list --verbose 2>$null
    if ($LASTEXITCODE -ne 0) { return @() }
    $names = @()
    foreach ($line in $listing) {
        $clean = ([string]$line).Replace([string][char]0, '').Trim()
        if ($clean -match '^\*?\s*(.+?)\s+\S+\s+2\s*$') {
            $name = $Matches[1].Trim()
            if ($name -notlike 'docker-desktop*') { $names += $name }
        }
    }
    return $names
}

# JSON is passed on stdin as base64, never interpolated as shell code.
$wslScript = @'
set -eu
python3 - '__PAYLOAD__' <<'PY'
import base64, ctypes, glob, hashlib, json, os, pathlib, shutil, subprocess, sys, zipfile
p = json.loads(base64.b64decode(sys.argv[1]))
home = pathlib.Path.home()
root = home / '.codex/context-accounting-fix'
if os.uname().machine != 'x86_64':
    raise SystemExit('This prerelease supports x86_64 WSL2 only')
candidates = [shutil.which('node')] + sorted(glob.glob(str(home / '.local/share/zed/node/**/node'), recursive=True), reverse=True)
node = None
for candidate in candidates:
    if not candidate or not os.access(candidate, os.X_OK):
        continue
    try:
        major = int(subprocess.check_output([candidate, '--version'], text=True).strip().lstrip('v').split('.')[0])
        if major >= 20:
            node = candidate
            break
    except (OSError, ValueError, subprocess.CalledProcessError):
        pass
existing = (home / '.codex').is_dir() or shutil.which('codex') is not None
if p['operation'] == 'preflight':
    if not existing and not p.get('explicit', False):
        print(json.dumps({'skip': True, 'reason': 'No existing Codex profile'}))
        raise SystemExit(0)
    if not node:
        raise SystemExit('Node.js 20+ is required in this WSL distro; launch its Codex agent in Zed once or install Node.js')
    glibc = subprocess.check_output(['getconf', 'GNU_LIBC_VERSION'], text=True).strip().split()[-1]
    if tuple(map(int, glibc.split('.')[:2])) < (2, 35):
        raise SystemExit('This Linux build requires glibc 2.35+ (Ubuntu 22.04 or newer)')
    for library in ('libssl.so.3', 'libcrypto.so.3', 'libcap.so.2'):
        ctypes.CDLL(library)
    print(json.dumps({'skip': False, 'node': node, 'home': str(home), 'glibc': glibc}))
    raise SystemExit(0)
if not node:
    raise SystemExit('Node.js 20+ is required')
if p['operation'] == 'prepare':
    windows = pathlib.Path(subprocess.check_output(['wslpath', '-u', p['cache']], text=True).strip())
    cache = root / 'downloads' / p['release']
    cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((windows / 'release.json').read_text(encoding='utf-8-sig'))
    for name in ('install-helper.cjs', 'preload.cjs', p['archive']):
        source = windows / name
        destination = cache / name
        expected = manifest['assets'][name]['sha256']
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise SystemExit('WSL transfer checksum mismatch: ' + name)
        shutil.copyfile(source, destination)
    package = cache / 'package'
    package.mkdir(exist_ok=True)
    with zipfile.ZipFile(cache / p['archive']) as archive:
        for item in archive.infolist():
            target = (package / item.filename).resolve()
            target.relative_to(package.resolve())
            if '\\' in item.filename or item.filename.startswith('/') or '..' in pathlib.PurePosixPath(item.filename).parts:
                raise SystemExit('Unsafe archive path')
        archive.extractall(package)
    request = {'operation': 'prepare', 'transactionId': p['transactionId'], 'packageDir': str(package),
               'assetsDir': str(cache), 'connectZed': p['connectZed'], 'installCli': p['installCli']}
    helper = cache / 'install-helper.cjs'
else:
    helper = root / 'install-helper.cjs'
    if not helper.is_file() and p.get('release'):
        helper = root / 'downloads' / p['release'] / 'install-helper.cjs'
    request = {'operation': p['operation']}
    if p.get('transactionId'):
        request['transactionId'] = p['transactionId']
request_file = root / 'downloads' / ('request-' + p.get('transactionId', 'check') + '.json')
request_file.parent.mkdir(parents=True, exist_ok=True)
request_file.write_text(json.dumps(request))
result = subprocess.run([node, str(helper), str(request_file)], text=True, capture_output=True)
if result.returncode:
    raise SystemExit(result.stderr + result.stdout)
print(result.stdout.strip())
PY
'@
function Invoke-WslAction([string]$Name, $Payload) {
    $encoded = [Convert]::ToBase64String($utf8.GetBytes(($Payload | ConvertTo-Json -Depth 20 -Compress)))
    $script = $wslScript.Replace('__PAYLOAD__', $encoded)
    $text = Invoke-Captured 'wsl.exe' @('-d', $Name, '--', 'bash', '-s') $script
    return ($text | ConvertFrom-Json)
}
function Invoke-WindowsAction($Node, $Helper, $Payload) {
    $request = Join-Path $root ('downloads\request-' + $transactionId + '.json')
    Write-JsonFile $request $Payload
    $text = Invoke-Captured $Node @($Helper, $request)
    return ($text | ConvertFrom-Json)
}
function Get-Asset([string]$Name, $Manifest, [string]$Cache) {
    if ($Name -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid release asset name.' }
    $entry = $Manifest.assets.PSObject.Properties[$Name]
    if (-not $entry -or $entry.Value.sha256 -notmatch '^[a-f0-9]{64}$') { throw "Missing checksum: $Name" }
    $destination = Join-Path $Cache $Name
    $expected = $entry.Value.sha256
    if (Test-Path -LiteralPath $destination) {
        if ((Get-Sha256 $destination) -eq $expected) { return $destination }
        if ($AssetDirectory) { throw "Offline asset checksum mismatch: $Name" }
    }
    Write-Host "Downloading $Name ..."
    $temporary = $destination + '.download-' + $transactionId
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/releases/download/$Release/$Name" -OutFile $temporary
    if ((Get-Sha256 $temporary) -ne $expected) { throw "Download checksum mismatch: $Name" }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    return $destination
}

$statePath = Join-Path $root 'last-powershell-install.json'
$node = $null
if (-not $WslOnly) { $node = Find-WindowsNode }
if ($Rollback) {
    if (-not (Test-Path -LiteralPath $statePath)) { throw 'No PowerShell installation record was found.' }
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    foreach ($name in $state.wsl) {
        Invoke-WslAction $name @{operation='rollback-check'; transactionId=$state.transactionId; release=$state.release} | Out-Null
    }
    if ($state.windows) {
        if (-not $node) { $node = Find-WindowsNode }
        $helper = Join-Path $root 'install-helper.cjs'
        if (-not (Test-Path -LiteralPath $helper)) { $helper = Join-Path $root ('downloads\' + $state.release + '\install-helper.cjs') }
        Invoke-WindowsAction $node $helper @{operation='rollback-check'; transactionId=$state.transactionId} | Out-Null
    }
    foreach ($name in $state.wsl) {
        Write-Host "Rolling back WSL2: $name"
        Invoke-WslAction $name @{operation='rollback'; transactionId=$state.transactionId; release=$state.release} | Out-Null
    }
    if ($state.windows) {
        if (-not $node) { $node = Find-WindowsNode }
        $helper = Join-Path $root 'install-helper.cjs'
        if (-not (Test-Path -LiteralPath $helper)) { $helper = Join-Path $root ('downloads\' + $state.release + '\install-helper.cjs') }
        Invoke-WindowsAction $node $helper @{operation='rollback'; transactionId=$state.transactionId} | Out-Null
    }
    if ($state.pathChanged) {
        $current = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($current -eq $state.pathAfter) { [Environment]::SetEnvironmentVariable('Path', $state.pathBefore, 'User') }
        else { Write-Warning 'User PATH changed after installation; its current value was preserved.' }
        $env:Path = ($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ne (Join-Path $root 'bin').TrimEnd('\') }) -join ';'
    }
    if ($state.previousStateFile) { [System.IO.File]::WriteAllText($statePath, [System.IO.File]::ReadAllText($state.previousStateFile), $utf8) }
    else { Remove-Item -LiteralPath $statePath }
    Write-Host 'Rollback completed. Reload the Codex agent in Zed and open a new terminal.'
    return
}

$available = @()
if (-not $WindowsOnly) { $available = @(Get-WslDistros) }
if ($Distro) {
    foreach ($name in $Distro) { if ($name -notin $available) { throw "WSL2 distro not found: $name" } }
    $available = @($Distro)
}
$targets = @()
foreach ($name in $available) {
    $info = Invoke-WslAction $name @{operation='preflight'; explicit=[bool]$Distro}
    if ($info.skip) { Write-Host "Skipping WSL2 $name : $($info.reason)" }
    else { $targets += $name; Write-Host "Found WSL2 $name (glibc $($info.glibc))" }
}
if ($WslOnly -and $targets.Count -eq 0) { throw 'No supported WSL2 Codex profiles were found.' }
if ($Check) {
    if ($node) { Invoke-WindowsAction $node (Join-Path $root 'install-helper.cjs') @{operation='probe'} | Format-List }
    foreach ($name in $targets) { Invoke-WslAction $name @{operation='probe'} | Format-List }
    return
}
if (-not $WslOnly) {
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ne 'AMD64') { throw 'This prerelease supports Windows x64 only.' }
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($AssetDirectory) { $cache = (Resolve-Path -LiteralPath $AssetDirectory).Path }
else {
    $cache = Join-Path $root ('downloads\' + $Release)
    [System.IO.Directory]::CreateDirectory($cache) | Out-Null
    $manifestTemp = Join-Path $cache ('release-' + $transactionId + '.json')
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/releases/download/$Release/release.json" -OutFile $manifestTemp
    Move-Item -LiteralPath $manifestTemp -Destination (Join-Path $cache 'release.json') -Force
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $cache 'release.json') | ConvertFrom-Json
if ($manifest.schema -ne 1 -or $manifest.tag -ne $Release -or $manifest.upstream_version -ne '0.160.0') { throw 'Unexpected release manifest.' }
$helper = Get-Asset 'install-helper.cjs' $manifest $cache
Get-Asset 'preload.cjs' $manifest $cache | Out-Null
$windowsArchive = 'codex-0.160.0-reasoning-windows-x64.zip'
$linuxArchive = 'codex-0.160.0-reasoning-linux-x64.zip'
if (-not $WslOnly) { $archive = Get-Asset $windowsArchive $manifest $cache }
if ($targets.Count) { Get-Asset $linuxArchive $manifest $cache | Out-Null }
$preparedWindows = $false
$preparedWsl = @()
$previousState = $null
if (Test-Path -LiteralPath $statePath) { $previousState = [System.IO.File]::ReadAllText($statePath) }
$pathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
$state = [ordered]@{transactionId=$transactionId; release=$Release; windows=$false; wsl=@(); pathBefore=$pathBefore; pathAfter=$pathBefore; pathChanged=$false; previousStateFile=$null; state='preparing'}
try {
    if (-not $WslOnly) {
        $package = Join-Path $cache ('package-windows-' + $transactionId)
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $package)
        $result = Invoke-WindowsAction $node $helper @{operation='prepare'; transactionId=$transactionId; packageDir=$package; assetsDir=$cache; connectZed=(-not $SkipZed); installCli=(-not $SkipCli)}
        $preparedWindows = $true
        $state.windows = $true
        Write-Host "Prepared Windows: $($result.version)"
    }
    foreach ($name in $targets) {
        $result = Invoke-WslAction $name @{operation='prepare'; transactionId=$transactionId; cache=$cache; release=$Release; archive=$linuxArchive; connectZed=(-not $SkipZed); installCli=(-not $SkipCli)}
        $preparedWsl += $name
        $state.wsl = @($preparedWsl)
        Write-Host "Prepared WSL2 $name : $($result.version)"
    }
    $state.state = 'prepared'
    if ($previousState) {
        $state.previousStateFile = Join-Path $root ('powershell-transactions\' + $transactionId + '\previous.json')
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $state.previousStateFile)) | Out-Null
        [System.IO.File]::WriteAllText($state.previousStateFile, $previousState, $utf8)
    }
    Write-JsonFile $statePath $state
    if ($preparedWindows) {
        $result = Invoke-WindowsAction $node $helper @{operation='commit'; transactionId=$transactionId}
        Write-Host "Windows startup checks passed (ACP: $($result.validation.acp))."
    }
    foreach ($name in $preparedWsl) {
        $result = Invoke-WslAction $name @{operation='commit'; transactionId=$transactionId; release=$Release}
        Write-Host "WSL2 $name startup checks passed (ACP: $($result.validation.acp))."
    }
    if ($preparedWindows -and -not $SkipCli) {
        $bin = Join-Path $root 'bin'
        $entries = @($pathBefore -split ';' | Where-Object { $_ })
        if (-not ($entries | Where-Object { $_.TrimEnd('\') -eq $bin.TrimEnd('\') })) {
            $state.pathAfter = (@($bin) + $entries) -join ';'
            $state.pathChanged = $true
            Write-JsonFile $statePath $state
            [Environment]::SetEnvironmentVariable('Path', $state.pathAfter, 'User')
        }
        $env:Path = $bin + ';' + $env:Path
    }
    $state.state = 'committed'
    Write-JsonFile $statePath $state
} catch {
    $failure = $_
    Write-Warning 'Installation failed. Restoring the prepared installations...'
    foreach ($name in $preparedWsl) {
        try { Invoke-WslAction $name @{operation='rollback'; transactionId=$transactionId; release=$Release} | Out-Null }
        catch { Write-Warning "WSL2 rollback needs attention: $_" }
    }
    if ($preparedWindows) {
        try { Invoke-WindowsAction $node $helper @{operation='rollback'; transactionId=$transactionId} | Out-Null }
        catch { Write-Warning "Windows rollback needs attention: $_" }
    }
    if ($state.pathChanged) { [Environment]::SetEnvironmentVariable('Path', $pathBefore, 'User') }
    if ($previousState) { [System.IO.File]::WriteAllText($statePath, $previousState, $utf8) }
    elseif (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    throw $failure
}
Write-Host "Installed $Release. Backups: $root\transactions\$transactionId"
Write-Host 'Reload the Codex agent in Zed after current work finishes, and open a new terminal for codex.'
