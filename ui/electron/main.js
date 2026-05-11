const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let serverProcess = null;
let tray = null;
const isDev = !app.isPackaged;

// ─── Server Management ───

function getServerPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'server', 'index.js');
  }
  // In production, bundled as extraResource
  return path.join(process.resourcesPath, 'server', 'index.js');
}

function getNodePath() {
  // Use the system Node.js
  if (process.platform === 'darwin') {
    const commonPaths = [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      process.execPath.replace('Nexus OS.app', 'node'), // fallback
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return 'node';
}

function startServer() {
  const serverPath = getServerPath();
  
  if (!fs.existsSync(serverPath)) {
    console.log('[nexus] Server not found at', serverPath, '- running in UI-only mode');
    return;
  }

  console.log('[nexus] Starting server:', serverPath);
  
  serverProcess = spawn(getNodePath(), [serverPath], {
    cwd: isDev ? path.join(__dirname, '..', '..') : process.resourcesPath,
    env: {
      ...process.env,
      NEXUS_PORT: '47900',
      NODE_ENV: isDev ? 'development' : 'production',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (data) => {
    console.log('[server]', data.toString().trim());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('[server:err]', data.toString().trim());
  });

  serverProcess.on('close', (code) => {
    console.log('[nexus] Server exited with code', code);
    serverProcess = null;
    
    // Restart server if the app is still running
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[nexus] Restarting server in 2s...');
      setTimeout(startServer, 2000);
    }
  });

  serverProcess.on('error', (err) => {
    console.error('[nexus] Failed to start server:', err.message);
    serverProcess = null;
  });
}

function stopServer() {
  if (serverProcess) {
    console.log('[nexus] Stopping server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ─── Window Management ───

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    title: 'Nexus OS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Show after ready
  });

  // Load the UI
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent title from showing "Nexus OS" in the taskbar
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
}

// ─── Tray ───

function createTray() {
  // Create a 16x16 tray icon programmatically (since we don't have an .icns file yet)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show Nexus', 
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { 
      label: 'Hide Nexus', 
      click: () => mainWindow?.hide() 
    },
    { type: 'separator' },
    {
      label: 'Voice Mode',
      type: 'checkbox',
      checked: false,
      click: (item) => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-voice-mode', item.checked);
        }
      }
    },
    { type: 'separator' },
    { 
      label: 'Quit Nexus', 
      click: () => {
        stopServer();
        app.quit();
      }
    },
  ]);
  
  tray.setToolTip('Nexus OS');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// ─── App Lifecycle ───

app.whenReady().then(() => {
  // Start the Nexus server as a child process
  startServer();

  // Create the main window
  createWindow();
  
  // Create tray (minimal since no icon yet)
  try { createTray(); } catch (e) { /* tray not critical */ }

  // Global shortcut: Alt+Space to toggle Nexus
  globalShortcut.register('Alt+Space', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('focus-intent-bar');
      }
    }
  });

  // Mac: Cmd+Shift+N also toggles
  if (process.platform === 'darwin') {
    globalShortcut.register('Cmd+Shift+N', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  }
});

// macOS: re-create window when dock icon clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Prevent app from quitting when all windows are closed (keep server running)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
