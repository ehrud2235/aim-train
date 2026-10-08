@echo off
rem Valo Aim (Bind) - run on this PC without internet. Normally just open the web address instead.
cd /d "%~dp0"
title Valo Aim - keep this window open while you practice

where node >nul 2>nul
if errorlevel 1 goto nonode

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
echo     You do not need it: open https://ehrud2235.github.io/aim-train/ instead.
echo     (To run offline, install the LTS version from https://nodejs.org)
start "" https://ehrud2235.github.io/aim-train/

:end
pause
