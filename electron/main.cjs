const { app, BrowserWindow, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

let backendProcess = null;
let mainWindow = null;

function backendBinaryName() {
  return process.platform === 'win32' ? 'server.exe' : 'server';
}

function resolveBackendBinaryPath() {
  if (process.env.VIBE_BACKEND_BIN) {
    return process.env.VIBE_BACKEND_BIN;
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', backendBinaryName());
  }

  return path.join(__dirname, '..', 'target', 'release', backendBinaryName());
}

function spawnBackend() {
  const backendPath = resolveBackendBinaryPath();
  const env = {
    ...process.env,
    HOST: process.env.HOST || '127.0.0.1',
    DISABLE_BROWSER_OPEN: '1',
  };

  backendProcess = spawn(backendPath, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.on('exit', (code, signal) => {
    if (app.isReady() && !app.isQuitting) {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      dialog.showErrorBox('Vibe Kanban backend stopped', `The backend process exited with ${reason}.`);
      app.quit();
    }
  });

  let stderrBuffer = '';
  backendProcess.stderr?.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for backend to start.\n${stderrBuffer}`));
    }, 30000);

    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/Server running on\s+(http:\/\/[\w.:-]+)/);
      if (match) {
        clearTimeout(timeout);
        backendProcess.stdout?.off('data', onData);
        resolve(match[1]);
      }
    };

    backendProcess.stdout?.on('data', onData);
    backendProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function createWindow(url) {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.loadURL(url);
  mainWindow.setMenuBarVisibility(false);
}

async function bootstrap() {
  try {
    const backendUrl = await spawnBackend();
    createWindow(backendUrl);
  } catch (error) {
    dialog.showErrorBox('Failed to start Vibe Kanban', String(error));
    app.quit();
  }
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
});
