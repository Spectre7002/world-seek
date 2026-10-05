@echo off
chcp 65001 > nul
title World Seek Launcher

:: Переход в папку, где лежит сам батник
cd /d "%~dp0"

echo ===================================================
echo   Запуск World Seek и Ngrok...
echo ===================================================
echo.

:: 1. Запуск туннеля Ngrok в отдельном окне
echo [1/2] Запуск Ngrok...
start "Ngrok Tunnel" cmd /k "ngrok http --url=remission-wrinkle-prevail.ngrok-free.dev 3000"

:: Небольшая пауза перед запуском сервера
timeout /t 2 /nobreak > nul

:: 2. Запуск сервера Next.js / Socket.IO в отдельном окне
echo [2/2] Запуск сервера игры...
start "World Seek Server" cmd /k "npm run dev"

echo.
echo ===================================================
echo   Всё готово!
echo   Игра доступна по ссылке:
echo   https://remission-wrinkle-prevail.ngrok-free.dev
echo ===================================================
echo.
pause