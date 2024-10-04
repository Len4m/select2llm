import { exec } from 'child_process';
import clipboard from 'clipboardy';

// Función para obtener el texto seleccionado
export function getSelectedText() {
    return new Promise((resolve) => {
        // Simula un Ctrl+C (o Cmd+C en Mac)
        sendCopyCommand();
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
}

export function sendCopyCommand() {
    const platform = process.platform;
    if (platform === 'win32') {
        sendCopyWindows();
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

// Implementación para Windows
function sendCopyWindows() {
    const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.SendKeys]::SendWait("^{c}");
    `;
    exec(`powershell -Command "${script}"`);
}

function sendTextWindows(text) {
    const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.SendKeys]::SendWait("${text}");
    `;
    exec(`powershell -Command "${script}"`);
}

// ************* Implementación para Linux
// Requiere de xdotool y xclip.

let wid;

// Función para escapar caracteres especiales para bash y xdotool
function escapeForBash(a) {
    var ret = [];
    a.forEach(function (s) {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
                .replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
        }
        ret.push(s);
    });

    return ret.join(' ');
}


function sendTextLinux(text) {
    return new Promise((resolve, reject) => {
        const lines = text.split('\n');
        
        function typeLines(lines) {
            if (lines.length === 0) {
                resolve(); // Resolución cuando todas las líneas han sido procesadas
                return;
            }
            const line = lines.shift();
            let cmd;

            if (line.length > 0) {
                cmd = escapeForBash(['xdotool', 'type', '--clearmodifiers', '--window', wid, '--', line]);
            }

            if (lines.length > 0) {
                if (line.length > 0)
                    cmd += ` && xdotool key --clearmodifiers --window '${wid}' Return`;
                else
                    cmd = `xdotool key --clearmodifiers --window '${wid}' Return`;
            }

            if (cmd) {
                exec(cmd, (error, stdout, stderr) => {
                    if (error) {
                        reject(`Error escribiendo línea con xdotool: ${error}\n\n${stderr}`);
                        return;
                    }
                    // Llamar recursivamente para procesar la siguiente línea
                    typeLines(lines);
                });
            } else {
                typeLines(lines);
            }
        }

        typeLines(lines);
    });
}




function sendCopyLinux() {
    exec(`xclip -out -selection primary | xclip -in -selection clipboard`);
    exec('xdotool getwindowfocus', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error al seleccionar ventana: ${error}\n\n${stderr}`);
            wid = '';
            return;
        }
        wid = String(stdout).trim();
    });
}

