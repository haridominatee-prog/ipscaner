@echo off
:: DOMScanner Standalone Android APK Build Script
title Build DOMScanner Android APK

echo =======================================================
echo    🤖 Building Standalone Android APK (DOMScanner.apk)
echo =======================================================
echo.

cd /d "%~dp0"

set "GRADLE_BIN=C:\Users\HARI\.gradle\wrapper\dists\gradle-9.3.0-bin\79n14ral3mx1ozqr3csh2u872\gradle-9.3.0\bin\gradle.bat"

if exist "%GRADLE_BIN%" (
    cd android
    call "%GRADLE_BIN%" assembleDebug
    cd ..
    if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
        copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "agent\DOMScanner.apk"
        echo.
        echo ✅ DOMScanner.apk built successfully at agent\DOMScanner.apk
    )
) else (
    echo ℹ️ Gradle environment not detected at %GRADLE_BIN%
)

pause
