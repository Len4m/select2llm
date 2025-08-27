import { Menu, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from '../services/logger.js';
import { WINDOW_CONFIG } from '../constants/index.js';
import { getAppIcon, registerWindowForThemeUpdates } from '../utils/iconHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear ventana de overlay
export async function createOverlayWindow(obj) {
    let overlayWindow;
    try {
        logger.debug('Creating overlay window', obj);
        
        overlayWindow = await new Promise((resolve, reject) => {
            const windowOptions = {
                x: obj.x,
                y: obj.y,
                show: false,
                width: obj.width,
                height: obj.height,
                transparent: WINDOW_CONFIG.OVERLAY.TRANSPARENT,
                frame: WINDOW_CONFIG.OVERLAY.FRAME,
                alwaysOnTop: WINDOW_CONFIG.OVERLAY.ALWAYS_ON_TOP,
                resizable: WINDOW_CONFIG.OVERLAY.RESIZABLE,
                movable: WINDOW_CONFIG.OVERLAY.MOVABLE,
                focusable: WINDOW_CONFIG.OVERLAY.FOCUSABLE,
                skipTaskbar: WINDOW_CONFIG.OVERLAY.SKIP_TASKBAR,
                fullscreenable: WINDOW_CONFIG.OVERLAY.FULLSCREENABLE,
                minimizable: WINDOW_CONFIG.OVERLAY.MINIMIZABLE,
                maximizable: WINDOW_CONFIG.OVERLAY.MAXIMIZABLE,
                hasShadow: WINDOW_CONFIG.OVERLAY.HAS_SHADOW,
                backgroundColor: WINDOW_CONFIG.OVERLAY.BACKGROUND_COLOR,
                modal: true,
                parent: BrowserWindow.getFocusedWindow(),
                menu: null,
                icon: getAppIcon(),
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
            }

            const win = new BrowserWindow(windowOptions);

            // Registrar la ventana para actualizaciones automáticas de tema
            registerWindowForThemeUpdates(win);

            if (process.platform === "win32") {
                win.removeMenu();
            } else if (process.platform === "darwin") {
                Menu.setApplicationMenu(Menu.buildFromTemplate([]));
            }
            // Asegurar ciertas propiedades de la ventana
            win.setAlwaysOnTop(true, 'screen-saver');
            win.setVisibleOnAllWorkspaces(true);
            win.setFullScreenable(false);

            // Cargar un archivo HTML con contenido personalizado
            win.loadFile('overlay.html');

            // Forzar el foco en la ventana transparente
            win.focus();

            // Eliminar el menú contextual
            win.setMenu(null);

            // Mantener el foco en la ventana transparente
            win.on('blur', () => {
                win.focus();
            });
            win.once('ready-to-show', () => {
                win.show();
                logger.debug('Overlay window ready and shown');
                resolve(win);
            });
            
            win.on('closed', () => {
                logger.debug('Overlay window closed');
            });
        });
    } catch (error) {
        logger.error('Error creating overlay window', { error: error.message, stack: error.stack });
    }
    return overlayWindow;

}