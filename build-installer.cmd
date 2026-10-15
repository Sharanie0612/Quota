@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call npm run package:windows
set "build_exit=%errorlevel%"
echo.
if not "%build_exit%"=="0" echo Build failed. See the error above.
if /i not "%~1"=="--no-pause" pause
exit /b %build_exit%
