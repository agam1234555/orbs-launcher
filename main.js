const { app, BrowserWindow, screen, ipcMain, Tray, Menu, shell, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const { exec, spawn, execFile } = child_process;

// Quiet down internal Chromium C++ engine log noise
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-logging');

// Windows DWM sometimes falls back to a solid rectangular frame on
// frameless/transparent Chromium windows when GPU compositing is active.
// Disabling hardware acceleration forces correct alpha compositing.
app.disableHardwareAcceleration();

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let config = null;
let isShown = false;
let activeItem = null; // resolved leaf item (top-level or nested inside a folder), or null

const configPath = path.join(__dirname, 'config.json');
const lucidePath = path.join(__dirname, 'assets', 'lucide.json');

function log(event, detail = '') {
  console.log(`[orbs] ${event}${detail ? ' - ' + detail : ''}`);
}

// ---------- Single instance lock ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openSettingsWindow();
    showWheel();
  });
}

// ---------- Config load / validate / save ----------
const DEFAULT_CONFIG = {
  hotkey: { modifier: 'ctrl', key: 'space' },
  appearance: { orbSize: 470, blurIntensity: 16 },
  items: []
};
const VALID_MODIFIERS = ['ctrl', 'alt', 'shift'];
const VALID_TYPES = ['app', 'cmd', 'url', 'system', 'widget', 'folder'];
const MAX_ITEMS_PER_RING = 12;

function validateItems(items, itemsPath, errors, depth = 1) {
  if (!Array.isArray(items)) {
    errors.push(`${itemsPath} must be an array`);
    return;
  }
  if (items.length > MAX_ITEMS_PER_RING) {
    errors.push(`${itemsPath}: max ${MAX_ITEMS_PER_RING} supported by the wheel layout`);
  }
  if (depth > 3) {
    errors.push(`${itemsPath}: maximum supported nesting depth is 3 levels`);
    return;
  }
  items.forEach((item, i) => {
    const p = `${itemsPath}[${i}]`;
    if (!item.name) errors.push(`${p} missing name`);
    if (!VALID_TYPES.includes(item.type)) errors.push(`${p} invalid type "${item.type}"`);

    if (item.quickKey && (typeof item.quickKey !== 'string' || item.quickKey.length > 1)) {
      errors.push(`${p} quickKey must be a single character string`);
    }

    if (item.type === 'folder') {
      if (depth === 3) {
        errors.push(`${p}: Level 3 items cannot be folders (max 3 levels total)`);
      } else if (!Array.isArray(item.children) || item.children.length === 0) {
        errors.push(`${p} folder must have a non-empty children array`);
      } else {
        validateItems(item.children, `${p}.children`, errors, depth + 1);
      }
    } else if (item.type !== 'widget' && !item.target) {
      errors.push(`${p} missing target`);
    }
  });
}

function validateConfig(raw) {
  const errors = [];
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Config is not an object'] };
  }
  if (!raw.hotkey || !VALID_MODIFIERS.includes(String(raw.hotkey.modifier).toLowerCase())) {
    errors.push('hotkey.modifier must be one of: ' + VALID_MODIFIERS.join(', '));
  }
  if (!raw.hotkey || typeof raw.hotkey.key !== 'string' || !raw.hotkey.key.trim()) {
    errors.push('hotkey.key must be a non-empty string');
  }

  if (!raw.appearance) {
    raw.appearance = { orbSize: 470, blurIntensity: 16 };
  } else {
    if (typeof raw.appearance.orbSize !== 'number' || raw.appearance.orbSize < 300 || raw.appearance.orbSize > 650) {
      errors.push('appearance.orbSize must be a number between 300 and 650');
    }
    if (typeof raw.appearance.blurIntensity !== 'number' || raw.appearance.blurIntensity < 0 || raw.appearance.blurIntensity > 50) {
      errors.push('appearance.blurIntensity must be a number between 0 and 50');
    }
  }

  validateItems(raw.items, 'items', errors, 1);
  return { valid: errors.length === 0, errors };
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { valid, errors } = validateConfig(raw);
      if (!valid) {
        console.error('Config validation failed:', errors);
        dialog.showErrorBox(
          'Orbs: invalid config.json',
          'Falling back to an empty wheel until this is fixed:\n\n' + errors.join('\n')
        );
        config = DEFAULT_CONFIG;
        return;
      }
      config = raw;
    } else {
      config = DEFAULT_CONFIG;
    }
  } catch (err) {
    console.error('Error loading config:', err);
    dialog.showErrorBox('Orbs: config.json is not valid JSON', String(err.message || err));
    config = DEFAULT_CONFIG;
  }
}
loadConfig();

