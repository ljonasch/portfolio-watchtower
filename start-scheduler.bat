@echo off
REM Portfolio Watchtower Scheduler — Windows Startup Script
REM This is run automatically by Windows Task Scheduler on boot/login.
REM Visible in Task Manager as "Portfolio-Watchtower-Scheduler" (PM2 process)

cd /d "%~dp0"
pm2 resurrect
pm2 status
