import { exec, execSync } from 'child_process';
import logger from '../services/logger.js';

/**
 * Controller específico para macOS
 * Maneja operaciones de sistema específicas de macOS usando AppleScript y herramientas nativas
 */

let currentApp = null; // Aplicación actualmente enfocada

/**
 * Escapa caracteres especiales para AppleScript
 * @param {string} text - Texto a escapar
 * @returns {string} - Texto escapado para AppleScript
 */
function escapeForAppleScript(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

/**
 * Ejecuta un script de AppleScript
 * @param {string} script - Script de AppleScript a ejecutar
 * @param {string} description - Descripción de la operación para logging
 * @returns {Promise<string>} - Resultado del script
 */
function executeAppleScript(script, description = 'AppleScript execution') {
    return new Promise((resolve, reject) => {
        const command = `osascript -e '${script}'`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${description} failed: ${error.message}\n${stderr}`));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

/**
 * Obtiene información de la aplicación actualmente enfocada
 * @returns {Promise<Object>} - Información de la aplicación (nombre, bundle id, etc.)
 */
export async function getFrontmostApplication() {
    const script = `
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set appName to name of frontApp
            set bundleId to bundle identifier of frontApp
            return appName & "|" & bundleId
        end tell
    `;
    
    try {
        const result = await executeAppleScript(script, 'Get frontmost application');
        const [name, bundleId] = result.split('|');
        currentApp = { name, bundleId };
        return currentApp;
    } catch (error) {
        throw new Error(`Failed to get frontmost application: ${error.message}`);
    }
}

/**
 * Envía comando de copia (Cmd+C) en macOS
 * @returns {Promise<void>}
 */
export async function sendCopyMac() {
    logger.debug('Sending copy command on macOS');
    
    // Primero obtenemos la aplicación enfocada para el contexto
    await getFrontmostApplication();
    
    const script = `
        tell application "System Events"
            keystroke "c" using {command down}
        end tell
    `;
    
    try {
        await executeAppleScript(script, 'macOS copy command');
        logger.debug('Cmd+C sent to app', { appName: currentApp?.name || 'unknown app' });
    } catch (error) {
        throw new Error(`Failed to send copy command: ${error.message}`);
    }
}

/**
 * Envía texto como si fuera escrito en macOS
 * @param {string} text - Texto a enviar
 * @returns {Promise<void>}
 */
export async function sendTextMac(text) {
    if (!text || text.length === 0) {
        return;
    }

    logger.debug('Sending text to macOS', { textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : ''), textLength: text.length });
    
    // Escapar el texto para AppleScript
    const escapedText = escapeForAppleScript(text);
    
    // Dividir texto en líneas para manejar saltos de línea correctamente
    const lines = text.split('\n');
    
    try {
        await sendTextMacRecursive(lines);
    } catch (error) {
        throw new Error(`Failed to send text: ${error.message}`);
    }
}

/**
 * Envía líneas de texto recursivamente en macOS
 * @param {Array<string>} lines - Array de líneas a enviar
 * @returns {Promise<void>}
 */
async function sendTextMacRecursive(lines) {
    if (lines.length === 0) {
        return;
    }

    const line = lines.shift();
    const hasMoreLines = lines.length > 0;
    
    // Enviar la línea actual si no está vacía
    if (line.length > 0) {
        const escapedLine = escapeForAppleScript(line);
        const script = `
            tell application "System Events"
                keystroke "${escapedLine}"
            end tell
        `;
        
        await executeAppleScript(script, 'Send text line');
    }
    
    // Enviar Enter si hay más líneas
    if (hasMoreLines) {
        const enterScript = `
            tell application "System Events"
                key code 36
            end tell
        `;
        
        await executeAppleScript(enterScript, 'Send Enter key');
    }
    
    // Procesar las líneas restantes recursivamente
    if (lines.length > 0) {
        await sendTextMacRecursive(lines);
    }
}

/**
 * Obtiene información de la ventana actualmente enfocada
 * @returns {Promise<Object>} - Información de la ventana (posición, tamaño, etc.)
 */
export async function getMacWindowInfo() {
    const script = `
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWindow to window 1 of frontApp
            
            set windowPosition to position of frontWindow
            set windowSize to size of frontWindow
            set windowTitle to title of frontWindow
            
            set x to item 1 of windowPosition
            set y to item 2 of windowPosition
            set width to item 1 of windowSize
            set height to item 2 of windowSize
            
            return x & "|" & y & "|" & width & "|" & height & "|" & windowTitle
        end tell
    `;
    
    try {
        const result = await executeAppleScript(script, 'Get window info');
        const [x, y, width, height, title] = result.split('|');
        
        return {
            x: parseInt(x),
            y: parseInt(y),
            width: parseInt(width),
            height: parseInt(height),
            title: title || 'Unknown'
        };
    } catch (error) {
        throw new Error(`Failed to get window info: ${error.message}`);
    }
}

/**
 * Obtiene la geometría de la ventana actualmente enfocada (compatible con otros controllers)
 * @returns {Promise<Object>} - Geometría de la ventana {x, y, width, height}
 */
export async function getMacWindowGeometry() {
    try {
        const windowInfo = await getMacWindowInfo();
        return {
            x: windowInfo.x,
            y: windowInfo.y,
            width: windowInfo.width,
            height: windowInfo.height
        };
    } catch (error) {
        throw new Error(`Failed to get window geometry: ${error.message}`);
    }
}

/**
 * Activa una aplicación específica por nombre
 * @param {string} appName - Nombre de la aplicación
 * @returns {Promise<void>}
 */
export async function activateApplication(appName) {
    const script = `
        tell application "${appName}"
            activate
        end tell
    `;
    
    try {
        await executeAppleScript(script, `Activate application ${appName}`);
        logger.debug('Application activated', { appName });
    } catch (error) {
        throw new Error(`Failed to activate application ${appName}: ${error.message}`);
    }
}

/**
 * Obtiene la lista de aplicaciones en ejecución
 * @returns {Promise<Array>} - Lista de aplicaciones
 */
export async function getRunningApplications() {
    const script = `
        tell application "System Events"
            set appList to {}
            set processList to every application process whose visible is true
            repeat with proc in processList
                set appList to appList & {name of proc}
            end repeat
            return appList
        end tell
    `;
    
    try {
        const result = await executeAppleScript(script, 'Get running applications');
        return result.split(', ').map(app => app.trim());
    } catch (error) {
        throw new Error(`Failed to get running applications: ${error.message}`);
    }
}

/**
 * Envía combinaciones de teclas específicas
 * @param {Array<string>} keys - Array de teclas a presionar
 * @param {Array<string>} modifiers - Array de modificadores (command, option, control, shift)
 * @returns {Promise<void>}
 */
export async function sendKeyboardShortcut(keys = [], modifiers = []) {
    const keyString = keys.join('');
    const modifierString = modifiers.length > 0 ? `using {${modifiers.map(m => `${m} down`).join(', ')}}` : '';
    
    const script = `
        tell application "System Events"
            keystroke "${keyString}" ${modifierString}
        end tell
    `;
    
    try {
        await executeAppleScript(script, `Send keyboard shortcut: ${keyString} + ${modifiers.join('+')}`);
    } catch (error) {
        throw new Error(`Failed to send keyboard shortcut: ${error.message}`);
    }
}

/**
 * Obtiene el contenido del portapapeles
 * @returns {Promise<string>} - Contenido del portapapeles
 */
export async function getClipboardContent() {
    const script = `
        set clipboardContent to the clipboard as string
        return clipboardContent
    `;
    
    try {
        const result = await executeAppleScript(script, 'Get clipboard content');
        return result;
    } catch (error) {
        throw new Error(`Failed to get clipboard content: ${error.message}`);
    }
}

/**
 * Establece el contenido del portapapeles
 * @param {string} text - Texto a establecer en el portapapeles
 * @returns {Promise<void>}
 */
export async function setClipboardContent(text) {
    const escapedText = escapeForAppleScript(text);
    const script = `
        set the clipboard to "${escapedText}"
    `;
    
    try {
        await executeAppleScript(script, 'Set clipboard content');
    } catch (error) {
        throw new Error(`Failed to set clipboard content: ${error.message}`);
    }
}

/**
 * Muestra una notificación del sistema
 * @param {string} title - Título de la notificación
 * @param {string} message - Mensaje de la notificación
 * @param {string} subtitle - Subtítulo opcional
 * @returns {Promise<void>}
 */
export async function showNotification(title, message, subtitle = '') {
    const subtitlePart = subtitle ? `subtitle "${escapeForAppleScript(subtitle)}" ` : '';
    const script = `
        display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" ${subtitlePart}
    `;
    
    try {
        await executeAppleScript(script, 'Show notification');
    } catch (error) {
        throw new Error(`Failed to show notification: ${error.message}`);
    }
}

/**
 * Verifica si una aplicación específica está en ejecución
 * @param {string} appName - Nombre de la aplicación
 * @returns {Promise<boolean>} - true si la aplicación está en ejecución
 */
export async function isApplicationRunning(appName) {
    const script = `
        tell application "System Events"
            return exists (application process "${appName}")
        end tell
    `;
    
    try {
        const result = await executeAppleScript(script, `Check if ${appName} is running`);
        return result.toLowerCase() === 'true';
    } catch (error) {
        return false;
    }
}

/**
 * Obtiene información del sistema (versión de macOS, arquitectura, etc.)
 * @returns {Promise<Object>} - Información del sistema
 */
export async function getSystemInfo() {
    try {
        // Obtener versión de macOS
        const versionScript = `
            tell application "System Events"
                return system version of (system info)
            end tell
        `;
        
        // Obtener información del hardware usando command line
        const version = await executeAppleScript(versionScript, 'Get macOS version');
        const architecture = execSync('uname -m').toString().trim();
        const hostname = execSync('hostname').toString().trim();
        
        return {
            version,
            architecture,
            hostname,
            platform: 'darwin'
        };
    } catch (error) {
        throw new Error(`Failed to get system info: ${error.message}`);
    }
}
