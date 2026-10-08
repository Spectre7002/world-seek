@echo off
chcp 65001 > nul
title World Seek Launcher

:: Run from the folder containing this script
cd /d "%~dp0"

echo ==========================================
echo   Starting World Seek...
echo ==========================================
echo.

echo Starting your Ngrok tunnel...
if "%NGROK_DOMAIN%"=="" (
  echo No NGROK_DOMAIN configured. Starting a temporary Ngrok URL...
  start "Ngrok Tunnel" cmd /k "ngrok http 3000"
) else (
  start "Ngrok Tunnel" cmd /k "ngrok http --url=%NGROK_DOMAIN% 3000"
)

set "SERVER_READY="
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo An existing process is already listening on port 3000.
) else (
  echo Starting the game server...
  start "World Seek Server" cmd /k "npm run dev"
)
echo Waiting for the server to start...

for /l %%i in (1,1,60) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri http://localhost:3000/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 (
    set "SERVER_READY=1"
    goto server_ready
  )
  timeout /t 1 /nobreak > nul
)

:server_ready
if not defined SERVER_READY (
  echo The World Seek server did not become ready within 60 seconds.
  pause
  exit /b 1
)

if not "%NGROK_DOMAIN%"=="" (
  echo Opening the public game in Google Chrome...
  if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "https://%NGROK_DOMAIN%"
  ) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "https://%NGROK_DOMAIN%"
  ) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "https://%NGROK_DOMAIN%"
  ) else (
    echo Chrome was not found. Opening the public game in the default browser...
    start "" "https://%NGROK_DOMAIN%"
  )
) else (
  echo Ngrok generated a temporary URL. Check the Ngrok Tunnel window.
)

echo.
echo ==========================================
echo   Server starting at http://localhost:3000
if not "%NGROK_DOMAIN%"=="" echo   Public game: https://%NGROK_DOMAIN%
if "%NGROK_DOMAIN%"=="" echo   Public game: check the Ngrok Tunnel window
echo ==========================================
echo.
pause
