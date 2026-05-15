$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

$command = Get-Command semgrep -ErrorAction SilentlyContinue
$semgrep = if ($command) { $command.Source } else { $null }

if (-not $semgrep) {
  $pythonScriptRoots = Get-ChildItem -Path (Join-Path $env:APPDATA 'Python') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'Scripts\semgrep.exe' }

  $semgrep = $pythonScriptRoots | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $semgrep) {
  throw 'semgrep.exe was not found. Install Semgrep or add its Python Scripts directory to PATH.'
}

$semgrepDir = Split-Path -Parent $semgrep
$env:PATH = "$semgrepDir;$env:PATH"
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$semgrepArgs = @(
  'scan',
  '--config', 'p/ci',
  '--error',
  '--exclude', 'node_modules',
  '--exclude', '.git',
  '--exclude', '.claude',
  '--exclude', 'artifacts',
  '--exclude', 'test-results',
  '--exclude', 'playwright-report',
  '--exclude', 'frontend/node_modules',
  '--exclude', 'backend/node_modules',
  '--exclude', 'frontend/dist',
  '--exclude', 'frontend/storybook-static',
  '--exclude', 'backend/coverage',
  '--exclude', 'backend/src/__tests__',
  $repoRoot
)

for ($attempt = 1; $attempt -le 2; $attempt++) {
  & $semgrep @semgrepArgs
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0 -or $attempt -eq 2) {
    exit $exitCode
  }
  Write-Warning "semgrep exited with code $exitCode on attempt $attempt; retrying once for transient Windows subprocess errors."
  Start-Sleep -Seconds 2
}
