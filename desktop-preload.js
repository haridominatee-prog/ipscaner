/**
 * DOM IP Scanner — Desktop Preload Bridge
 * Exposes safe desktop APIs to renderer process without nodeIntegration security risks.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isDesktopApp', true);
contextBridge.exposeInMainWorld('desktopAPI', {
  platform: process.platform,
  version: '2.0.0'
});
