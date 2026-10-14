@echo off
title Installing Winsle...
echo ============================================================
echo   Installing Winsle Dynamic Island for Windows
echo ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
