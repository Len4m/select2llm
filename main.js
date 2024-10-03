import { app, globalShortcut, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

import { registerShortcuts, loadShortcuts, saveShortcuts } from './controllers/shortcutsController.js';
import { listOllama, cancelOllama } from './controllers/ollamaController.js';


// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

Menu.setApplicationMenu(null);

let tray = null;
let configWindow = null;
let iconIndex = 0;
let animationInterval;

global.inferencia = false;

// Crear ventana de configuración
function createConfigWindow() {
    if (configWindow) {
        configWindow.show();
        return;
    }
    configWindow = new BrowserWindow({
        width: 500,
        height: 350,
        minWidth: 500,
        minHeight: 350,
        show: true,
        autoHideMenuBar: true,
        menu: null,
        icon: path.join(__dirname, 'images/icon-transparent.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    process.platform === "win32" && configWindow.removeMenu();
    process.platform === "darwin" && Menu.setApplicationMenu(Menu.buildFromTemplate([]));

    configWindow.loadFile('config.html');

    // Mostrar la ventana solo cuando esté lista
    configWindow.once('ready-to-show', () => {
        configWindow.show();
    });

    // Comunicar con la ventana de configuración para cargar los atajos
    configWindow.webContents.on('did-finish-load', async () => {
        configWindow.webContents.send('load-shortcuts', loadShortcuts());
        configWindow.webContents.send('load-models', await listOllama());

    });
    // Evitar que la ventana se destruya al cerrarse
    configWindow.on('close', (event) => {
        event.preventDefault(); // Evita que la ventana se cierre por completo
        configWindow.hide(); // Oculta la ventana en lugar de destruirla
    });
}

// Función para obtener el camino del icono actual
function getIconPath(index) {
    const indexString = index < 10 ? `0${index}` : `${index}`;
    return path.join(__dirname, `images/animation/frame_${indexString}_delay-0.06s.png`);
}

// TODO: Horrible
// Función para iniciar la animación del tray
function startAnimation() {
    animationInterval = setInterval(() => {
        iconIndex = global.inferencia ? ((iconIndex + 1) % 20) : 0;
        tray.setImage(getIconPath(iconIndex));
    }, 350); // Cambia 100 por la velocidad de la animación en milisegundos
}

// Comunicación desde la ventana de configuración para guardar los atajos
ipcMain.on('save-shortcuts', (event, shortcuts) => {
    saveShortcuts(shortcuts);
    registerShortcuts(); // Registrar los atajos recién guardados
});

// Author link
ipcMain.on('external-link', (event, url) => {
    shell.openExternal(url);
});

let clickTimeout;
app.whenReady().then(() => {
    // Crear un icono de estado (tray)
    tray = new Tray(getIconPath(0));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Configuración (click)',
            click: createConfigWindow
        },
        {
            label: 'Cancelar (doble click)',
            click: async () => {
                cancelOllama();
            },
            enabled: true // TODO
        },
        {
            click: () => {
                if (process.platform !== 'darwin') app.quit();
                process.exit(0);
            },
            label: 'Salir'
        },
    ]);
    tray.setToolTip('Select2LLM');
    tray.setContextMenu(contextMenu);


    createConfigWindow();
    configWindow.hide();

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
            // Restaurar/mostrar la ventana principal si está oculta/minimizada
            if (configWindow.isVisible()) {
                configWindow.hide();
            } else {
                configWindow.show();
                configWindow.focus();
            }
            clickCount = 0; // Reiniciar el contador
        }, 200);
    });

    // Registrar atajos desde el archivo JSON
    registerShortcuts();
    // TODO: Status controller kk.
    startAnimation();

    // Para asegurar que la aplicación siga funcionando en segundo plano
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createConfigWindow();
    });
});

app.on('will-quit', () => {
    // Desregistrar todos los atajos cuando se cierra la app
    globalShortcut.unregisterAll();
});

