/**
 * Helper para la gestión de iconos dependientes del tema del sistema
 */

import { nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Almacenar las ventanas registradas para actualizar cuando cambie el tema
const registeredWindows = new Set();

// Almacenar el tray registrado para actualizaciones automáticas
let registeredTray = null;
let trayUpdateCallback = null;

/**
 * Detecta si el sistema está en modo oscuro
 * @returns {boolean} true si está en modo oscuro
 */
export function isDarkTheme() {
    return nativeTheme.shouldUseDarkColors;
}

/**
 * Obtiene la carpeta de tema según el sistema
 * @returns {string} 'dark' o 'light'
 */
export function getThemeFolder() {
    return isDarkTheme() ? 'dark' : 'light';
}

/**
 * Obtiene la ruta del icono de la aplicación según el tema del sistema
 * @returns {string} Ruta al icono apropiado
 */
export function getAppIcon() {
    const iconName = isDarkTheme() ? 'icon-transparent-dark.png' : 'icon-transparent.png';
    return path.join(__dirname, '../images', iconName);
}

/**
 * Obtiene la ruta del icono de animación del tray según el tema y frame
 * @param {number} frameIndex - Índice del frame (0, 1, 2)
 * @returns {string} Ruta al icono de animación apropiado
 */
export function getTrayAnimationIcon(frameIndex) {
    const themeFolder = getThemeFolder();
    const clampedIndex = Math.min(frameIndex, 2); // Solo frames 0, 1, 2
    const indexString = `${clampedIndex}`;
    return path.join(__dirname, '../images/animation', themeFolder, `frame_${indexString}.png`);
}

/**
 * Actualiza el icono de una ventana según el tema actual
 * @param {BrowserWindow} window - La ventana a actualizar
 */
export function updateWindowIcon(window) {
    if (window && !window.isDestroyed()) {
        try {
            window.setIcon(getAppIcon());
        } catch (error) {
            console.error('Error updating window icon:', error);
        }
    }
}

/**
 * Registra una ventana para recibir actualizaciones automáticas de icono
 * @param {BrowserWindow} window - La ventana a registrar
 */
export function registerWindowForThemeUpdates(window) {
    if (window && !window.isDestroyed()) {
        registeredWindows.add(window);
        
        // Limpiar cuando la ventana se cierre
        window.on('closed', () => {
            registeredWindows.delete(window);
        });
    }
}

/**
 * Registra el tray para recibir actualizaciones automáticas de icono
 * @param {Tray} tray - El tray a registrar
 * @param {Function} updateCallback - Función para actualizar el icono del tray
 */
export function registerTrayForThemeUpdates(tray, updateCallback) {
    registeredTray = tray;
    trayUpdateCallback = updateCallback;
}

/**
 * Actualiza todos los iconos de las ventanas registradas
 */
function updateAllWindowIcons() {
    registeredWindows.forEach(window => {
        if (!window.isDestroyed()) {
            updateWindowIcon(window);
        } else {
            registeredWindows.delete(window);
        }
    });
}

/**
 * Actualiza el icono del tray si está registrado
 */
function updateTrayIcon() {
    if (registeredTray && trayUpdateCallback) {
        try {
            trayUpdateCallback();
        } catch (error) {
            console.error('Error updating tray icon:', error);
        }
    }
}

// Escuchar cambios de tema del sistema
nativeTheme.on('updated', () => {
    updateAllWindowIcons();
    updateTrayIcon();
});
