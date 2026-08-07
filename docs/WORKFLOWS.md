# Developer Workflows & Operations Guide

This guide details common developer workflows for modifying, building, testing, and deploying **DOM IP Scanner**.

---

## 🛠️ Workflow 1: Developing & Testing the Android App

1. **Edit Native Java Plugin**:
   Modify `android/app/src/main/java/com/domscanner/app/NetworkScannerPlugin.java`.
2. **Edit Frontend Application Logic**:
   Modify `app.js`, `index.html`, or `style.css`.
3. **Sync Web Assets**:
   ```powershell
   Copy-Item app.js android/app/src/main/assets/public/app.js -Force
   Copy-Item index.html android/app/src/main/assets/public/index.html -Force
   Copy-Item style.css android/app/src/main/assets/public/style.css -Force
   ```
4. **Compile APK**:
   ```powershell
   cmd /c build-apk.bat
   ```
5. **Test on Physical Device**:
   Install `agent/DOMScanner.apk` on an Android 10+ phone connected to Wi-Fi.

---

## 🖥️ Workflow 2: Packaging the Standalone Desktop Application

1. **Edit Desktop Entry Process**:
   Modify `desktop-main.js` or `desktop-preload.js`.
2. **Run Desktop App locally**:
   ```bash
   npm run desktop
   ```
3. **Test Windows Batch Launcher**:
   Double-click `DOMScanner-Desktop.bat`.

---

## ☁️ Workflow 3: Deploying Updates to Render Cloud

1. **Commit & Push to GitHub**:
   ```bash
   git add .
   git commit -m "Feature: Description of feature"
   git push origin main
   ```
2. **Automatic Deployment**:
   Render automatically triggers a build and deploys the new revision to `https://ipscaner.onrender.com`.
