import { Menu, BrowserWindow } from 'electron';
import { listOllama } from '../controllers/ollamaController.js';
import { loadShortcuts } from '../controllers/shortcutsController.js';
import { fileURLToPath } from 'url';
import path from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear ventana de configuración
export async function createConfigWindow() {
    let configWindow;
    try {
        configWindow = await new Promise((resolve, reject) => {
            const windowOptions = {
                width: 500,
                height: 350,
                minWidth: 500,
                minHeight: 350,
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


