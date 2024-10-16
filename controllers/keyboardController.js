import { exec } from 'child_process';
import clipboard from 'clipboardy';
import { sendCopyLinux, sendTextLinux, getLinuxWindowGeometry } from './linuxController.js';
import { sendCopyWindows, sendTextWindows } from './windowsController.js';

// Función para obtener el texto seleccionado
export async function getSelectedText() {
    return new Promise((resolve, reject) => {
        // Lee el contenido del portapapeles
        clipboard.read()
            .then((clipboardContent) => {
                console.log('clipboardContent', clipboardContent);
                resolve(clipboardContent.trim() ? clipboardContent : '');
            })
            .catch((e) => {
                console.error(e);
                // Si hay un error al leer el portapapeles, devuelve un string vacío
                reject(e);
            });

    });
}

export async function sendCopyCommand() {
    const platform = process.platform;
    if (platform === 'win32') {
        await sendCopyWindows();
    } else if (platform === 'darwin') {
        sendCopyMac();
    } else if (platform === 'linux') {
        await sendCopyLinux();
    } else {
        console.error('Sistema operativo no soportado');
    }
}

export async function getWindowGeometry() {
    const platform = process.platform;
    let geom = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
    }
    if (platform === 'win32' || platform === 'darwin') {
        return geom;
    } else if (platform === 'linux') {
        return await getLinuxWindowGeometry();
    } else {
        console.error('Sistema operativo no soportado');
    }
}


// Función para enviar texto como si fuera escrito
export async function sendText(text) {
    const platform = process.platform;
    if (platform === 'win32') {
        try {
            await sendTextWindows(text);
        } catch (error) {
            console.error("sendTextWindows Error:", error);
        }
    } else if (platform === 'darwin') {
        sendTextMac(text);
    } else if (platform === 'linux') {
        try {
            await sendTextLinux(text);
        } catch (error) {
            console.error("sendTextLinux Error:", error);
        }
    } else {
        console.error('Sistema operativo no soportado');
    }
}

// Implementación para macOS
function sendCopyMac() {
    const script = `
        tell application "System Events"
            keystroke "c" using {command down}
        end tell
    `;
    exec(`osascript -e '${script}'`);
}

function sendTextMac(text) {
    const script = `
        tell application "System Events"
            keystroke "${text}"
        end tell
    `;
    exec(`osascript -e '${script}'`);
}

