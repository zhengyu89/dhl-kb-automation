$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $repoRoot "backend"
$frontendPath = Join-Path $repoRoot "frontend"

if (-not (Test-Path $backendPath)) {
    throw "Backend folder not found at '$backendPath'."
}

if (-not (Test-Path $frontendPath)) {
    throw "Frontend folder not found at '$frontendPath'."
}

$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwshCommand) {
    $shellPath = $pwshCommand.Source
} else {
    $shellPath = (Get-Command powershell -ErrorAction Stop).Source
}

$backendCommand = "Set-Location -LiteralPath '$backendPath'; uv run uvicorn app.main:app --reload"
$frontendCommand = "Set-Location -LiteralPath '$frontendPath'; npm run dev"

Start-Process -FilePath $shellPath -ArgumentList @(
    "-NoExit",
    "-Command",
    $backendCommand
) -WindowStyle Normal

Start-Process -FilePath $shellPath -ArgumentList @(
    "-NoExit",
    "-Command",
    $frontendCommand
) -WindowStyle Normal

Write-Host "Started backend and frontend in separate terminal windows."