function saveConfig(newConfig) {
  const { valid, errors } = validateConfig(newConfig);
  if (!valid) {
    return { ok: false, errors };
  }
  try {
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    config = newConfig;
    if (mainWindow) {
      mainWindow.webContents.send('config-reloaded', config);
      mainWindow.reload();
    }
    registerShortcutFromConfig();
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  }
}

// ---------- Tray icon ----------
function getTrayIcon() {
  const customIcon = path.join(__dirname, 'assets', 'tray-icon.png');
  if (fs.existsSync(customIcon)) {
    return nativeImage.createFromPath(customIcon);
  }
  const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2NkoBAwUqifgbqGkSgDGBkYGBjJ0gwygJGBgYGRIs0gAxgZGBgYKdIMEgADAQAD/gD+1u1cWgAAAABJRU5ErkJggg==';
  return nativeImage.createFromBuffer(Buffer.from(base64Data, 'base64'));
}

// ---------- Wheel window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 900,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('blur', () => hideWheel());
}

function showWheel() {
  if (isShown) return;
  if (!mainWindow) createWindow();

  activeItem = null;

  const mouse = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(mouse); // multi-monitor: spawn on screen under cursor
  const width = 900;
  const height = 900;

  let x = mouse.x - Math.floor(width / 2);
  let y = mouse.y - Math.floor(height / 2);

  const b = display.workArea;
  x = Math.min(Math.max(x, b.x), b.x + b.width - width);
  y = Math.min(Math.max(y, b.y), b.y + b.height - height);

  mainWindow.setBounds({ x, y, width, height });
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('show-wheel', { mouseX: mouse.x, mouseY: mouse.y });
  isShown = true;
  log('wheel-shown');
}

function hideWheel(executeAction = false) {
  if (!isShown) return;

  if (executeAction && activeItem) {
    if (activeItem.type === 'widget' || activeItem.type === 'search') {
      log('locked-mode-active', activeItem.name || activeItem.type);
      // Keep wheel open so the user can interact with the widget or search!
      return;
    }
  }

  mainWindow.hide();
  isShown = false;

  if (executeAction && activeItem) {
    log('action-fired', activeItem.name);
    runAction(activeItem);
  } else {
    log('wheel-hidden');
  }
  activeItem = null;
}

ipcMain.on('active-item-changed', (event, item) => { activeItem = item; });
ipcMain.on('release-trigger', () => hideWheel(true));

// ---------- Config / icons IPC (used by both wheel + settings windows) ----------
ipcMain.handle('get-config', () => config);
ipcMain.handle('get-lucide-icons', () => {
  try {
    return JSON.parse(fs.readFileSync(lucidePath, 'utf8'));
  } catch {
    return [];
  }
});
ipcMain.handle('save-config', (event, newConfig) => saveConfig(newConfig));
ipcMain.handle('pick-app-target', async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    title: 'Choose an application',
    properties: ['openFile'],
    filters: [{ name: 'Executables & Shortcuts', extensions: ['exe', 'lnk'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});
ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('set-autostart', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath
  });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('get-app-icon', async (event, targetPath) => {
  if (!targetPath) return null;
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'normal' });
    return icon ? icon.toDataURL() : null;
  } catch (err) {
    return null;
  }
});

// ---------- Start Menu Apps Scanner ----------
function scanStartMenuDir(dirPath, apps = []) {
  if (!fs.existsSync(dirPath)) return apps;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanStartMenuDir(fullPath, apps);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
        const cleanName = entry.name.slice(0, -4);
        const lower = cleanName.toLowerCase();
        if (
          !lower.includes('uninstall') &&
          !lower.includes('unins000') &&
          !lower.includes('help') &&
          !lower.includes('website') &&
          !lower.includes('readme') &&
          !lower.includes('documentation')
        ) {
          try {
            const sc = shell.readShortcutLink(fullPath);
            let appPath = fullPath;
            if (sc && sc.target && fs.existsSync(sc.target)) {
              const targetLower = sc.target.toLowerCase();
              const hasArgs = Boolean(sc.args && sc.args.trim().length > 0);
              const isProxy = targetLower.endsWith('chrome_proxy.exe') ||
                              (targetLower.endsWith('chrome.exe') && hasArgs) ||
                              (targetLower.endsWith('msedge.exe') && hasArgs) ||
                              (targetLower.endsWith('brave.exe') && hasArgs);
              if (!hasArgs && !isProxy) {
                appPath = sc.target;
              }
            }
            apps.push({ name: cleanName, path: appPath });
          } catch (scErr) {
            apps.push({ name: cleanName, path: fullPath });
          }
        }
      }
    }
  } catch (err) {
    console.error('Error scanning Start Menu dir:', dirPath, err);
  }
  return apps;
}

