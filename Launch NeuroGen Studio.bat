@echo off
title NeuroGen Studio Desktop
cd /d "%~dp0"
echo.
echo  ==========================================
echo    NeuroGen Studio - Desktop Launcher
echo  ==========================================
echo.
echo  Starting NeuroGen Studio...
echo  This window will close automatically.
echo.
cd desktop
npx electron . 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] Electron failed to start.
    echo  Make sure you ran: cd desktop ^& npm install
    pause
)
