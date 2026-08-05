@echo off
:: DOMScanner Standalone Android APK Build Script
title Build DOMScanner Android APK

echo =======================================================
echo    🤖 Building Standalone Android APK (DOMScanner.apk)
echo =======================================================
echo.

cd /d "%~dp0"

where gradlew >nul 2>nul
if %errorlevel% neq 0 (
    if exist "android\gradlew.bat" (
        cd android
        call gradlew.bat assembleDebug
        cd ..
        if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
            copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "agent\DOMScanner.apk"
            echo ✅ DOMScanner.apk built successfully at agent\DOMScanner.apk
        )
    ) else (
        echo ℹ️ Android Studio / Gradle environment not detected.
        echo To build APK manually: open 'android' folder in Android Studio and click Build APK.
    )
) else (
    call gradlew assembleDebug
    copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "agent\DOMScanner.apk"
    echo ✅ DOMScanner.apk built successfully.
)

pause
