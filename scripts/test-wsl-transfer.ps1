#requires -Version 5.1
param([string]$TestDistro = 'Ubuntu', [string]$TestCache)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$source = [System.IO.File]::ReadAllText((Join-Path $project 'install.ps1'))
$prefix = $source.Substring(0, $source.IndexOf('$statePath ='))
Invoke-Expression $prefix
$Release = 'v0.160.0-reasoning.1'
if (-not $TestCache) { $TestCache = Join-Path $env:USERPROFILE '.codex\context-accounting-fix\downloads\v0.160.0-reasoning.1' }
$setup = 'test_home="$HOME/Development/codex-context-accounting-fix/build/wsl-transfer-' + [guid]::NewGuid().ToString('N') + '"' + "`n" + 'mkdir -p "$test_home/.codex"' + "`n" + 'printf "%s" "$test_home"' + "`n"
$privateHome = Invoke-Captured 'wsl.exe' @('-d', $TestDistro, '--', 'bash', '-s') $setup
if ($privateHome -match '[\s"''`$]') { throw 'Use a test home without shell metacharacters.' }
$wslScript = $wslScript.Replace('set -eu', "set -eu`nexport HOME=$privateHome`nexport CODEX_HOME=$privateHome/.codex")
$metadata = Get-Content -Raw -LiteralPath (Join-Path $TestCache 'release.json') | ConvertFrom-Json
$archive = 'codex-0.160.0-reasoning-linux-x64.zip'
Send-WslAssets $TestDistro $TestCache $metadata $archive
$hashes = [ordered]@{'release.json'=(Get-Sha256 (Join-Path $TestCache 'release.json'))}
foreach ($name in @('install-helper.cjs', 'preload.cjs', $archive)) { $hashes[$name] = $metadata.assets.PSObject.Properties[$name].Value.sha256 }
$plan = Invoke-WslAction $TestDistro @{operation='asset-plan'; release=$Release; assets=$hashes}
if (@($plan.missing).Count -ne 0) { throw 'Streamed assets do not match the Windows cache.' }
Send-WslAssets $TestDistro $TestCache $metadata $archive
$corrupt = 'printf "%s" "corrupt" > ' + (Quote-BashArgument ($plan.cache + '/preload.cjs')) + "`n"
Invoke-Captured 'wsl.exe' @('-d', $TestDistro, '--', 'bash', '-s') $corrupt | Out-Null
$plan = Invoke-WslAction $TestDistro @{operation='asset-plan'; release=$Release; assets=$hashes}
if (@($plan.missing).Count -ne 1 -or $plan.missing[0] -ne 'preload.cjs') { throw 'Corrupt cache detection failed.' }
Send-WslAssets $TestDistro $TestCache $metadata $archive
$plan = Invoke-WslAction $TestDistro @{operation='asset-plan'; release=$Release; assets=$hashes}
if (@($plan.missing).Count -ne 0) { throw 'Corrupt cache repair failed.' }
Write-Output 'WSL transfer: Windows profile path with spaces, large archive, cache reuse and corruption repair passed.'
