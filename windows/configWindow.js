import { Menu, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from '../services/logger.js';
import configService from '../services/configService.js';
import ollamaService from '../services/ollamaService.js';
import { WINDOW_CONFIG } from '../constants/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear ventana de configuración
export async function createConfigWindow(ollamaIsOk) {
    let configWindow;
    try {
        logger.debug('Creating config window', { ollamaAvailable: ollamaIsOk });
        
        configWindow = await new Promise((resolve, reject) => {
            const windowOptions = {
                width: WINDOW_CONFIG.CONFIG.WIDTH,
                height: WINDOW_CONFIG.CONFIG.HEIGHT,
                minWidth: WINDOW_CONFIG.CONFIG.MIN_WIDTH,
                minHeight: WINDOW_CONFIG.CONFIG.MIN_HEIGHT,
                show: false,
                autoHideMenuBar: true,
                menu: null,
                icon: path.join(__dirname, '../images/icon-transparent.png'),
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
            };

            const win = new BrowserWindow(windowOptions);

            if (process.platform === "win32") {
                win.removeMenu();
            } else if (process.platform === "darwin") {
                Menu.setApplicationMenu(Menu.buildFromTemplate([]));
            }

            win.loadFile('config.html');

            win.once('ready-to-show', () => {
                win.show();
                resolve(win);
            });

            win.webContents.on('did-finish-load', async () => {
                try {
                    // Enviar configuración actual
                    const config = configService.getConfig();
                    win.webContents.send('load-config', config);
                    
                    // Enviar estado de Ollama
                    win.webContents.send('load-ollama-ok', ollamaIsOk);
                    
                    // Enviar shortcuts
                    const shortcuts = configService.getShortcuts();
                    win.webContents.send('load-shortcuts', shortcuts);

                    // Enviar modelos disponibles si Ollama está OK
                    if (ollamaIsOk) {
                        try {
                            const models = await ollamaService.listModels();
                            win.webContents.send('load-models', models);
                        } catch (error) {
                            logger.error('Failed to load models for config window', { error: error.message });
                            win.webContents.send('load-models', { models: [] });
                        }
                    }
                    
                    logger.debug('Config window data loaded successfully');
                    
                } catch (error) {
                    logger.error('Error loading config window data', { error: error.message });
                }
            });

            win.on('close', (event) => {
                event.preventDefault(); // Evita que la ventana se cierre por completo
                win.hide(); // Oculta la ventana en lugar de destruirla
            });
        });
    } catch (error) {
        console.error(error);
    }
    return configWindow;
}


