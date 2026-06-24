# hitl-loop.template.ps1 — Human-In-The-Loop reproduction bridge
#
# For the last-resort case where a feedback loop genuinely needs a human action that
# automated browser/CLI checks cannot drive. The AGENT copies this file, edits the
# fenced region below, and hands the human a command to run. The HUMAN runs it in
# their own terminal and answers the prompts. The final "Captured" block prints
# KEY=VALUE lines the agent parses and feeds back into the diagnosis loop.
#
# Usage (human runs):  pwsh -File scripts/hitl-loop.run.ps1
# (Agent: copy to scripts/hitl-loop.run.ps1, edit the fenced region, do NOT edit the helpers.)

$ErrorActionPreference = 'Stop'
$captured = [ordered]@{}

function Step([string]$instruction) {
    Write-Host ""
    Write-Host ">>> $instruction" -ForegroundColor Cyan
    Read-Host "    [Enter when done]" | Out-Null
}

function Capture([string]$key, [string]$question) {
    Write-Host ""
    Write-Host ">>> $question" -ForegroundColor Yellow
    $answer = Read-Host "    >"
    $script:captured[$key] = $answer
}

# --- edit below ----------------------------------------------------------------
Step "Open the app and reach the state you want to reproduce."
Capture "ERRORED"   "Perform the action under test. Did it fail? (y/n)"
Capture "ERROR_MSG" "Paste the error message or observed behavior (or 'none'):"
# --- edit above ----------------------------------------------------------------

Write-Host ""
Write-Host "--- Captured ---" -ForegroundColor Green
foreach ($k in $captured.Keys) {
    Write-Host ("{0}={1}" -f $k, $captured[$k])
}
