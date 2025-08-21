import { app, globalShortcut, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConfigWindow } from './windows/configWindow.js';
import { createOverlayWindow } from './windows/overlayWindow.js';
import logger from './services/logger.js';
import configService from './services/configService.js';
import ollamaService from './services/ollamaService.js';
import shortcutService from './services/shortcutService.js';
import platformService from './services/platformService.js';
import errorService from './services/errorService.js';
import i18n from './i18n.js';
import { APP_CONFIG, WINDOW_CONFIG, TRAY_CONFIG, ANIMATION_CONFIG } from './constants/index.js';

// Only one instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    logger.info('Another instance is already running, exiting');
    app.quit();
}

// Get the path of the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


Menu.setApplicationMenu(null);

// Estado de la aplicación
let configWindow = null;
let transparentWindow = null;
let tray = null;
let iconIndex = 0;
let animationInterval;
let clickTimeout;
let isInferenceActive = false;

logger.info('Application starting', {
    version: APP_CONFIG.VERSION,
    platform: process.platform,
    nodeVersion: process.version
});

// Hide or show configuration window
function hideShowConfig() {
    try {
        if (configWindow.isVisible()) {
            configWindow.hide();
            logger.debug('Config window hidden');
        } else {
            configWindow.show();
            configWindow.focus();
            logger.debug('Config window shown');
        }
    } catch (error) {
        logger.error('Error toggling config window', { error: error.message });
    }
}

// Create transparent window
async function createTransparentWindow(obj) {
    try {
        transparentWindow = await createOverlayWindow(obj);
        logger.debug('Transparent window created', obj);
    } catch (error) {
        logger.error('Failed to create transparent window', { error: error.message });
        throw error;
    }
}

// Remove transparent window
function removeTransparentWindow() {
    try {
        if (transparentWindow) {
            transparentWindow.close();
            transparentWindow = null;
            logger.debug('Transparent window removed');
        }
    } catch (error) {
        logger.error('Error removing transparent window', { error: error.message });
    }
}

// Function to get the path of the current icon
function getIconPath(index) {
    const indexString = index < 10 ? `0${index}` : `${index}`;
    return path.join(__dirname, `${ANIMATION_CONFIG.ANIMATION_DIR}/frame_${indexString}_delay-0.06s.png`);
}

// Start inference process
async function startInference(overlay = true) {
    try {
        logger.info('Starting inference', { overlay });
        
        if (animationInterval) clearInterval(animationInterval);
        
        animationInterval = setInterval(() => {
            iconIndex = ((iconIndex + 1) % ANIMATION_CONFIG.FRAMES);
            tray.setImage(getIconPath(iconIndex));
        }, ANIMATION_CONFIG.FRAME_DELAY);
        
        // Create overlay window if requested
        if (overlay) {
            try {
                const geometry = await platformService.getWindowGeometry();
                await createTransparentWindow(geometry);
            } catch (error) {
                logger.warn('Failed to create overlay window', { error: error.message });
                // Continue without overlay
            }
        }
        
        isInferenceActive = true;
        
    } catch (error) {
        logger.error('Error starting inference', { error: error.message });
        throw error;
    }
}

// Stop inference process
async function stopInference(overlay = true) {
    try {
        logger.info('Stopping inference', { overlay });
        
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
        
        tray.setImage(getIconPath(0));
        
        if (overlay) {
            removeTransparentWindow();
        }
        
        isInferenceActive = false;
        
    } catch (error) {
        logger.error('Error stopping inference', { error: error.message });
    }
}

// Update tray menu with current language
function updateTrayMenu() {
    if (!tray) return;
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: i18n.t('Configuración (click)'),
            click: () => hideShowConfig()
        },
        {
            label: i18n.t('Cancelar (doble click)'),
            click: () => {
                try {
                    ollamaService.cancel();
                    removeTransparentWindow();
                } catch (error) {
                    logger.error('Error cancelling from tray', { error: error.message });
                }
            },
            enabled: true
        },
        {
            label: i18n.t('Salir'),
            click: () => {
                logger.info('Exit requested from tray');
                if (process.platform !== 'darwin') app.quit();
                process.exit(0);
            }
        }
    ]);
    
    tray.setContextMenu(contextMenu);
    logger.debug('Tray menu updated with current language', { language: i18n.language });
}

// Communication from the configuration window to save shortcuts
ipcMain.on('save-shortcuts', async (event, shortcuts) => {
    try {
        logger.info('Saving shortcuts from config window', { count: shortcuts.length });
        
        configService.saveShortcuts(shortcuts);
        
        const ollamaIsOk = await ollamaService.checkAvailability();
        if (ollamaIsOk) {
            shortcutService.setCallbacks(startInference, stopInference);
            await shortcutService.registerShortcuts();
        } else {
            logger.warn('Ollama not available, shortcuts not registered');
        }
    } catch (error) {
        logger.error('Error saving shortcuts', { error: error.message });
        errorService.handleError('SHORTCUT_SAVE_FAILED', error);
    }
});

// Handle external link navigation
ipcMain.on('external-link', (event, url) => {
    shell.openExternal(url);
});

// Handle the cancel event from the frontend
ipcMain.on('cancelar-proceso', () => {
    try {
        logger.info('Cancel process requested from frontend');
        ollamaService.cancel();
        removeTransparentWindow();
    } catch (error) {
        logger.error('Error cancelling process', { error: error.message });
    }
});

