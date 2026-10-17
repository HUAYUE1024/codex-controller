[CmdletBinding()]
param([string]$Workspace = $env:CODEX_WORKSPACE)
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) { throw 'Node.js 22+ not found. Run scripts/setup.ps1 first.' }
    $version = & $node.Source -p 'process.versions.node'
    $major = ($version -split '\.')[0]
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 22) { throw 'Node.js 22 or newer is required.' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'server.mjs'))) { throw 'server.mjs is missing. Extract the entire package before starting.' }
    & $node.Source (Join-Path $root 'scripts/build.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; the previous bundle was preserved.' }
    if ([string]::IsNullOrWhiteSpace($Workspace)) {
        $Workspace = Read-Host 'Enter the full path to the project Codex should work in'
    }
    if ([string]::IsNullOrWhiteSpace($Workspace) -or -not (Test-Path -LiteralPath $Workspace -PathType Container)) {
        throw 'A valid existing project directory is required.'
    }
    $env:CODEX_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).ProviderPath
    Set-Location -LiteralPath $root
    Write-Host 'Starting Codex Controller. Open the local address printed below.'
    Write-Host 'Keep this window open. Press Ctrl+C to stop.'
    & $node.Source (Join-Path $root 'server.mjs')
    exit $LASTEXITCODE
} catch {
    Write-Host ('Start failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
