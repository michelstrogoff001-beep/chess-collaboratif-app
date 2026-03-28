const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  
  // App controls
  minimize: () => ipcRenderer.invoke('minimize-window'),
  maximize: () => ipcRenderer.invoke('maximize-window'),
  close: () => ipcRenderer.invoke('close-window'),
  
  // Deep links
  onDeepLink: (callback) => ipcRenderer.on('deep-link', callback),
  
  // System info
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // File operations
  selectFile: () => ipcRenderer.invoke('select-file'),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  
  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  
  // Voice recording permissions
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone'),
  
  // App state
  onAppEvent: (event, callback) => ipcRenderer.on(event, callback),
  removeAppListener: (event, callback) => ipcRenderer.removeListener(event, callback)
});

// Security: prevent node integration in renderer
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency]);
  }
});
