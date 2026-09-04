[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$webRoot = Join-Path $workspace 'web'
$runtimeRoot = Join-Path $workspace '.runtime\nemo-speech'
$stopped = $false

$webListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($webListener) {
    $webPid = [int]($webListener | Select-Object -First 1).OwningProcess
    $webProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $webPid"
    $isOurWebServer = $webProcess.Name -eq 'python.exe' -and
        $webProcess.CommandLine -like '*-m http.server 3000*' -and
        $webProcess.CommandLine -like "*$webRoot*"
    if (-not $isOurWebServer) {
        throw "Port 3000 belongs to another process (PID $webPid); nothing was stopped."
    }
    Stop-Process -Id $webPid
    $stopped = $true
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)) {
        break
    }
    Start-Sleep -Milliseconds 250
}

$engineListener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($engineListener) {
    $enginePid = [int]($engineListener | Select-Object -First 1).OwningProcess
    $engineProcess = Get-Process -Id $enginePid -ErrorAction Stop
    if (-not $engineProcess.Path.StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Port 8080 belongs to another process (PID $enginePid); nothing was stopped."
    }
    Stop-Process -Id $enginePid
    $stopped = $true
}

if ($stopped) {
    Write-Host '누구말? local deployment stopped.' -ForegroundColor Green
} else {
    Write-Host 'No 누구말? local deployment is running.' -ForegroundColor Yellow
}
