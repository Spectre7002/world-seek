@echo off
chcp 65001 > nul
title World Seek Launcher

:: Run from the folder containing this script
cd /d "%~dp0"

echo ==========================================
echo   Starting World Seek...
echo ==========================================
echo.

echo Starting the game server...
start "World Seek Server" cmd /k "npm run dev"

echo.
echo ==========================================
echo   Server starting at http://localhost:3000
echo   Set up your own tunnel if remote access is needed.
echo ==========================================
echo.
pause
