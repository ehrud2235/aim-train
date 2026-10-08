@echo off
rem Valo Aim (Bind) - double-click to run on this PC, then the browser opens by itself
cd /d "%~dp0"
title Valo Aim - keep this window open while you practice

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules goto run
echo Installing files. This happens only the first time...
call npm install --omit=dev
if errorlevel 1 goto fail

:run
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3300"
echo.
echo ================================================================
echo   Valo Aim is running:  http://localhost:3300
echo   Chrome or Edge opens by itself in 2 seconds.
echo   Keep THIS black window open while you practice.
echo   Close it when you are done.
echo ================================================================
echo.
node server.js
goto end

:nonode
echo.
echo [!] Node.js is not installed on this PC.
echo     Install the LTS version from https://nodejs.org
echo     then double-click this file again.
start "" https://nodejs.org
goto end

:fail
echo.
echo [!] Something went wrong while installing. Check your internet connection and try again.

:end
pause
