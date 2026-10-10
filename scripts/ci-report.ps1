<#
.SYNOPSIS
  One-file CI report for a branch or pull request: every workflow run, every job, every failing step,
  and (with a token) the last lines of each failed job's log. Read-only. No gh CLI needed.

.EXAMPLES
  .\scripts\ci-report.ps1                      # current git branch
  .\scripts\ci-report.ps1 -Pr 89               # a pull request
  .\scripts\ci-report.ps1 -Branch main
  $env:GITHUB_TOKEN = '<token>'; .\scripts\ci-report.ps1 -Pr 89   # also fetches failed-job logs

.NOTES
  The repo is public, so run/job/step status needs no login (60 requests/hour per IP).
  Job logs always need a token (GitHub rule). A fine-grained token with read-only "Actions" access is enough.
  Never paste the token into a chat or commit it. The report is written to reports\ci-report.txt.
#>
[CmdletBinding()]
param(
  [string]$Repo = 'banamine/AJN-Precision-Engineering',
  [string]$Branch = '',
  [int]$Pr = 0,
  [int]$LogLines = 60,
  [string]$OutFile = 'reports\ci-report.txt'
)
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$headers = @{ 'User-Agent' = 'ajn-ci-report'; 'Accept' = 'application/vnd.github+json' }
$hasToken = [bool]$env:GITHUB_TOKEN
if ($hasToken) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
$api = "https://api.github.com/repos/$Repo"

function Get-Api([string]$Path) {
  try { return Invoke-RestMethod -Uri "$api$Path" -Headers $headers }
  catch {
    $code = ''
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 401) { throw "GitHub rejected the login (401). `$env:GITHUB_TOKEN is set but invalid or expired. Fix: Remove-Item Env:GITHUB_TOKEN  (then run again), or set a new token." }
    if ($code -eq 404 -and -not $hasToken) { throw "GitHub says not found (404). If the repository is private, set `$env:GITHUB_TOKEN to a token with read access to this repo's Actions." }
    if ($code -eq 403 -or $code -eq 429) { throw "GitHub refused the request ($code): rate limit reached (60/hour without a token). Wait, or set `$env:GITHUB_TOKEN." }
    throw "GitHub request failed for $Path (HTTP $code): $($_.Exception.Message)"
  }
}
function Fmt-Secs($a, $b) {
  if (-not $a -or -not $b) { return '-' }
  $s = [int]([datetime]$b - [datetime]$a).TotalSeconds
  return ('{0}m{1:00}s' -f [math]::Floor($s / 60), ($s % 60))
}

$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$t) { $lines.Add($t); Write-Host $t }

# 1. What are we looking at?
$sha = ''
if ($Pr -gt 0) {
  $p = Get-Api "/pulls/$Pr"
  $Branch = $p.head.ref; $sha = $p.head.sha
  Say "Pull request #$Pr  '$($p.title)'  state=$($p.state)  merged=$($p.merged)"
  Say "Branch $Branch  head $($sha.Substring(0,7))"
} else {
  if (-not $Branch) { $Branch = (git rev-parse --abbrev-ref HEAD 2>$null) }
  if (-not $Branch) { throw 'Could not work out the branch. Pass -Branch or -Pr.' }
  Say "Branch $Branch"
}
Say "Repo $Repo   report time $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
Say ''

# 2. Runs (newest first). For a PR use the exact commit, otherwise the branch.
$query = if ($sha) { "head_sha=$sha" } else { "branch=$([uri]::EscapeDataString($Branch))" }
$runs = (Get-Api "/actions/runs?$query&per_page=10").workflow_runs
if (-not $runs -or $runs.Count -eq 0) {
  Say 'No workflow runs found for this branch/commit. Either CI has not started, or the branch is not pushed.'
} else {
  # latest run per workflow name
  $latest = $runs | Group-Object name | ForEach-Object { $_.Group | Sort-Object created_at -Descending | Select-Object -First 1 }
  $failed = @()
  foreach ($r in $latest) {
    $verdict = if ($r.status -ne 'completed') { $r.status.ToUpper() } else { $r.conclusion.ToUpper() }
    Say ("=== {0}  [{1}]  run #{2}  commit {3}  {4}" -f $r.name, $verdict, $r.run_number, $r.head_sha.Substring(0, 7), (Fmt-Secs $r.run_started_at $r.updated_at))
    Say "    $($r.html_url)"
    $jobs = (Get-Api "/actions/runs/$($r.id)/jobs?per_page=100").jobs
    foreach ($j in $jobs) {
      $jv = if ($j.status -ne 'completed') { $j.status } else { $j.conclusion }
      Say ("  - job: {0}  [{1}]  {2}" -f $j.name, $jv, (Fmt-Secs $j.started_at $j.completed_at))
      foreach ($s in $j.steps) {
        if ($s.conclusion -and $s.conclusion -ne 'success' -and $s.conclusion -ne 'skipped') { Say ("      step {0}: {1}  [{2}]" -f $s.number, $s.name, $s.conclusion) }
      }
      if ($jv -eq 'failure') { $failed += $j }
    }
    Say ''
  }

  # 3. Logs of failed jobs (token required by GitHub)
  if ($failed.Count -gt 0) {
    Say '--- FAILED JOB LOGS (last lines) ---'
    foreach ($j in $failed) {
      Say "## $($j.name)"
      if (-not $hasToken) { Say '   (set $env:GITHUB_TOKEN to include the log text; GitHub does not serve logs without a login)'; continue }
      try {
        $log = Invoke-WebRequest -Uri "$api/actions/jobs/$($j.id)/logs" -Headers $headers -UseBasicParsing
        $text = if ($log.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($log.Content) } else { [string]$log.Content }
        $tail = ($text -split "`r?`n") | Select-Object -Last $LogLines
        foreach ($l in $tail) { Say "   $l" }
      } catch { Say "   could not download this job's log: $($_.Exception.Message)" }
      Say ''
    }
  } else {
    $notDone = @($latest | Where-Object { $_.status -ne 'completed' }).Count
    if ($notDone -gt 0) { Say "Some runs are still going ($notDone). Run this again in a minute." }
    else { Say 'No failed jobs.' }
  }
}

# 4. Save the report
$dir = Split-Path $OutFile -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$lines | Set-Content -Path $OutFile -Encoding UTF8
Write-Host ''
Write-Host "Report saved to $OutFile  (drag this file into the chat)"
