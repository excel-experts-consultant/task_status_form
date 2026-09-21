@echo off
setlocal
cd /d "%~dp0"
title FieldOps fresh setup

echo.
echo  ================================================
echo   FieldOps fresh setup
echo   Folder: %cd%
echo   WARNING: this wipes all existing FieldOps data
echo  ================================================
echo.
choice /c YN /m "Continue"
if errorlevel 2 exit /b 0

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from nodejs.org and run this again.
  pause
  exit /b 1
)

echo.
echo [1/7] Installing packages...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

echo.
echo [2/7] Checking Cloudflare sign-in...
call npx wrangler whoami | find /i "logged in" >nul
if errorlevel 1 (
  echo A browser window will open. Approve the Cloudflare sign-in there.
  call npx wrangler login
  if errorlevel 1 goto fail
)

echo.
echo [3/7] Wiping and recreating the database tables...
call npx wrangler d1 execute fieldops --remote --file=schema.sql -y
if errorlevel 1 goto fail

echo.
echo [4/7] Creating 25 admin and 5 employee logins...
node scripts\create-users.mjs 25 5
if errorlevel 1 goto fail

echo.
echo [5/7] Loading logins into the database...
call npx wrangler d1 execute fieldops --remote --file=private\seed-users.sql -y
if errorlevel 1 goto fail

echo.
choice /c YN /m "[6/7] Add 3 TEST sites so you can try the app right away"
if errorlevel 2 goto deploy
call npx wrangler d1 execute fieldops --remote --file=sample-sites.sql -y
if errorlevel 1 goto fail

:deploy
echo.
echo [7/7] Publishing to https://fieldops-bi0.pages.dev (Production)...
call npx wrangler pages deploy public --project-name fieldops --branch fieldops --commit-dirty=true
if errorlevel 1 goto fail

echo.
echo  ================================================
echo   Done.
echo   Logins:  private\logins.csv  (opening now)
echo   Check:   https://fieldops-bi0.pages.dev/api/health
echo   Site:    https://fieldops-bi0.pages.dev
echo  ================================================
start "" notepad "private\logins.csv"
start "" "https://fieldops-bi0.pages.dev/api/health"
pause
exit /b 0

:fail
echo.
echo  Setup stopped at the step above. Copy the error text and send it over.
pause
exit /b 1
