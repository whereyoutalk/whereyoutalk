[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $workspace '.runtime'
$downloadRoot = Join-Path $runtimeRoot 'downloads'
$installRoot = Join-Path $runtimeRoot 'nemo-speech'
$executable = Join-Path $installRoot 'bin\nemo-speech.exe'
$release = '0.1.0'
$archiveName = "nemo-speech-$release-windows-x86_64-cuda.zip"
$baseUrl = "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v$release"

New-Item -ItemType Directory -Force -Path $downloadRoot, $installRoot | Out-Null

if (-not (Test-Path -LiteralPath $executable)) {
    $archive = Join-Path $downloadRoot $archiveName
    $checksumFile = "$archive.sha256"
    $curl = (Get-Command curl.exe -ErrorAction Stop).Source

    Write-Host "Downloading verified NeMo-Speech.cpp CUDA runtime..." -ForegroundColor Cyan
    & $curl -L --fail --output $archive "$baseUrl/$archiveName"
    if ($LASTEXITCODE -ne 0) { throw 'Runtime archive download failed.' }
    & $curl -L --fail --output $checksumFile "$baseUrl/$archiveName.sha256"
    if ($LASTEXITCODE -ne 0) { throw 'Runtime checksum download failed.' }

    $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    if ($actual.ToLowerInvariant() -ne $expected.ToLowerInvariant()) {
        throw "Runtime checksum mismatch. Expected $expected, got $actual."
    }

    Expand-Archive -LiteralPath $archive -DestinationPath $installRoot -Force
}

if (-not (Test-Path -LiteralPath $executable)) {
    throw "NeMo-Speech executable not found at $executable"
}

Write-Host 'Checking CUDA runtime...' -ForegroundColor Cyan
$doctor = & $executable doctor --json | ConvertFrom-Json
if (-not $doctor.accelerator_available -or -not $doctor.features.backend_cuda) {
    throw 'A working CUDA device was not detected by NeMo-Speech.cpp.'
}

Write-Host 'Downloading pinned Korean ASR model...' -ForegroundColor Cyan
& $executable pull nemotron-3.5
if ($LASTEXITCODE -ne 0) { throw 'Nemotron 3.5 model download failed.' }

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host "GPU: $($doctor.devices[0].description)"
Write-Host 'Run: powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1'
