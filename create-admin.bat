@echo off
title FieldOps - Create Admin Account
echo.
echo ============================================
echo   FieldOps Admin Account Creator
echo ============================================
echo.

set /p FULLNAME=Enter Full Name:
set /p USERNAME=Enter Username:
set /p PASSWORD=Enter Password:
echo.
set /p ISSUPER=Superadmin? (yes/no):

if /i "%ISSUPER%"=="yes" (
    echo.
    echo Creating SUPERADMIN account for %FULLNAME%...
    node make-admin.js "%FULLNAME%" %USERNAME% %PASSWORD% super
) else (
    echo.
    echo Creating admin account for %FULLNAME%...
    node make-admin.js "%FULLNAME%" %USERNAME% %PASSWORD%
)

echo.
echo Copy the command above and paste it to run.
echo.
pause
