import { exec } from 'child_process';
import clipboard from 'clipboardy';
import { sendCopyLinux, sendTextLinux } from './keyboardLinuxController.js';
import { sendCopyWindows, sendTextWindows } from './keyboardWindowsController.js';


// Función para obtener el texto seleccionado
export function getSelectedText() {
    return new Promise((resolve) => {
        // Simula un Ctrl+C (o Cmd+C en Mac)
        sendCopyCommand().then(() => {
            // Espera un poco para que el sistema copie el texto al portapapeles
            setTimeout(() => {
                // Lee el contenido del portapapeles
                clipboard.read()
                    .then((clipboardContent) => {
                        // Devuelve el texto seleccionado o un string vacío si no hay texto
                        resolve(clipboardContent.trim() ? clipboardContent : '');
                    })
                    .catch(() => {
                        // Si hay un error al leer el portapapeles, devuelve un string vacío
                        resolve('');
                    });
            }, 500); // Ajusta el tiempo si es necesario
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
        sendCopyLinux();
    } else {
        console.error('Sistema operativo no soportado');
    }
}


// Función para enviar texto como si fuera escrito
export async function sendText(text) {
    const platform = process.platform;
    if (platform === 'win32') {
        sendTextWindows(text);
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

