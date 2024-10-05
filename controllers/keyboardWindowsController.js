import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const powerShellCopy = path.join(__dirname,'../bin/copy.ps1');


let hWnd;

// Implementación para Windows
export function sendCopyWindows() {
    return new Promise((resolve, reject) => {
        exec(`powershell.exe -ExecutionPolicy Bypass -File ${powerShellCopy}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error al ejecutar el script copy.ps1: ${error}`);
                reject(error);
                return;
            }
            hWnd = stdout.toString().trim();
            resolve();
        });
    });
}
export function sendTextWindows(text) {
    // TODO crear powershell para escribir en ventana hWnd.
    /*
    const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.SendKeys]::SendWait("${text}");
    `;
    exec(`powershell -Command "${script}"`);
    */
}