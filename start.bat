@echo off
title Movie Mania - Node.js Server
color 0A

echo ========================================
echo    MOVIE MANIA - NODE.JS SERVER
echo ========================================
echo.

cd /d "%~dp0"

echo Installing dependencies (first time only)...
call npm install

echo.
echo Starting Node.js server...
echo.

start "Movie Mania Server" cmd /c "node server.js"

timeout /t 3

echo.
echo ========================================
echo    SERVER RUNNING!
echo ========================================
echo.
echo Access at: http://localhost:3000
echo.
echo Admin: admin@moviemania.com / admin123
echo User:  user@example.com / user123
echo.
echo Press any key to stop the server...
pause >nul

taskkill /F /IM node.exe >nul 2>&1
echo Server stopped