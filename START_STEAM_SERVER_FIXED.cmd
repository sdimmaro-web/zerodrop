@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title DOODROP Steam Server

echo ========================================
echo DOODROP Steam Server - diagnostic start
echo Folder: %CD%
echo ========================================
echo.

if not exist "server.js" (
    echo ERROR: server.js was not found in this folder.
    echo Put this file in the root folder of the site, next to server.js.
    echo.
    pause
    exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or is not in PATH.
    echo Install Node.js 18 or newer, restart Windows, and run this file again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VERSION=%%V"
echo Node.js found: %NODE_VERSION%

if not exist ".env" (
    if not exist ".env.example" (
        echo ERROR: .env.example was not found.
        echo Copy .env.example into this folder and run again.
        echo.
        pause
        exit /b 1
    )
    copy /Y ".env.example" ".env" >nul
    echo Created .env from .env.example
    echo Open .env and add your STEAM_API_KEY.
    echo.
)

echo Checking server.js syntax...
node --check "server.js"
if errorlevel 1 (
    echo.
    echo ERROR: server.js contains a syntax error.
    pause
    exit /b 1
)

echo.
echo Starting server...
echo After you see "DOODROP Steam server started", open:
echo http://localhost:3000
echo.
echo Keep this window open while using the site.
echo Press Ctrl+C to stop the server.
echo ========================================
echo.

node "server.js"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ========================================
echo Server stopped. Exit code: %EXIT_CODE%
echo ========================================
pause
exit /b %EXIT_CODE%
