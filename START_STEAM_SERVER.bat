@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js не найден.
    echo Установите Node.js 18 или новее, затем запустите файл снова.
    pause
    exit /b 1
)

if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo Создан файл .env
    echo Откройте его и вставьте STEAM_API_KEY.
    echo.
)

start "" "http://localhost:3000"
node server.js

echo.
echo Сервер остановлен.
pause
