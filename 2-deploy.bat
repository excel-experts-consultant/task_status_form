@echo off
cd /d "%~dp0"
title FieldOps deploy
echo Publishing public\ to https://fieldops-bi0.pages.dev (Production)...
call npx wrangler pages deploy public --project-name fieldops --branch fieldops --commit-dirty=true
echo.
pause
