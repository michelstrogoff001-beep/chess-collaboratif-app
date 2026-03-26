const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

  // Start the server first
  startServer();

  // Load the app
  mainWindow.loadFile('client/index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Open DevTools in development
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Create menu
  createMenu();
}

function startServer() {
  try {
    serverProcess = spawn('node', ['server/server.js'], {
      stdio: 'pipe',
      cwd: __dirname
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });

    serverProcess.on('close', (code) => {
      console.log(`Server process exited with code ${code}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

function createMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouvelle partie',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.reload();
          }
        },
        {
          label: 'Quitter',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Rétablir', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copier', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Coller', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Forcer Recharger', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Outils Dev', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Taille réelle', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom avant', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein écran', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Fenêtre',
      submenu: [
        { label: 'Minimiser', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Fermer', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: async () => {
            const { dialog } = require('electron');
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Échecs Collaboratif',
              message: 'Échecs Collaboratif v1.0.0',
              detail: 'Jeu d\'échecs collaboratif multi-plateforme avec IA avancée et chat vocal.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// App quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (navigationEvent, navigationURL) => {
    navigationEvent.preventDefault();
    shell.openExternal(navigationURL);
  });
});

// Handle app protocol for deep links
app.setAsDefaultProtocolClient('chess-collaboratif');

// Handle deep links
app.on('open-url', (event, url) => {
  event.preventDefault();
  // Handle deep link like chess-collaboratif://room/abc123
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url);
  }
});
