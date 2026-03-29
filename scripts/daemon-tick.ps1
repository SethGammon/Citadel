# daemon-tick.ps1 — Citadel daemon factory loop.
#
# Run in a PowerShell window. Leave it open. Each session starts the moment
# the previous one finishes plus 60 seconds of cooldown. The loop stops when
# the daemon stops itself (campaign complete, budget hit, level-up pending).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\Users\gammo\Desktop\Citadel\scripts\daemon-tick.ps1
#
# To stop manually: close the window or Ctrl+C.

$env:CLAUDE_NON_INTERACTIVE = "1"
$citadel = "C:\Users\gammo\Desktop\Citadel"
$logFile = "$citadel\.planning\daemon-runs.log"

while ($true) {
    # Check if daemon is still running
    $daemonPath = "$citadel\.planning\daemon.json"
    if (-not (Test-Path $daemonPath)) {
        Write-Host "No daemon.json found. Exiting."
        break
    }

    $daemon = Get-Content $daemonPath -Raw | ConvertFrom-Json
    if ($daemon.status -ne "running") {
        Write-Host "Daemon stopped: $($daemon.stopReason)"
        break
    }

    # Run one session
    Write-Host "$(Get-Date) - Starting session $($daemon.sessionCount + 1)"
    claude --plugin-dir $citadel --dangerously-skip-permissions -p "/do continue" 2>&1 | Tee-Object -Append $logFile

    # Cooldown before next session
    Write-Host "$(Get-Date) - Session complete. Cooling down 60s..."
    Start-Sleep -Seconds 60
}

Write-Host "Factory stopped at $(Get-Date)"
