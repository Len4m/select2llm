import { app, globalShortcut, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConfigWindow } from './windows/configWindow.js';
import { createOverlayWindow } from './windows/overlayWindow.js';
import { registerShortcuts, saveShortcuts } from './controllers/shortcutsController.js';
import { cancelOllama } from './controllers/ollamaController.js';
import { getWindowGeometry } from './controllers/keyboardController.js'
import { globals } from './globals.js';

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

Menu.setApplicationMenu(null);

let configWindow = null,
    transparentWindow = null,
    tray = null,
    iconIndex = 0,
    animationInterval,
    clickTimeout;



function hideShowConfig() {
    // Restaurar/mostrar la ventana principal si está oculta/minimizada
    if (configWindow.isVisible()) {
        configWindow.hide();
    } else {
        configWindow.show();
        configWindow.focus();
    }
}

async function crearVentanaTransparente(obj) {
    // Crear una nueva ventana transparente
    transparentWindow = await createOverlayWindow(obj);
}

function quitarVentanaTransparente() {
    if (transparentWindow) {
        transparentWindow.close();
        transparentWindow = null;
    }
}


// Función para obtener el camino del icono actual
function getIconPath(index) {
    const indexString = index < 10 ? `0${index}` : `${index}`;
    return path.join(__dirname, `images/animation/frame_${indexString}_delay-0.06s.png`);
}

async function startInferencia() {
    if (animationInterval)
        clearInterval(animationInterval);
    animationInterval = setInterval(() => {
        iconIndex = ((iconIndex + 1) % 20);
        tray.setImage(getIconPath(iconIndex));
    }, 150);
    // Create hiden window, 

    let geo = await getWindowGeometry();
    console.log(geo);
    crearVentanaTransparente(geo);

    globals.inferencia = true;
}

async function stopInferencia() {
    if (animationInterval)
        clearInterval(animationInterval);
    tray.setImage(getIconPath(0));
    quitarVentanaTransparente();
    globals.inferencia = false;
}

// Comunicación desde la ventana de configuración para guardar los atajos
ipcMain.on('save-shortcuts', (event, shortcuts) => {
    saveShortcuts(shortcuts);
    registerShortcuts(startInferencia, stopInferencia);
});

// Author link
ipcMain.on('external-link', (event, url) => {
    shell.openExternal(url);
});

// Manejar el evento de cancelación desde el frontend
ipcMain.on('cancelar-proceso', () => {
    cancelOllama();
    quitarVentanaTransparente();
});

app.whenReady().then(async () => {
    // Crear un icono de estado (tray)
    tray = new Tray(getIconPath(0));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Configuración (click)',
            click: async () => {
                hideShowConfig();
            }
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


    configWindow = await createConfigWindow();
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
            hideShowConfig();
            clickCount = 0; // Reiniciar el contador
        }, 300);
    });

    // Registrar atajos desde el archivo JSON
    registerShortcuts(startInferencia, stopInferencia);

    // Para asegurar que la aplicación siga funcionando en segundo plano
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) configWindow = await createConfigWindow();
    });
});

app.on('will-quit', () => {
    // Desregistrar todos los atajos cuando se cierra la app
    globalShortcut.unregisterAll();
});

