[CmdletBinding()]
param(
    [switch]$DemoOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$webRoot = Join-Path $workspace 'web'
$runtimeRoot = Join-Path $workspace '.runtime'
$executable = Join-Path $runtimeRoot 'nemo-speech\bin\nemo-speech.exe'
$logRoot = Join-Path $runtimeRoot 'logs'
$siteUrl = 'http://127.0.0.1:3000'
$engineProcess = $null

if (-not (Test-Path -LiteralPath $webRoot)) {
    throw "Web root not found at $webRoot"
}

if (-not $DemoOnly) {
    if (-not (Test-Path -LiteralPath $executable)) {
        & (Join-Path $PSScriptRoot 'setup.ps1')
    }

    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
    $stdoutLog = Join-Path $logRoot 'engine.stdout.log'
    $stderrLog = Join-Path $logRoot 'engine.stderr.log'
    $engineArgs = @(
        'serve',
        '--asr-model', 'nemotron-3.5',
        '--asr.streaming.rnnt_right_context', '6',
        '--device', 'cuda:0',
        '--host', '127.0.0.1',
        '--port', '8080',
        '--cors-origin', $siteUrl,
        '--endpointing',
        '--stop-history-eou-ms', '700',
        '--no-ui'
    )

    Write-Host 'Starting local Korean STT engine...' -ForegroundColor Cyan
    $engineProcess = Start-Process -FilePath $executable -ArgumentList $engineArgs `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog

    $engineReady = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($engineProcess.HasExited) { break }
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/ready' -TimeoutSec 1
            if ($response.ready) { $engineReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 1000
    }

    if (-not $engineReady) {
        if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force }
        $details = if (Test-Path -LiteralPath $stderrLog) {
            (Get-Content -LiteralPath $stderrLog -Tail 30) -join [Environment]::NewLine
        } else { 'No STT log was produced.' }
        throw "Local Korean STT did not become ready.`n$details"
    }

    Write-Host 'Local Korean STT is ready on CUDA.' -ForegroundColor Green
} else {
    Write-Host 'Demo-only mode: local model server is not started.' -ForegroundColor Yellow
}

if (-not $NoBrowser) { Start-Process $siteUrl }

Write-Host "Opening 누구말? at $siteUrl" -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.'

try {
    & python -m http.server 3000 --bind 127.0.0.1 --directory $webRoot
} finally {
    if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force }
}
