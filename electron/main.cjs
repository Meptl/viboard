const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

let backendProcess = null;
let mainWindow = null;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

const findState = {
  text: '',
  requestId: null,
};

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
      dialog.showErrorBox(
        'Vibe Kanban backend stopped',
        `The backend process exited with ${reason}.`
      );
      app.quit();
    }
  });

  let stderrBuffer = '';
  backendProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk.toString()}`);
  });
  backendProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    process.stderr.write(`[backend] ${text}`);
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

function stopFindInPage(action = 'keepSelection') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.stopFindInPage(action);
  findState.requestId = null;
}

function performFindInPage(text, { forward } = { forward: true }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const query = text.trim();
  if (!query) {
    findState.text = '';
    stopFindInPage('clearSelection');
    return;
  }

  const isSameQuery = findState.text === query;
  if (!isSameQuery) {
    stopFindInPage('keepSelection');
  }

  findState.text = query;
  findState.requestId = mainWindow.webContents.findInPage(query, {
    findNext: isSameQuery,
    forward,
  });
}

async function promptFindText() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const selectedText = await mainWindow.webContents.executeJavaScript(
    `(() => window.getSelection?.()?.toString() ?? '')()`,
    true
  );

  const prefillText = selectedText || findState.text || '';
  const promptScript = `(() => {
    const value = window.prompt('Find on page', ${JSON.stringify(prefillText)});
    return value === null ? null : String(value);
  })()`;

  const query = await mainWindow.webContents.executeJavaScript(promptScript, true);
  if (query === null) {
    return;
  }

  performFindInPage(query, { forward: true });
}

function wireFindShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    const hasMainModifier = process.platform === 'darwin' ? input.meta : input.control;

    if (hasMainModifier && key === 'f' && input.type === 'keyDown') {
      event.preventDefault();
      void promptFindText();
    }
  });

  window.webContents.on('did-start-navigation', () => {
    findState.text = '';
    findState.requestId = null;
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

  wireFindShortcuts(mainWindow);

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

ipcMain.on('app:focus-main-window', () => {
  focusMainWindow();
});

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
