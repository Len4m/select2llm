import { Menu, BrowserWindow } from 'electron';
import { listOllama } from '../controllers/ollamaController.js';
import { loadShortcuts } from '../controllers/shortcutsController.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { globals } from '../globals.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear ventana de configuración
export async function createConfigWindow() {
    let configWindow;
    try {
        configWindow = await new Promise((resolve, reject) => {
            const windowOptions = {
                width: 660,
                height: 475,
                minWidth: 660,
                minHeight: 475,
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
                win.webContents.send('load-config', {
                    language: globals.language,
                    temperature: globals.temperature,
                    'keep-alive': globals['keep-alive'],
                    host: globals.host === '' ? 'http://127.0.0.1:11434' : globals.host
                });
                win.webContents.send('load-shortcuts', loadShortcuts());
                win.webContents.send('load-models', await listOllama());
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