function getStoreApps() {
  return new Promise((resolve) => {
    const psScript = 'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json';
    child_process.execFile('powershell', ['-NoProfile', '-Command', psScript], { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const arr = Array.isArray(data) ? data : [data];
        const apps = arr.map(item => {
          if (!item || !item.Name || !item.AppID) return null;
          const name = String(item.Name).trim();
          const lower = name.toLowerCase();
          if (lower.includes('uninstall') || lower.includes('unins000') || String(item.AppID).startsWith('http')) return null;

          let appPath = item.AppID;
          if (item.AppID.includes('!') || !item.AppID.includes('\\')) {
            appPath = 'shell:AppsFolder\\' + item.AppID;
          }
          return { name, path: appPath };
        }).filter(Boolean);
        resolve(apps);
      } catch (parseErr) {
        resolve([]);
      }
    });
  });
}

ipcMain.handle('get-installed-apps', async () => {
  const sysDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu');
  const userDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu');
  let apps = [];
  apps = scanStartMenuDir(sysDir, apps);
  apps = scanStartMenuDir(userDir, apps);

  const storeApps = await getStoreApps();
  apps = apps.concat(storeApps);

  const seen = new Set();
  const uniqueApps = [];
  for (const appItem of apps) {
    if (!appItem.name || !appItem.path) continue;
    const key = appItem.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueApps.push(appItem);
    }
  }
  return uniqueApps.sort((a, b) => a.name.localeCompare(b.name));
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) settingsWindow.close();
});

// ---------- Action execution ----------
async function runAction(item) {
  if (!item || !item.type || !item.target) return;
  const rawTarget = item.target.trim();

  switch (item.type) {
    case 'app': {
      let targetPath = rawTarget;

      if (targetPath.toLowerCase().startsWith('shell:appsfolder\\')) {
        shell.openPath(targetPath).catch(() => {
          exec(`explorer.exe "${targetPath}"`);
        });
        break;
      }

      if (targetPath.toLowerCase().endsWith('.lnk')) {
        if (fs.existsSync(targetPath)) {
          try {
            const sc = shell.readShortcutLink(targetPath);
            if (sc && sc.target && fs.existsSync(sc.target)) {
              if (sc.args && sc.args.trim()) {
                const argsArray = sc.args.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [sc.args.trim()];
                const cleanArgs = argsArray.map(a => a.replace(/^"|"$/g, ''));
                const spawnOpts = { detached: true, shell: false, stdio: 'ignore' };
                if (sc.cwd && fs.existsSync(sc.cwd)) {
                  spawnOpts.cwd = sc.cwd;
                }
                const child = spawn(sc.target, cleanArgs, spawnOpts);
                child.on('error', () => {
                  shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
                });
                child.unref();
                break;
              }
            }
          } catch (err) {}

          shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
          break;
        }
      }

      if (fs.existsSync(targetPath)) {
        try {
          const child = spawn(targetPath, [], { detached: true, shell: false, stdio: 'ignore' });
          child.on('error', () => {
            shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
          });
          child.unref();
        } catch (spawnErr) {
          shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
        }
      } else {
        try {
          const child = spawn(targetPath, [], { detached: true, shell: true, stdio: 'ignore' });
          child.on('error', () => {
            shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
          });
          child.unref();
        } catch (err) {
          shell.openPath(targetPath).catch(() => exec(`start "" "${targetPath}"`));
        }
      }
      break;
    }

    case 'cmd':
      exec(rawTarget, (err) => {
        if (err) console.error(`Failed to run command: ${rawTarget}`, err);
      });
      break;

    case 'url': {
      let url = rawTarget;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      shell.openExternal(url);
      break;
    }

    case 'system':
      runSystemAction(rawTarget);
      break;

    case 'folder':
      console.warn('Folders are not directly executable.');
      break;

    default:
      console.warn(`Unknown action type: ${item.type}`);
  }
}

