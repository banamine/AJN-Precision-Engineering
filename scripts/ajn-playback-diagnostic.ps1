<#
.SYNOPSIS
AJN Playback Diagnostic Runner - Phase 1A Foundation

.DESCRIPTION
Implements run identity, workspace generation, strict process ownership,
hard timeouts via a background watchdog, and guaranteed cleanup.
#>
[CmdletBinding()]
param (
    [string]$BaseUrl = "http://localhost:3000",
    [int]$TestTimeoutSeconds = 120,
    [int]$WatchdogTimeoutSeconds = 900,     [switch]$TestTimeout
)

$ErrorActionPreference = "Stop"
$Global:RunFailed = $false$Global:OwnedProcesses = @()

# 1. Run Identity & Workspace Initialization
$RunId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$((New-Guid).Guid.Substring(0,4).ToUpper())"
$Workspace = Join-Path$PWD "diagnostics\$RunId"
$RunJsonPath = Join-Path$Workspace "run.json"
$KillSwitchPath = Join-Path $Workspace "emergency-cleanup-$RunId.ps1"

function Initialize-Workspace {
    Write-Host "Initializing AJN Diagnostic Run: $RunId" -ForegroundColor Cyan

    $directories = @("logs", "http", "media\good", "media\bad", "browser", "resources")
    foreach ($dir in $directories) {$null = New-Item -Path (Join-Path $Workspace$dir) -ItemType Directory -Force
    }

    $RunData = @{
        runId = $RunId
        pid = $PID
        processName = (Get-Process -Id $PID).ProcessName
        startedAt = (Get-Date).ToString("o")
        ownedProcesses = @()
    }
    $RunData \vert{} ConvertTo-Json -Depth 5 \vert{} Set-Content$RunJsonPath

    # Generate Secondary Kill-Switch with ProcessName safety verification
    $KillScript = @"
`$ErrorActionPreference = 'Continue'
Write-Host "Executing Emergency Kill-Switch for Run: $RunId" -ForegroundColor Red
`$RunData = Get-Content '$RunJsonPath' -ErrorAction SilentlyContinue | ConvertFrom-Json

if (`$RunData -and `$RunData.ownedProcesses) {
    foreach (`$proc in `$RunData.ownedProcesses) {
        `$p = Get-Process -Id `$proc.pid -ErrorAction SilentlyContinue
        if (`$p -and `$p.ProcessName -eq `$proc.processName) {
            Write-Host "   Terminating `$(`$proc.type) (PID: `$(`$proc.pid), Name: `$(`$proc.processName))..."
            Stop-Process -Id `$proc.pid -Force -ErrorAction SilentlyContinue
        } else {
            Write-Host "   Skipping PID `$(`$proc.pid) - Process missing or name mismatch (PID reuse protection)." -ForegroundColor Yellow
        }
    }
}
Write-Host "Emergency Cleanup Complete."
"@
    $KillScript \vert{} Set-Content$KillSwitchPath
}

# 2. Process Ownership
function Register-Process {
    param([int]$ProcessId, [string]$Type)$p = Get-Process -Id $ProcessId -ErrorAction Stop$procData = @{
        pid = $ProcessId
        type = $Type
        processName = $p.ProcessName
        startTime = $p.StartTime.ToString("o")
        runId = $RunId
    }
    $Global:OwnedProcesses +=$procData

    # Update run.json durably
    $RunData = Get-Content$RunJsonPath -Raw | ConvertFrom-Json
    $RunData.ownedProcesses =$Global:OwnedProcesses
    $RunData \vert{} ConvertTo-Json -Depth 5 \vert{} Set-Content$RunJsonPath

    Write-Host "Registered child process: $Type (PID:$ProcessId, Name: $($p.ProcessName))" -ForegroundColor DarkGray
}

# 3. Timeout / Watchdog Framework
function Start-Watchdog {
    Write-Host "Starting background watchdog ($WatchdogTimeoutSeconds seconds)..." -ForegroundColor DarkGray
    $WatchdogScript = {
        param($MainPid,$Timeout, $KillSwitch)$sw = [Diagnostics.Stopwatch]::StartNew()

        while ($sw.Elapsed.TotalSeconds -lt$Timeout) {
            # If the main runner exited cleanly, stop the watchdog
            if (-not (Get-Process -Id $MainPid -ErrorAction SilentlyContinue)) { return }
            Start-Sleep -Seconds 2
        }

        # Watchdog timeout breached
        & $KillSwitch
        Stop-Process -Id $MainPid -Force
    }
    $Global:WatchdogJob = Start-Job -ScriptBlock $WatchdogScript -ArgumentList$PID, $WatchdogTimeoutSeconds,$KillSwitchPath
}

# 4. Guaranteed Cleanup
function Invoke-GuaranteedCleanup {
    Write-Host "`nExecuting Guaranteed Cleanup Phase..." -ForegroundColor Yellow

    foreach ($proc in $Global:OwnedProcesses) {
        $p = Get-Process -Id $proc.pid -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq $proc.processName) {
            Write-Host "   Gracefully stopping $($proc.type) (PID: $($proc.pid))..."
            $p.CloseMainWindow() | Out-Null
            if (-not $p.WaitForExit(3000)) {
                Write-Host "   Force terminating $($proc.type) (PID: $($proc.pid))..." -ForegroundColor Red
                $p | Stop-Process -Force -ErrorAction SilentlyContinue
            }
        } else {
            Write-Host "   Process $($proc.pid) already gone or name mismatch. Skipping." -ForegroundColor DarkGray
        }
    }

    if ($Global:WatchdogJob) {
        Stop-Job $Global:WatchdogJob -ErrorAction SilentlyContinue
        Remove-Job $Global:WatchdogJob -ErrorAction SilentlyContinue
    }

    Write-Host "Cleanup Complete. Runner exiting." -ForegroundColor $(if($Global:RunFailed){"Red"}else{"Green"})
}

# -------------------------------------------------------------------------
# EXECUTION BOUNDARY
# -------------------------------------------------------------------------

try {
    Initialize-Workspace
    Start-Watchdog

    Write-Host "`nDiagnostic Workspace Ready: $Workspace"
    Write-Host "Kill-switch available at: $KillSwitchPath"

    Write-Host "`nTesting process ownership... spawning dummy processes."
    $dummy1 = Start-Process ping -ArgumentList "-t localhost" -WindowStyle Hidden -PassThru
    Register-Process -ProcessId $dummy1.Id -Type "dummy-ping-1"

    $dummy2 = Start-Process ping -ArgumentList "-t localhost" -WindowStyle Hidden -PassThru
    Register-Process -ProcessId $dummy2.Id -Type "dummy-ping-2"

    if ($TestTimeout) {
        Write-Host "`nSimulating a locked thread to trigger watchdog in $WatchdogTimeoutSeconds seconds..." -ForegroundColor Magenta
        Start-Sleep -Seconds ($WatchdogTimeoutSeconds + 2)
    } else {
        Write-Host "`nSimulating normal test execution..."
        Start-Sleep -Seconds 3
        Write-Host "Tests completed without fatal exception."
    }

    $Report = @{
        runId = $RunId
        status = "FOUNDATION_PASS"
    }
    $Report | ConvertTo-Json | Set-Content (Join-Path $Workspace "report.json")

} catch {
    Write-Host "`nFATAL EXCEPTION: $($_.Exception.Message)" -ForegroundColor Red
    $Global:RunFailed =$true
} finally {
    Invoke-GuaranteedCleanup
}