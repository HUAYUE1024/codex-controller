[CmdletBinding()]
param([switch]$InstallCodex)
$ErrorActionPreference = 'Stop'
try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) { throw 'Node.js 22+ is required. Install it from https://nodejs.org/ then reopen PowerShell.' }
    $version = & $node.Source -p 'process.versions.node'
    $major = ($version -split '\.')[0]
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 22) { throw 'Node.js 22 or newer is required.' }
    Write-Host ('Node.js: ' + (& $node.Source --version))
    $codex = Get-Command codex.cmd,codex.exe,codex -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($InstallCodex) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
        if (-not $npm) { throw 'npm was not found. Install Node.js with npm, then reopen PowerShell.' }
        Write-Host 'Explicit -InstallCodex selected: installing/updating official @openai/codex globally.'
        & $npm.Source install -g '@openai/codex'
        if ($LASTEXITCODE -ne 0) { throw 'Codex installation failed. Check npm output above.' }
        $codex = Get-Command codex.cmd,codex.exe,codex -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $codex) {
        throw 'Codex CLI not found. Run npm install -g @openai/codex yourself, or rerun setup.ps1 -InstallCodex to explicitly opt in. Then reopen PowerShell.'
    }
    & $codex.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'Codex CLI could not start. Check the official Windows setup guide.' }
    Write-Host 'Ready. Run start.cmd. Sign in through the controller UI if needed.'
    Write-Host 'No npm dependencies are needed for the controller itself. No account or credential changes were made by this check.'
} catch {
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