function runSystemAction(action) {
  const os = require('os');
  const path = require('path');

  switch (action) {
    case 'open-settings':
      openSettingsWindow();
      break;
    case 'toggle-dark-mode': {
      const psCommand = `
        $path = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
        $val = Get-ItemProperty -Path $path -Name AppsUseLightTheme;
        $newVal = if ($val.AppsUseLightTheme -eq 0) { 1 } else { 0 };
        Set-ItemProperty -Path $path -Name AppsUseLightTheme -Value $newVal;
        Set-ItemProperty -Path $path -Name SystemUsesLightTheme -Value $newVal;
      `.replace(/\s+/g, ' ').trim();
      exec(`powershell.exe -NoProfile -Command "${psCommand}"`);
      break;
    }
    case 'empty-trash':
      exec('powershell.exe -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"');
      break;
    case 'lock-screen':
      exec('rundll32.exe user32.dll,LockWorkStation');
      break;
    case 'sleep-pc':
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
      break;
    case 'restart-pc':
      exec('shutdown /r /t 0');
      break;
    case 'shutdown-pc':
      exec('shutdown /s /t 0');
      break;
    case 'log-off':
      exec('shutdown /l');
      break;
    case 'task-manager':
      exec('taskmgr.exe');
      break;
    case 'control-panel':
      exec('control.exe');
      break;
    case 'win-settings':
      exec('start ms-settings:');
      break;
    case 'screen-clip':
    case 'snipping-tool':
      exec('start ms-screenclip:');
      break;
    case 'device-manager':
      exec('devmgmt.msc');
      break;
    case 'disk-cleanup':
      exec('cleanmgr.exe');
      break;

    // Media & Volume controls via PowerShell WScript.Shell
    case 'volume-mute':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"');
      break;
    case 'volume-down':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"');
      break;
    case 'volume-up':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"');
      break;
    case 'media-next':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"');
      break;
    case 'media-prev':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"');
      break;
    case 'media-play-pause':
      exec('powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"');
      break;

    // Quick Folder Shortcuts
    case 'open-downloads':
      shell.openPath(path.join(os.homedir(), 'Downloads'));
      break;
    case 'open-documents':
      shell.openPath(path.join(os.homedir(), 'Documents'));
      break;
    case 'open-pictures':
      shell.openPath(path.join(os.homedir(), 'Pictures'));
      break;
    case 'open-desktop-folder':
      shell.openPath(path.join(os.homedir(), 'Desktop'));
      break;
    case 'open-temp':
      shell.openPath(os.tmpdir());
      break;
    case 'quit-app':
      app.quit();
      break;

    default:
      console.warn(`Unknown system action: ${action}`);
  }
}

// ---------- Hotkey ----------
function hotkeyAccelerator() {
  const modMap = { ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
  const mod = modMap[(config.hotkey?.modifier || 'ctrl').toLowerCase()] || 'Control';
  const key = (config.hotkey?.key || 'space').replace(/^\w/, c => c.toUpperCase());
  return `${mod}+${key}`;
}

function registerShortcutFromConfig() {
  globalShortcut.unregisterAll();
  const accelerator = hotkeyAccelerator();
  let ret = globalShortcut.register(accelerator, () => showWheel());
  if (!ret) {
    console.error(`Failed to register primary shortcut: ${accelerator}`);
  } else {
    log('shortcut-registered', accelerator);
  }
  if (accelerator !== 'Alt+Space') {
    globalShortcut.register('Alt+Space', () => showWheel());
  }
}

// ---------- Settings window ----------
function openSettingsWindow() {
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 680,
    height: 760,
    title: 'Orbs Settings',
    resizable: true,
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---------- Tray ----------
function setupTray() {
  tray = new Tray(getTrayIcon());
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Orbs Launcher', enabled: false },
    { type: 'separator' },
    { label: 'Show Wheel', click: () => showWheel() },
    { label: 'Settings...', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Orbs Radial Launcher (Click to toggle)');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWheel());
  tray.on('double-click', () => openSettingsWindow());
}

app.whenReady().then(() => {
  setupTray();
  createWindow();
  registerShortcutFromConfig();
  log('app-ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
