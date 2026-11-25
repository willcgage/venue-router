@echo off
rem Started by the "Venue Router" scheduled task that the installer registers. Runs the app with the Node.js
rem copy that ships beside it, keeps the saved setup in ProgramData, and starts the app again if it ever stops.
setlocal
set "DATA=%ProgramData%\Venue Router"
if not exist "%DATA%\logs" mkdir "%DATA%\logs"
cd /d "%~dp0"
:again
"%~dp0node.exe" server.js --data="%DATA%" >> "%DATA%\logs\venue-router.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto again
