@echo off
cd /d "%~dp0"
title FieldOps push to GitHub

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Install it from git-scm.com and run this again.
  pause
  exit /b 1
)

if not exist .git (
  git init
  git checkout -b main
  git remote add origin https://github.com/excel-experts-consultant/task_status_form.git
)

git add -A
git commit -m "FieldOps update"
echo.
echo Replacing the GitHub copy with this folder...
git push -u origin main --force
echo.
echo GitHub is now building the APK. Open the Actions tab in about 3 minutes
echo and download FieldOps-APK from the newest green run.
start "" "https://github.com/excel-experts-consultant/task_status_form/actions"
pause
