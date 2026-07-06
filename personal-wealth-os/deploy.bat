@echo off
echo === Personal Wealth OS - Firebase Deploy ===
echo.

cd /d "%~dp0"

echo Step 1: Login to Firebase...
call firebase login
if errorlevel 1 (
    echo Login failed!
    pause
    exit /b 1
)

echo.
echo Step 2: Deploying to Firebase Hosting...
call firebase deploy --only hosting
if errorlevel 1 (
    echo Deploy failed!
    pause
    exit /b 1
)

echo.
echo === Deploy Complete! ===
echo.
echo Next steps:
echo 1. Go to https://console.firebase.google.com/project/personal-wealth-os-1deac/hosting
echo 2. Click "Add custom domain" and enter wealthup.cc
echo 3. Add DNS records as instructed by Firebase
echo 4. Add wealthup.cc to Firebase Auth authorized domains:
echo    https://console.firebase.google.com/project/personal-wealth-os-1deac/authentication/settings
echo.
pause