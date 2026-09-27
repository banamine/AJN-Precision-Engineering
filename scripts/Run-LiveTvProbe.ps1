# Run-LiveTvProbe.ps1 - Live TV transport probe (see scripts/live-tv-probe.ts).
#   powershell -ExecutionPolicy Bypass -File scripts\Run-LiveTvProbe.ps1            # ~1 minute
#   powershell -ExecutionPolicy Bypass -File scripts\Run-LiveTvProbe.ps1 -Recheck   # + 15-minute recheck
# Results: probe-results\<timestamp>\live-tv-probe.csv and .json (read-only for the app).
param([int]$Count = 20, [switch]$Recheck)
$Repo = Split-Path -Parent $PSScriptRoot
$Out  = Join-Path $Repo ("probe-results\" + (Get-Date -Format "yyyy-MM-dd_HHmmss"))
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$argsList = @("tsx", "scripts/live-tv-probe.ts", "--count", "$Count", "--out", "`"$Out`"")
if ($Recheck) { $argsList += "--recheck" }
$limit = if ($Recheck) { 25 * 60 } else { 5 * 60 }   # hard outer timeout, seconds
$p = Start-Process -FilePath "npx.cmd" -ArgumentList $argsList -WorkingDirectory $Repo -NoNewWindow -PassThru `
       -RedirectStandardOutput (Join-Path $Out "console.txt") -RedirectStandardError (Join-Path $Out "errors.txt")
if (-not $p.WaitForExit($limit * 1000)) {
  & taskkill /PID $p.Id /T /F *> $null
  Write-Host "Probe exceeded $limit s and was stopped." -ForegroundColor Red
  exit 3
}
Get-Content (Join-Path $Out "console.txt")
if ((Get-Item (Join-Path $Out "errors.txt")).Length -gt 0) { Get-Content (Join-Path $Out "errors.txt") -Tail 20 }
Write-Host "`nResults folder: $Out" -ForegroundColor Green
exit $p.ExitCode
