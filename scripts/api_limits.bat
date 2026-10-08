<# : batch script
@echo off
chcp 65001 > nul
title Проверка лимитов Google Maps API

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText('%~f0', [System.Text.Encoding]::UTF8))"

echo.
echo ---------------------------------------------------
echo Нажмите любую клавишу для закрытия окна...
pause > nul
goto :eof
#>

$project = ((gcloud config get-value project 2>$null | Out-String).Trim())
if (-not $project -or $project -eq "(unset)") {
    $project = $env:GOOGLE_CLOUD_PROJECT
}
if (-not $project) {
    $project = $env:GCLOUD_PROJECT
}
if (-not $project -or $project -eq "(unset)") {
    Write-Host "[!] Не выбран Google Cloud project." -ForegroundColor Red
    Write-Host "    Выполните: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Yellow
    Write-Host "    Или задайте переменную GOOGLE_CLOUD_PROJECT." -ForegroundColor Yellow
    return
}

$token = ((gcloud auth print-access-token 2>$null | Out-String).Trim())
if (-not $token) {
    Write-Host "[!] Не выполнен вход в Google Cloud CLI." -ForegroundColor Red
    Write-Host "    Выполните: gcloud auth login" -ForegroundColor Yellow
    return
}

$startDate = (Get-Date -Day 1 -Hour 0 -Minute 0 -Second 0).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$endDate   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$filter = [URI]::EscapeDataString('metric.type="serviceruntime.googleapis.com/api/request_count"')
$url = "https://monitoring.googleapis.com/v3/projects/$project/timeSeries?filter=$filter&interval.startTime=$startDate&interval.endTime=$endDate"

try {
    $res = Invoke-RestMethod -Uri $url -Headers @{ Authorization = "Bearer $token" } -Method Get
    $m = 0
    $p = 0

    if ($res.timeSeries) {
        foreach ($ts in $res.timeSeries) {
            foreach ($pt in $ts.points) {
                $val = [int64]$pt.value.int64Value
                if ($ts.resource.labels.service -eq 'maps-backend.googleapis.com') {
                    $m += $val
                } else {
                    $p += $val
                }
            }
        }
        
        $leftM = 10000 - $m
        $leftP = 5000 - $p

        Write-Host ""
        Write-Host "=== РАСХОД ЛИМИТОВ ЗА ТЕКУЩИЙ МЕСЯЦ ===" -ForegroundColor Cyan
        Write-Host "Map Loads:  $m / 10000 (Осталось: $leftM)" -ForegroundColor Green
        Write-Host "Panoramas:  $p / 5000  (Осталось: $leftP)" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "Запросы за этот месяц не найдены." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] Ошибка получения данных: $_" -ForegroundColor Red
}