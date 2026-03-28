import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import {
  getRecentProjects,
  addRecentProject,
  isCitadelProject,
} from './projects.js';
import { FileSystemRepository } from './repository.js';
import { startWsServer, type WsServerHandle } from './ws-server.js';
import * as fs from 'fs';
import { validateLicense, isPro, getLicenseInfo, clearLicense, saveLicenseKey, loadSavedLicense } from './license.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

function log(msg: string): void {
  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`[main] ${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let repository: FileSystemRepository | null = null;
let wsHandle: WsServerHandle | null = null;

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

function wrapHandler<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  return fn().catch((err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle('projects:list', () =>
    wrapHandler(async () => getRecentProjects())
  );

  ipcMain.handle('projects:open', (_event, projectPath: string) =>
    wrapHandler(async () => {
      if (!isCitadelProject(projectPath)) {
        throw new Error(
          'No .planning/ directory found. Is this a Citadel-enabled project?'
        );
      }

      addRecentProject(projectPath);

      // Shut down existing ws-server if switching projects
      if (wsHandle) {
        wsHandle.close();
        wsHandle = null;
      }

      repository = new FileSystemRepository(projectPath);
      wsHandle = await startWsServer(projectPath);

      log(`Project opened: ${projectPath} (ws port: ${wsHandle.port})`);

      // Notify renderer
      mainWindow?.webContents.send('project:opened', projectPath);
      mainWindow?.webContents.send('ws:port', wsHandle.port);

      return { projectPath, wsPort: wsHandle.port };
    })
  );

  ipcMain.handle('campaigns:list', () =>
    wrapHandler(async () => {
      if (!repository) throw new Error('No project open');
      return repository.getCampaigns();
    })
  );

  ipcMain.handle('fleet:list', () =>
    wrapHandler(async () => {
      if (!repository) throw new Error('No project open');
      return repository.getFleetSessions();
    })
  );

  ipcMain.handle('health:get', () =>
    wrapHandler(async () => {
      if (!repository) throw new Error('No project open');
      return repository.getHealth();
    })
  );

  ipcMain.handle('skills:list', () =>
    wrapHandler(async () => {
      if (!repository) throw new Error('No project open');
      return repository.getSkills();
    })
  );

  ipcMain.handle('ws:port', () =>
    wrapHandler(async () => {
      if (!wsHandle) throw new Error('No WebSocket server running');
      return wsHandle.port;
    })
  );

  ipcMain.handle('dialog:openDir', () =>
    wrapHandler(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select a Citadel project',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    })
  );

  ipcMain.handle('license:validate', (_event, key: string) =>
    wrapHandler(async () => {
      const result = await validateLicense(key);
      if (result.valid) {
        saveLicenseKey(app.getPath('userData'), key);
      }
      return result;
    })
  );

  ipcMain.handle('license:get', () =>
    wrapHandler(async () => getLicenseInfo())
  );

  ipcMain.handle('license:isPro', () =>
    wrapHandler(async () => isPro())
  );

  ipcMain.handle('license:clear', () =>
    wrapHandler(async () => {
      clearLicense();
      // Remove saved key
      const licenseFile = path.join(app.getPath('userData'), 'citadel-license.json');
      try { fs.unlinkSync(licenseFile); } catch { /* already gone */ }
      return { cleared: true };
    })
  );

  ipcMain.handle('shell:openExternal', (_event, url: string) =>
    wrapHandler(async () => {
      // Only allow https:// URLs to prevent protocol abuse
      if (typeof url === 'string' && url.startsWith('https://')) {
        await shell.openExternal(url);
        return { opened: true };
      }
      throw new Error('Only https:// URLs are permitted');
    })
  );

  ipcMain.handle('campaigns:detail', (_event, slug: string) =>
    wrapHandler(async () => {
      if (!repository) throw new Error('No project open');
      return repository.getCampaignDetail(slug);
    })
  );

  ipcMain.handle('analytics:timeline', () =>
    wrapHandler(async () => {
      if (!isPro()) throw new Error('PRO_REQUIRED');
      if (!repository) throw new Error('No project open');
      return repository.getCampaignTimeline();
    })
  );

  ipcMain.handle('analytics:token-economics', () =>
    wrapHandler(async () => {
      if (!isPro()) throw new Error('PRO_REQUIRED');
      if (!repository) throw new Error('No project open');
      return repository.getHealth();
    })
  );

  ipcMain.handle('analytics:fleet', () =>
    wrapHandler(async () => {
      if (!isPro()) throw new Error('PRO_REQUIRED');
      if (!repository) throw new Error('No project open');
      return repository.getFleetAnalytics();
    })
  );

  ipcMain.handle('analytics:telemetry', (_event, campaignSlug?: string) =>
    wrapHandler(async () => {
      if (!isPro()) throw new Error('PRO_REQUIRED');
      if (!repository) throw new Error('No project open');
      return repository.getTelemetryEvents(campaignSlug);
    })
  );

  ipcMain.handle('analytics:aggregate', () =>
    wrapHandler(async () => {
      if (!isPro()) throw new Error('PRO_REQUIRED');
      if (!repository) throw new Error('No project open');
      return repository.getAggregateAnalytics();
    })
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpcHandlers();

  // Restore saved license on startup
  const savedKey = loadSavedLicense(app.getPath('userData'));
  if (savedKey) {
    validateLicense(savedKey).catch(() => { /* non-fatal */ });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  wsHandle?.close();
  if (process.platform !== 'darwin') app.quit();
});
