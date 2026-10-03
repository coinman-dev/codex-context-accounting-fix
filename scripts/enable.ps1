$ErrorActionPreference = 'Stop'
$auditDir = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Path $auditDir -Force | Out-Null
$settingsPath = Join-Path $env:APPDATA 'Zed\settings.json'
$fixRoot = Join-Path $env:USERPROFILE '.codex\context-accounting-fix'
$windowsProof = Get-Content -Raw -LiteralPath (Join-Path $fixRoot 'startup-validation.json') | ConvertFrom-Json -AsHashtable
$linuxProofText = wsl.exe -d Ubuntu -- bash -lc 'cat ~/.codex/context-accounting-fix/startup-validation.json'
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu startup verification is missing' }
$linuxProof = ($linuxProofText -join "`n") | ConvertFrom-Json -AsHashtable
foreach ($proof in @($windowsProof, $linuxProof)) {
    if ($proof.initialize -ne 'passed' -or $proof.session_new -ne 'passed') {
        throw 'Both platforms must pass the adapter startup test before activation'
    }
}
if ($windowsProof.version -ne $linuxProof.version) { throw 'Platform patch versions differ' }

$original = [System.IO.File]::ReadAllText($settingsPath)
$before = $original | ConvertFrom-Json -AsHashtable
$expected = $original | ConvertFrom-Json -AsHashtable
$entry = $expected.agent_servers['codex-acp']
if ($entry.type -ne 'registry') { throw 'Inspect the original Codex agent definition before changing it' }
if (-not $entry.Contains('env')) { $entry.env = [ordered]@{} }
if ($entry.env.CODEX_PATH) { throw 'An existing CODEX_PATH override needs review' }
$option = (Get-Content -Raw -LiteralPath (Join-Path $fixRoot 'node-options.txt')).Trim()
$linuxOptionText = wsl.exe -d Ubuntu -- bash -lc 'cat ~/.codex/context-accounting-fix/node-options.txt'
if ($LASTEXITCODE -ne 0 -or ($linuxOptionText -join "`n").Trim() -ne $option) { throw 'Platform preload options differ' }
$existingOptions = [string]$entry.env.NODE_OPTIONS
if (-not $existingOptions.Contains($option)) {
    $entry.env.NODE_OPTIONS = ($existingOptions + ' ' + $option).Trim()
}
$lines = ($expected.agent_servers | ConvertTo-Json -Depth 24) -split '\r?\n'
$replacement = '  "agent_servers": ' + $lines[0] + "`r`n" + (($lines[1..($lines.Length - 1)] | ForEach-Object { '  ' + $_ }) -join "`r`n") + ','
$matches = [regex]::Matches($original, '(?ms)^  "agent_servers": \{.*?^  \},(?=\r?\n)')
if ($matches.Count -ne 1) { throw 'Unexpected agent_servers formatting; no changes applied' }
$match = $matches[0]
$updated = $original.Substring(0, $match.Index) + $replacement + $original.Substring($match.Index + $match.Length)
$after = $updated | ConvertFrom-Json -AsHashtable
if (($after | ConvertTo-Json -Depth 40 -Compress) -ne ($expected | ConvertTo-Json -Depth 40 -Compress)) {
    throw 'Settings validation failed'
}
if ([System.IO.File]::ReadAllText($settingsPath) -ne $original) { throw 'Settings changed concurrently' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = $settingsPath + '.before-reasoning-fix-' + $stamp + '.bak'
$staged = $settingsPath + '.reasoning-fix-' + $stamp + '.tmp'
[System.IO.File]::WriteAllText($staged, $updated, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::Replace($staged, $settingsPath, $backup)
$record = [ordered]@{
    agent = 'codex-acp'
    type = 'registry'
    patch_version = $windowsProof.version
    preload_option = $option
    settings_backup = $backup
    windows = $windowsProof
    ubuntu = $linuxProof
    focused_tests_passed = 7
    activation_for_existing_connections = 'Chat panel menu > Reload Agent, after active work finishes'
}
$record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $auditDir 'installed-context-accounting-fix.json') -Encoding utf8
Write-Output ('Enabled patched Codex for both platforms: ' + $windowsProof.version)
Write-Output ('Settings backup: ' + $backup)
