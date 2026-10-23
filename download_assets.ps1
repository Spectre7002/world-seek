$targetUrl = "https://www.geoguessr.com/"
$outputDir = "D:\world-seek\downloaded_game_assets"
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

Write-Host "Подключаемся к сайту и получаем HTML..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri $targetUrl -UseBasicParsing -Headers @{
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    $htmlContent = $response.Content
} catch {
    Write-Host "Ошибка при загрузке главной страницы: $_" -ForegroundColor Red
    exit
}

# Извлекаем все ссылки из атрибутов src и href
$regex = '(?i)(?:src|href)="([^"]+)"'
$matches = [regex]::Matches($htmlContent, $regex)

$links = foreach ($match in $matches) {
    $match.Groups[1].Value
}

# Фильтруем только нужные клиентские файлы (скрипты, стили, бандлы Next.js)
$validLinks = $links | Where-Object { 
    $_ -match '\.(js|css|png|jpg|svg|webp|json)' -or $_ -match '_next/static'
} | Select-Object -Unique

Write-Host "Найдено уникальных ресурсов: $($validLinks.Count). Начинаем скачивание..." -ForegroundColor Yellow

foreach ($link in $validLinks) {
    try {
        # Формируем абсолютный URL
        if ($link -match '^//') {
            $fileUrl = "https:$link"
        } elseif ($link -match '^/') {
            $fileUrl = "https://www.geoguessr.com$link"
        } elseif ($link -match '^https?://') {
            $fileUrl = $link
        } else {
            continue
        }

        # Определяем локальный путь сохранения с сохранением структуры папок
        $uriObj = [System.Uri]$fileUrl
        $relativePath = $uriObj.AbsolutePath.TrimStart('/')
        if ([string]::IsNullOrEmpty($relativePath)) { continue }
        
        $localPath = Join-Path $outputDir $relativePath
        $localDir = [System.IO.Path]::GetDirectoryName($localPath)
        
        if (-not [System.IO.Directory]::Exists($localDir)) {
            [System.IO.Directory]::CreateDirectory($localDir) | Out-Null
        }

        # Скачиваем файл, если он еще не скачан
        if (-not (Test-Path $localPath)) {
            Write-Host "Скачивается: $fileUrl" -ForegroundColor Gray
            Invoke-WebRequest -Uri $fileUrl -OutFile $localPath -UseBasicParsing -ErrorAction Stop
        }
    } catch {
        # Пропускаем битые или внешние ссылки без вывода лишнего шума
    }
}

Write-Host "Готово! Все файлы сохранены в папку: $outputDir" -ForegroundColor Green