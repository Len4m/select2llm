import { Menu, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear ventana de overlay
export async function createOverlayWindow(obj) {
    let overlayWindow;
    try {
        overlayWindow = await new Promise((resolve, reject) => {
            const windowOptions = {
                x: obj.x,
                y: obj.y,
                show: false,
                width: obj.width,
                height: obj.height,
                transparent: true,
                frame: false,
                alwaysOnTop: true,
                resizable: false,
                movable: false,
                focusable: true,
                skipTaskbar: true,
                fullscreenable: false,
                minimizable: false,
                maximizable: false,
                hasShadow: false,
                backgroundColor: '#00000000',
                modal: true, // Hace que la ventana sea modal
                parent: BrowserWindow.getFocusedWindow(), // Establece la ventana padre
                menu: null,
                icon: path.join(__dirname, '../images/icon-transparent.png'),
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
            }

            const win = new BrowserWindow(windowOptions);

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
                resolve(win);
            });
        });
    } catch (error) {
        console.error(error);
    }
    return overlayWindow;

}