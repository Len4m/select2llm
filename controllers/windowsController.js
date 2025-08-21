import { exec, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../services/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const powerShellCopy = path.join(__dirname, '../bin/copy.ps1');
const powerShellSendText = path.join(__dirname, '../bin/sendText.ps1');
const powerShellWinGeo = path.join(__dirname, '../bin/windowGeometry.ps1');

let hWnd;

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
                logger.error('Error executing PowerShell copy script', { script: powerShellCopy, error: error.message });
                reject(error);
                return;
            }
            hWnd = stdout.toString().trim();
            resolve();
        });
    });
}

export function sendTextWindows(text) {
    let escapeText = escapeForSendKeys(text).toString('binary');
    return new Promise((resolve, reject) => {
        if (!escapeText.length|| !text.length) resolve();
        exec(`powershell.exe -ExecutionPolicy Bypass -File ${powerShellSendText} -hWnd ${hWnd} -Texto "${escapeText}"`, (error, stdout, stderr) => {
            if (error) {
                logger.error('Error executing PowerShell sendText script', { script: powerShellSendText, error: error.message });
                reject(error);
                return;
            }
            resolve();
        });
    });
}

export async function getWindowsWindowGeometry() {
    const cmd = `powershell.exe -ExecutionPolicy Bypass -File ${powerShellWinGeo} -hwnd ${hWnd}`;
    logger.debug('Executing PowerShell command for window geometry', { command: cmd });
    const geom = JSON.parse(execSync(cmd).toString());
    return geom;
}
