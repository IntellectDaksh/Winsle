<#
.SYNOPSIS
    Winsle 1-Click Installer for Windows (10/11 64-bit)
.DESCRIPTION
    Downloads, unblocks (bypassing SmartScreen internet quarantine),
    and launches the verified Winsle Dynamic Island installer.
.EXAMPLE
    irm https://raw.githubusercontent.com/IntellectDaksh/Winsle/master/scripts/install.ps1 | iex
#>

[CmdletBinding()]
param(
    [switch]$Silent,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'

# Ensure TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Cyan = [ConsoleColor]::Cyan
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$White = [ConsoleColor]::White
$Red = [ConsoleColor]::Red

function Write-Winsle([string]$text, [ConsoleColor]$color = $White) {
    Write-Host "  $text" -ForegroundColor $color
}

Write-Host ""
Write-Host "    __          ___           _      " -ForegroundColor Cyan
Write-Host "    \ \        / (_)         | |     " -ForegroundColor Cyan
Write-Host "     \ \  /\  / / _ _ __  ___| | ___ " -ForegroundColor Cyan
Write-Host "      \ \/  \/ / | | '_ \/ __| |/ _ \" -ForegroundColor Cyan
Write-Host "       \  /\  /  | | | | \__ \ |  __/" -ForegroundColor Cyan
Write-Host "        \/  \/   |_|_| |_|___/_|\___|" -ForegroundColor Cyan
Write-Host "      Dynamic Island for Windows (Mochi)" -ForegroundColor Yellow
Write-Host ""

# 1. System Check
Write-Winsle "Checking system compatibility..." $Cyan
if (-not [System.Environment]::Is64BitOperatingSystem) {
    Write-Winsle "Error: Winsle requires a 64-bit (x64) version of Windows." $Red
    exit 1
}

$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
    Write-Winsle "Warning: Winsle is optimized for Windows 10 and Windows 11." $Yellow
}

Write-Winsle "Operating System: Windows (64-bit) - Compatible [OK]" $Green

# 2. Setup paths
$tempDir = Join-Path $env:TEMP "WinsleInstaller"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

$repo = "IntellectDaksh/Winsle"
$version = "1.0.0"

if ($Portable) {
    Write-Winsle "Mode: Portable ZIP Installation" $Cyan
    $fileName = "Winsle-Windows-$version-portable.zip"
    $downloadUrl = "https://github.com/$repo/releases/download/v$version/$fileName"
    $targetZip = Join-Path $tempDir $fileName
    $installDir = Join-Path $env:LOCALAPPDATA "Winsle"

    Write-Winsle "Downloading $fileName..." $Cyan
    Invoke-WebRequest -Uri $downloadUrl -OutFile $targetZip -UseBasicParsing
    
    Write-Winsle "Unblocking downloaded file (SmartScreen bypass)..." $Cyan
    Unblock-File -Path $targetZip

    Write-Winsle "Extracting to $installDir..." $Cyan
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    Expand-Archive -Path $targetZip -DestinationPath $installDir -Force

    $winsleExe = Join-Path $installDir "winsle.exe"
    if (Test-Path $winsleExe) {
        Unblock-File -Path $winsleExe
        Write-Winsle "Launching Winsle..." $Green
        Start-Process -FilePath $winsleExe
    }
    Write-Winsle "Installation complete!" $Green
    exit 0
}

# Standard Installer
$fileName = "Winsle-Windows-$version-setup.exe"
$downloadUrl = "https://github.com/$repo/releases/download/v$version/$fileName"
$setupPath = Join-Path $tempDir $fileName

Write-Winsle "Downloading Winsle Setup ($version)..." $Cyan
Write-Winsle "Source: $downloadUrl" $White

try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($downloadUrl, $setupPath)
} catch {
    Write-Winsle "Fallback: Using Invoke-WebRequest..." $Yellow
    Invoke-WebRequest -Uri $downloadUrl -OutFile $setupPath -UseBasicParsing
}

if (-not (Test-Path $setupPath)) {
    Write-Winsle "Error: Failed to download setup executable." $Red
    exit 1
}

# 3. SmartScreen Quarantine Removal
Write-Winsle "Unblocking setup executable (bypassing SmartScreen quarantine)..." $Cyan
Unblock-File -Path $setupPath

# 4. Launching Setup
if ($Silent) {
    Write-Winsle "Running silent installation..." $Cyan
    Start-Process -FilePath $setupPath -ArgumentList "/S" -Wait
    Write-Winsle "Winsle installed successfully!" $Green
} else {
    Write-Winsle "Launching Winsle Installer with Mochi icon..." $Green
    Start-Process -FilePath $setupPath
    Write-Winsle "Setup launched without SmartScreen warnings!" $Green
}

Write-Winsle ""
Write-Winsle "Welcome to Winsle! Mochi is ready to live at the top of your screen." $Cyan
Write-Winsle ""