// Listen for translation events from the renderer process
ipcMain.on('get-translation', (event, key) => {
    const translation = i18n.t(key);
    event.reply('translation', { key, translation });
});

// Change the language from the renderer and reload translations
ipcMain.on('change-language', (event, language) => {
    try {
        logger.info('Language change requested', { language });
        i18n.setLanguage(language);
        configService.set('language', language);
        
        // Update tray menu with new language
        updateTrayMenu();
        
        configWindow.webContents.send('language-changed', i18n.translations);
    } catch (error) {
        logger.error('Error changing language', { error: error.message });
    }
});

// Save configuration from the configuration window
ipcMain.on('save-config', (event, config) => {
    try {
        logger.info('Configuration save requested', { config });
        configService.saveConfig(config);
    } catch (error) {
        logger.error('Error saving configuration', { error: error.message });
        errorService.handleError('CONFIG_SAVE_FAILED', error);
    }
});

// Restart application from the configuration window
ipcMain.on('restart-application', (event) => {
    try {
        logger.info('Application restart requested from UI');
        configService.restartApplication();
    } catch (error) {
        logger.error('Error restarting application', { error: error.message });
    }
});

// Send UI constants to the configuration window
ipcMain.on('get-ui-constants', (event) => {
    try {
        // Importar dinámicamente las constantes
        import('./constants/index.js').then(({ UI_CONFIG }) => {
            logger.debug('Sending UI constants to renderer', { uiConfig: UI_CONFIG });
            event.reply('ui-constants', UI_CONFIG);
        }).catch((importError) => {
            logger.error('Error importing UI constants', { error: importError.message });
            // Enviar fallback en caso de error
            event.reply('ui-constants', {
                ZOOM: {
                    MIN: 100,
                    MAX: 150,
                    DEFAULT: 100,
                    STEP: 10
                }
            });
        });
    } catch (error) {
        logger.error('Error sending UI constants', { error: error.message });
        // Enviar fallback en caso de error
        event.reply('ui-constants', {
            ZOOM: {
                MIN: 100,
                MAX: 150,
                DEFAULT: 100,
                STEP: 10
            }
        });
    }
});

// App initialization
app.whenReady().then(async () => {
    try {
        logger.info('App ready, initializing...');
        
        // Update i18n with config language if different from current
        const config = configService.getConfig();
        const previousLanguage = i18n.language;
        i18n.updateFromConfig(config);
        
        // If language changed, we'll update tray menu after creating it
        
        // Check Ollama availability
        const ollamaIsOk = await ollamaService.checkAvailability();
        logger.info('Ollama availability check completed', { available: ollamaIsOk });

        // Create tray icon
        tray = new Tray(getIconPath(0));
        logger.debug('Tray icon created');

        // Create initial tray menu
        updateTrayMenu();
        
        tray.setToolTip(TRAY_CONFIG.TOOLTIP);
        
        // Update tray menu if language was different from system language
        if (previousLanguage !== i18n.language) {
            logger.info('Language updated from config, updating tray menu', { 
                from: previousLanguage, 
                to: i18n.language 
            });
            updateTrayMenu();
        }

        // Create configuration window
        configWindow = await createConfigWindow(ollamaIsOk);
        if (ollamaIsOk) {
            configWindow.hide();
        }
        logger.debug('Configuration window created');

        // Handle tray clicks (single/double click)
        let clickCount = 0;
        tray.on('click', (event, bounds) => {
            clickCount++;
            if (clickTimeout) clearTimeout(clickTimeout);
            
            clickTimeout = setTimeout(() => {
                try {
                    if (clickCount === 2) {
                        // Double click - cancel
                        logger.debug('Tray double-click detected');
                        ollamaService.cancel();
                        removeTransparentWindow();
                    } else {
                        // Single click - toggle config
                        logger.debug('Tray single-click detected');
                        hideShowConfig();
                    }
                } catch (error) {
                    logger.error('Error handling tray click', { error: error.message });
                } finally {
                    clickCount = 0;
                }
            }, TRAY_CONFIG.CLICK_TIMEOUT);
        });

        // Register shortcuts if Ollama is available
        if (ollamaIsOk) {
            try {
                shortcutService.setCallbacks(startInference, stopInference);
                await shortcutService.registerShortcuts();
                logger.info('Shortcuts registered successfully');
            } catch (error) {
                logger.error('Failed to register shortcuts', { error: error.message });
            }
        } else {
            logger.warn('Ollama not available, skipping shortcut registration');
        }

        logger.info('Application initialization completed');

    } catch (error) {
        logger.error('Error during app initialization', { error: error.message });
        errorService.handleCriticalError('App Initialization', error);
    }

    // Ensure the app continues running in the background
    app.on('activate', async () => {
        try {
            if (BrowserWindow.getAllWindows().length === 0) {
                const ollamaIsOk = await ollamaService.checkAvailability();
                configWindow = await createConfigWindow(ollamaIsOk);
            }
        } catch (error) {
            logger.error('Error on app activate', { error: error.message });
        }
    });
});

// Cleanup when the app is closed
app.on('will-quit', () => {
    try {
        logger.info('Application is quitting, cleaning up...');
        
        // Unregister all shortcuts
        shortcutService.unregisterAll();
        
        // Cancel any ongoing operations
        ollamaService.cancel();
        
        // Stop any inference process
        if (isInferenceActive) {
            stopInference(false); // Don't try to manipulate overlay on exit
        }
        
        logger.info('Cleanup completed');
    } catch (error) {
        console.error('Error during cleanup:', error.message);
    }
});
