# Run-LibrarySnapshot.ps1 - rebuild src\data\libraryIndex.json from Archive.org (20-30 min).
#   powershell -ExecutionPolicy Bypass -File scripts\Run-LibrarySnapshot.ps1
#   ... -AllowShrink            accept a smaller index than the current one
#   ... -Only cartoons,audiobooks   rebuild just those categories
param([switch]$AllowShrink, [string]$Only = "")
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$a = @("tsx", "scripts/library-snapshot.ts")
if ($AllowShrink) { $a += "--allow-shrink" }
if ($Only) { $a += @("--only", $Only) }
& npx.cmd @a
$code = $LASTEXITCODE
if ($code -eq 0) { Write-Host "`nDone. Commit src\data\libraryIndex.json, then build the ZIP." -ForegroundColor Green }
else { Write-Host "`nSnapshot not written (exit $code)." -ForegroundColor Red }
exit $code
