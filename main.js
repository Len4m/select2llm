import { app, globalShortcut, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConfigWindow } from './windows/configWindow.js';
import { createOverlayWindow } from './windows/overlayWindow.js';
import { registerShortcuts, saveShortcuts } from './controllers/shortcutsController.js';
import { cancelOllama, checkApi } from './controllers/ollamaController.js';
import { getWindowGeometry } from './controllers/keyboardController.js';
import { globals } from './globals.js';
import i18n from './i18n.js';

// Only one instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit()
}

// Get the path of the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


Menu.setApplicationMenu(null);

let configWindow = null,
    transparentWindow = null,
    tray = null,
    iconIndex = 0,
    animationInterval,
    clickTimeout;

// Hide or show configuration window
function hideShowConfig() {
    // Restore/show the main window if it is hidden/minimized
    if (configWindow.isVisible()) {
        configWindow.hide();
    } else {
        configWindow.show();
        configWindow.focus();
    }
}

// Create transparent window
async function createTransparentWindow(obj) {
    transparentWindow = await createOverlayWindow(obj);
}

// Remove transparent window
function removeTransparentWindow() {
    if (transparentWindow) {
        transparentWindow.close();
        transparentWindow = null;
    }
}

// Function to get the path of the current icon
function getIconPath(index) {
    const indexString = index < 10 ? `0${index}` : `${index}`;
    return path.join(__dirname, `images/animation/frame_${indexString}_delay-0.06s.png`);
}

// Start inference process
async function startInference() {
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = setInterval(() => {
        iconIndex = ((iconIndex + 1) % 20);
        tray.setImage(getIconPath(iconIndex));
    }, 150);
    // Create hidden window
    let geo = await getWindowGeometry();
    createTransparentWindow(geo);
    globals.inferencia = true;
}

// Stop inference process
async function stopInference() {
    if (animationInterval) clearInterval(animationInterval);
    tray.setImage(getIconPath(0));
    removeTransparentWindow();
    globals.inferencia = false;
}

// Communication from the configuration window to save shortcuts
ipcMain.on('save-shortcuts', async (event, shortcuts) => {
    saveShortcuts(shortcuts);
    let ollamaIsOk = await checkApi();
    if (ollamaIsOk) {
        registerShortcuts(startInference, stopInference);
    }
});

// Handle external link navigation
ipcMain.on('external-link', (event, url) => {
    shell.openExternal(url);
});

// Handle the cancel event from the frontend
ipcMain.on('cancelar-proceso', () => {
    cancelOllama();
    removeTransparentWindow();
});

// Listen for translation events from the renderer process
ipcMain.on('get-translation', (event, key) => {
    const translation = i18n.t(key);
    event.reply('translation', { key, translation });
});

// Change the language from the renderer and reload translations
ipcMain.on('change-language', (event, language) => {
    i18n.setLanguage(language);
    configWindow.webContents.send('language-changed', i18n.translations); // Send all translations to the renderer
});

// Save configuration from the configuration window
ipcMain.on('save-config', (event, config) => globals.saveConfig(config));

// App initialization
app.whenReady().then(async () => {
    const ollamaIsOk = await checkApi();

    // Create a tray icon
    tray = new Tray(getIconPath(0));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: i18n.t('Configuración (click)'),
            click: async () => {
                hideShowConfig();
            }
        },
        {
            label: i18n.t('Cancelar (doble click)'),
            click: () => {
                cancelOllama();
            },
            enabled: true // TODO
        },
        {
            click: () => {
                if (process.platform !== 'darwin') app.quit();
                process.exit(0);
            },
            label: i18n.t('Salir')
        },
    ]);
    tray.setToolTip('Select2LLM');
    tray.setContextMenu(contextMenu);

    configWindow = await createConfigWindow(ollamaIsOk);
    if (ollamaIsOk) {
        configWindow.hide();
    }

    let clickCount = 0;
    tray.on('click', (event, bounds) => {
        clickCount++;
        if (clickTimeout) clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
            if (clickCount === 2) {
                cancelOllama();
                clickCount = 0;
                return;
            }
            hideShowConfig();
            clickCount = 0; // Reset the counter
        }, 300);
    });

    // Register shortcuts from the JSON file
    if (ollamaIsOk) {
        registerShortcuts(startInference, stopInference);
    }

    // Ensure the app continues running in the background
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) configWindow = await createConfigWindow();
    });
});

// Unregister all shortcuts when the app is closed
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
