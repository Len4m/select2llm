import { exec, execSync } from 'child_process';
import logger from '../services/logger.js';

/**
 * Detects the display server in Linux.
 * @returns {string|null} 'wayland', 'x11', or null if unknown.
 */
export function detectLinuxDisplayServer() {
    const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
    if (sessionType === 'wayland' || process.env.WAYLAND_DISPLAY) {
        return 'wayland';
    }
    if (sessionType === 'x11' || process.env.DISPLAY) {
        return 'x11';
    }
    return null;
}

/**
 * Detects the system language and ensures UTF-8 encoding.
 * @returns {object} Object with LANG and LC_ALL values for UTF-8
 */
export function detectSystemLanguageUTF8() {
    try {
        // Intentar obtener el idioma del sistema de diferentes fuentes
        let systemLang = process.env.LANG || 
                        process.env.LC_ALL || 
                        process.env.LC_CTYPE ||
                        'en_US.UTF-8'; // fallback por defecto

        logger.debug('Detected system language', { originalLang: systemLang });

        // Si ya tiene UTF-8, usarlo tal como está
        if (systemLang.includes('UTF-8') || systemLang.includes('utf8')) {
            return {
                LANG: systemLang,
                LC_ALL: systemLang
            };
        }

        // Si no tiene UTF-8, intentar agregarlo
        // Extraer la parte del idioma (ej: es_ES de es_ES.ISO-8859-1)
        const langPart = systemLang.split('.')[0];
        const utf8Lang = `${langPart}.UTF-8`;

        logger.debug('Converted to UTF-8', { 
            original: systemLang, 
            converted: utf8Lang 
        });

        return {
            LANG: utf8Lang,
            LC_ALL: utf8Lang
        };

    } catch (error) {
        logger.warn('Failed to detect system language, using default', { error: error.message });
        // Fallback seguro
        return {
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8'
        };
    }
}

const sessionType = detectLinuxDisplayServer();
const systemLanguage = detectSystemLanguageUTF8();
let activeWid = null;

/**
 * Sends text to the active window.
 * This is a simplified version for abstraction.
 * @param {string} text - The text to send.
 */
export function sendTextLinux(text) {
    return new Promise(async (resolve, reject) => {
        if (sessionType === 'x11') {
            logger.debug('Sending text via X11');
            
            try {
                // Dividir el texto por saltos de línea
                const textParts = text.split('\n');
                
                for (let i = 0; i < textParts.length; i++) {
                    const part = textParts[i];
                    
                    // Enviar la parte del texto si no está vacía
                    if (part.length > 0) {
                        const command = activeWid
                            ? `xdotool type --window ${activeWid} --clearmodifiers --delay 1 --file -`
                            : 'xdotool type --clearmodifiers --delay 1 --file -';
                        
                        await new Promise((partResolve, partReject) => {
                            const child = exec(command, { 
                                encoding: 'utf8',
                                env: { ...process.env, ...systemLanguage }
                            }, (error) => {
                                if (error) {
                                    return partReject(error);
                                }
                                partResolve();
                            });
                            
                            // Asegurar que el texto se envía como UTF-8
                            child.stdin.setDefaultEncoding('utf8');
                            child.stdin.write(part, 'utf8');
                            child.stdin.end();
                        });
                    }
                    
                    // Enviar enter solo si no es la última parte (había un \n en el texto original)
                    if (i < textParts.length - 1) {
                        const enterCommand = activeWid
                            ? `xdotool key --window ${activeWid} --clearmodifiers Return`
                            : 'xdotool key --clearmodifiers Return';
                        
                        await new Promise((enterResolve, enterReject) => {
                            exec(enterCommand, (error) => {
                                if (error) {
                                    return enterReject(error);
                                }
                                enterResolve();
                            });
                        });
                    }
                }
                
                resolve();
                
            } catch (error) {
                logger.error('Error sending text with xdotool', { error });
                reject(error);
            }
            
        } else if (sessionType === 'wayland') {
            // Para Wayland usando wtype con stdin para evitar problemas de escape
            logger.debug('Sending text via Wayland');
            const child = exec('wtype -', { 
                encoding: 'utf8',
                env: { ...process.env, ...systemLanguage }
            }, (error) => {
                if (error) {
                    logger.error('Error sending text with wtype', { error });
                    return reject(error);
                }
                resolve();
            });
            
            // Asegurar que el texto se envía como UTF-8
            child.stdin.setDefaultEncoding('utf8');
            child.stdin.write(text, 'utf8');
            child.stdin.end();
            
        } else {
            reject(new Error('Unsupported display server for sendTextLinux.'));
        }
    });
}

/**
 * Simulates a 'copy' command (Ctrl+C).
 * This is a simplified version for abstraction.
 */
export function sendCopyLinux() {
    return new Promise((resolve, reject) => {
        if (sessionType === 'x11') {
            // Basic example for X11 using xdotool
            logger.debug('Sending copy command via X11');
            try {
                activeWid = execSync('xdotool getactivewindow').toString().trim();
                const command = `xdotool key --window ${activeWid} --clearmodifiers ctrl+c`;
                exec(command, (error) => {
                    if (error) {
                        logger.error('Error sending copy with xdotool', { error });
                        return reject(error);
                    }
                    resolve();
                });
            } catch (error) {
                logger.error('Error getting active window for copy with xdotool', { error });
                reject(error);
            }
        } else if (sessionType === 'wayland') {
            // Basic example for Wayland using ydotool
            logger.debug('Sending copy command via Wayland');
            const command = `ydotool key 29:1 46:1 46:0 29:0`;
            exec(command, (error) => {
                if (error) {
                    logger.error('Error sending copy with ydotool', { error });
                    return reject(error);
                }
                resolve();
            });
        } else {
            reject(new Error('Unsupported display server for sendCopyLinux.'));
        }
    });
}

/**
 * Gets the active window geometry.
 * This is a simplified version for abstraction.
 * @returns {Promise<object|null>} A promise that resolves with the geometry object or null.
 */
export function getLinuxWindowGeometry() {
    return new Promise((resolve, reject) => {
        if (sessionType === 'x11') {
            logger.debug('Getting window geometry via X11');
            try {
                const wid = execSync('xdotool getactivewindow').toString().trim();
                const command = `xdotool getwindowgeometry --shell ${wid}`;
                const output = execSync(command).toString();
                
                const geometry = {};
                output.split('\n').forEach(line => {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        geometry[key.toLowerCase()] = parseInt(value, 10);
                    }
                });
                resolve(geometry);
            } catch (error) {
                logger.error('Error getting window geometry with xdotool', { error });
                reject(error);
            }
        } else if (sessionType === 'wayland') {
            // Getting arbitrary window geometry is not generally possible on Wayland for security reasons.
            logger.warn('getLinuxWindowGeometry is not supported on Wayland.');
            resolve(null); // Resolve with null for Wayland as it's an expected limitation.
        } else {
            reject(new Error('Unsupported display server for getLinuxWindowGeometry.'));
        }
    });
}

/**
 * Clears any stuck modifier keys.
 * This is a simplified version for abstraction.
 */
export function clearLinuxStuckModifiers() {
    logger.debug(`Clearing stuck modifiers for ${sessionType}`);
    const command = sessionType === 'x11' 
        ? 'xdotool keyup ctrl shift alt super'
        : sessionType === 'wayland'
        ? 'ydotool key 29:0 42:0 56:0'
        : null;

    if (command) {
        exec(command, (error) => {
            if (error) {
                logger.warn(`Failed to clear stuck modifiers for ${sessionType}`, { error });
            }
        });
    }
}


