# Makes the local repo folder match a Google AI Studio export zip. Backs up first, never deletes, skips .git and node_modules.
# Usage (PowerShell):  .\Sync-LocalToExport.ps1 -Zip "N:\New Downloads\ajn-precision-engineering-nov-25-2026-7-01-29-am.zip"
param([Parameter(Mandatory=$true)][string]$Zip,
      [string]$Repo = "B:\AJN Precision Engineering\AJN-Precision-Engineering\repo")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Zip)) { throw "Zip not found: $Zip" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$backup = "$Repo-backup-$stamp"
$tmp = Join-Path $env:TEMP "ajn-export-$stamp"
Write-Host "1/4 Backing up to $backup"
robocopy $Repo $backup /E /XD .git node_modules /NFL /NDL /NJH /NJS | Out-Null
Write-Host "2/4 Extracting export"
Expand-Archive $Zip $tmp -Force
$root = if (Test-Path (Join-Path $tmp 'package.json')) { $tmp } else { (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName }
Write-Host "3/4 Copying export over the repo (no deletions)"
robocopy $root $Repo /E /XD .git node_modules /NFL /NDL /NJH /NJS | Out-Null
Write-Host "4/4 Files that exist only locally (left alone):"
$exp = Get-ChildItem $root -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length) }
Get-ChildItem $Repo -Recurse -File -Exclude *.zip | Where-Object { $_.FullName -notmatch '\\(\.git|node_modules|_sync_backup)[\\]' } |
  ForEach-Object { $_.FullName.Substring($Repo.Length) } | Where-Object { $exp -notcontains $_ } | Select-Object -First 40
Write-Host "Done. Next: git status"
