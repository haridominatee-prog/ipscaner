# DOM IP Scanner — Developer Installation Guide

This document provides step-by-step instructions for setting up **DOM IP Scanner** for local development, web server deployment, mobile APK compilation, and desktop app packaging.

---

## 💻 1. Local Web Development Setup

### System Requirements
- **Operating System**: Windows 10/11, Ubuntu/Debian Linux, macOS 12+, or Orange Pi OS (ARM Linux).
- **Node.js**: v18.0.0 or higher.
- **Git**: Installed and configured.

### Steps
```bash
# 1. Clone the repository
git clone https://github.com/haridominatee-prog/ipscaner.git
cd ipscaner

# 2. Copy Environment Template
cp .env.example .env

# 3. Install NPM Dependencies
npm install

# 4. Start Development Server
npm run dev
```
Navigate to `http://localhost:7890`.

---

## 🖥️ 2. Standalone Desktop App Setup (Electron)

To run or build the Native Desktop Application:

```bash
# Launch Desktop App directly
npm run desktop

# Or launch via Windows batch script
cmd /c DOMScanner-Desktop.bat
```

---

## 📱 3. Android Mobile APK Build Setup (Capacitor & Gradle)

### Android Build Prerequisites
- **JDK**: Java Development Kit 17 or higher.
- **Android SDK**: API Level 34 (Android 14).
- **Gradle**: v9.3.0 (wrapper included).

### Build Commands
```bash
# 1. Sync Frontend Web Assets to Android Assets folder
Copy-Item -Path app.js -Destination "android\app\src\main\assets\public\app.js" -Force
Copy-Item -Path index.html -Destination "android\app\src\main\assets\public\index.html" -Force
Copy-Item -Path style.css -Destination "android\app\src\main\assets\public\style.css" -Force

# 2. Compile APK using Gradle
cd android
cmd /c "C:\Users\HARI\.gradle\wrapper\dists\gradle-9.3.0-bin\79n14ral3mx1ozqr3csh2u872\gradle-9.3.0\bin\gradle.bat assembleDebug --warning-mode none"

# 3. Output APK Location
# android/app/build/outputs/apk/debug/app-debug.apk
```
Or execute the automated build script:
```bash
cmd /c build-apk.bat
```

---

## ☁️ 4. Render Cloud Deployment Guide

DOM IP Scanner is pre-configured for zero-configuration deployment on **Render.com**.

### Deployment Steps
1. Create a **New Web Service** on Render connected to your GitHub repository `haridominatee-prog/ipscaner.git`.
2. **Environment**: `Node`
3. **Build Command**: `npm install`
4. **Start Command**: `node server.js`
5. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: `your_secure_jwt_secret`
6. Click **Deploy Web Service**. Render will automatically assign a URL e.g. `https://ipscaner.onrender.com`.
