# Direct-vs-proxy speed test. Answers: is the slowness Archive.org, the proxy/Cloud Run, or your own connection?
#   powershell -ExecutionPolicy Bypass -File tools\live-soak\slice-speed.ps1 -App https://<your-app> [-Guide classic-tv] [-Match "Wanted"] [-Slices 3]
# Picks one program of a channel whose name matches -Match (default: first with a plain /download/ file), then downloads the SAME
# 8 MiB slices (a) through <App>/api/archive/proxy and (b) straight from https://archive.org, and prints seconds + KB/s for each.
param([Parameter(Mandatory=$true)][string]$App, [string]$Guide = "classic-tv", [string]$Match = "", [int]$Slices = 3)
$App = $App.TrimEnd('/')
# Windows PowerShell 5.1 does not ask for gzip; the server refuses an uncompressed schedule above 28 MiB (Cloud Run 32 MiB cap). curl.exe --compressed does.
$tmp = Join-Path $env:TEMP "ajn-schedule-$Guide.json"
curl.exe -s --compressed -m 180 -o $tmp -w "schedule HTTP %{http_code}, %{size_download} bytes, %{time_total}s`n" "$App/api/schedule?guide=$Guide"
$sched = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json
$chan = $sched.channels | Where-Object { ($Match -eq "" -or $_.name -match $Match) -and $_.programs.Count -gt 0 } | Select-Object -First 1
if (-not $chan) { Write-Host "No channel matching '$Match' in $Guide"; exit 1 }
$prog = $chan.programs | Where-Object { $_.archivePath -like "/download/*" -and $_.archivePath -notlike "*exact=1*" } | Select-Object -First 1
if (-not $prog) { $prog = $chan.programs | Where-Object { $_.archivePath -like "/download/*" } | Select-Object -First 1 }
$path = $prog.archivePath
Write-Host "Channel: $($chan.name)`nProgram: $($prog.title)`nPath:    $path`n"
$step = 8MB
function Fetch($url, $from, $to) {
  $req = [System.Net.HttpWebRequest]::Create($url); $req.AddRange([long]$from, [long]$to); $req.UserAgent = "AJN-speedtest"; $req.Timeout = 120000; $req.ReadWriteTimeout = 120000
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $resp = $req.GetResponse() } catch { return [pscustomobject]@{ ok=$false; err=$_.Exception.Message } }
  $hdr = $sw.Elapsed.TotalSeconds; $s = $resp.GetResponseStream(); $buf = New-Object byte[] 65536; $n = 0; $first = $null
  while (($r = $s.Read($buf, 0, $buf.Length)) -gt 0) { if ($null -eq $first) { $first = $sw.Elapsed.TotalSeconds }; $n += $r }
  $tot = $sw.Elapsed.TotalSeconds; $resp.Close()
  $body = [math]::Max($tot - $first, 0.001)
  [pscustomobject]@{ ok=$true; status=[int]$resp.StatusCode; bytes=$n; headerSec=[math]::Round($hdr,2); firstByteSec=[math]::Round($first,2); totalSec=[math]::Round($tot,2); KBps=[math]::Round($n/1024/$body) }
}
$rows = @()
for ($i = 0; $i -lt $Slices; $i++) {
  $from = $i * $step; $to = $from + $step - 1
  foreach ($via in @("proxy", "direct")) {
    $url = if ($via -eq "proxy") { "$App/api/archive/proxy?path=" + [uri]::EscapeDataString($path) } else { "https://archive.org" + $path }
    $r = Fetch $url $from $to
    $rows += [pscustomobject]@{ slice=$i; via=$via; ok=$r.ok; status=$r.status; MB=[math]::Round($r.bytes/1MB,1); headerSec=$r.headerSec; firstByteSec=$r.firstByteSec; totalSec=$r.totalSec; KBps=$r.KBps; err=$r.err }
  }
}
$rows | Format-Table -AutoSize
Write-Host "Read it like this: direct KB/s high + proxy KB/s low = proxy/Cloud Run is the bottleneck; both low = Archive.org (or your line); proxy firstByteSec high = wait before data starts."
