$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

$candidates = @()
if ($env:GITLEAKS_EXE) {
  $candidates += $env:GITLEAKS_EXE
}

$command = Get-Command gitleaks -ErrorAction SilentlyContinue
if ($command) {
  $candidates += $command.Source
}

$candidates += @(
  'C:\tmp\gitleaks\gitleaks.exe',
  (Join-Path $env:USERPROFILE '.local\bin\gitleaks.exe')
)

$gitleaks = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $gitleaks) {
  throw 'gitleaks.exe was not found. Set GITLEAKS_EXE or install it into PATH.'
}

& $gitleaks detect --source $repoRoot --redact --no-banner --exit-code 1
exit $LASTEXITCODE
