import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const powerShellCopy = path.join(__dirname, '../bin/copy.ps1');
const powerShellSendText = path.join(__dirname, '../bin/sendText.ps1');


let hWnd;


function escapeForPowershell(input) {
    // Escapa comillas dobles con comillas dobles dobles
    let escapedString = input.replace(/"/g, '""');

    // Escapa comillas simples con comillas simples dobles
    escapedString = escapedString.replace(/'/g, "''");

    // Si hay espacios o caracteres especiales, envuélvelo en comillas dobles
    if (/\s|[^a-zA-Z0-9]/.test(escapedString)) {
        escapedString = `"${escapedString}"`;
    }

    return escapedString;
}

function escapeForSendKeys(input) {
    let escapedString = input;

    escapedString = escapedString.replace(/\r\n|\n|\r/g, '{ENTER}');
    escapedString = escapedString.replace(/\t/g, '{TAB}');
    const specialChars = /[~!@#$%^&*()_+|:<>?[\]\\;,./`\-=\s]/g;
    escapedString = escapedString.replace(specialChars, match => {
        // Si el carácter es un espacio, déjalo como está
        if (match === ' ') return ' ';
        // De lo contrario, envuélvelo en llaves
        return `{${match}}`;
    });
    // Escapa los caracteres especiales de SendKeys con {}

    // Escapa comillas dobles con comillas dobles dobles
    escapedString = escapedString.replace(/"/g, '""');

    // Escapa comillas simples con comillas simples dobles
    // escapedString = escapedString.replace(/'/g, "''");

    return escapedString;

}

// Implementación para Windows
export function sendCopyWindows() {
    return new Promise((resolve, reject) => {
        exec(`powershell.exe -ExecutionPolicy Bypass -File ${powerShellCopy}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error al ejecutar el script ${powerShellCopy}:\n${error}`);
                reject(error);
                return;
            }
            hWnd = stdout.toString().trim();
            resolve();
        });
    });
}
export function sendTextWindows(text) {
    console.log('sendings:', text);
    let escapeText = escapeForSendKeys(text).toString('binary');
    
    return new Promise((resolve, reject) => {
        if (!escapeText.length|| !text.length) resolve();
        exec(`powershell.exe -ExecutionPolicy Bypass -File ${powerShellSendText} -hWnd ${hWnd} -text "${escapeText}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error al ejecutar el script ${powerShellSendText}:\n${error}`);
                reject(error);
                return;
            }
            resolve();
        });
    });
}