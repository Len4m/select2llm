/**
 * Servicio de abstracción multiplataforma para Select2LLM
 * Proporciona una interfaz unificada para operaciones específicas del SO
 */

import { exec, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

// Importar controllers específicos de plataforma
import { sendCopyLinux, sendTextLinux, getLinuxWindowGeometry } from '../controllers/linuxController.js';
import { sendCopyWindows, sendTextWindows, getWindowsWindowGeometry } from '../controllers/windowsController.js';
import { 
    sendCopyMac, 
    sendTextMac, 
    getMacWindowGeometry,
    getFrontmostApplication,
    getMacWindowInfo,
    getSystemInfo,
    showNotification
} from '../controllers/macController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PlatformService {
    constructor() {
        this.platform = process.platform;
        this.windowInfo = {
            wid: null, // Linux window ID
            hWnd: null // Windows handle
        };
        
        // Configuración específica de Linux
        this.sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
        
        // Rutas de scripts de PowerShell para Windows
        this.powerShellScripts = {
            copy: path.join(__dirname, '../bin/copy.ps1'),
            sendText: path.join(__dirname, '../bin/sendText.ps1'),
            windowGeometry: path.join(__dirname, '../bin/windowGeometry.ps1')
        };

        logger.platformOperation('Initialized', this.platform);
    }

    /**
     * Obtiene información sobre la plataforma actual
     */
    getPlatformInfo() {
        return {
            platform: this.platform,
            sessionType: this.sessionType,
            isWindows: this.platform === 'win32',
            isMacOS: this.platform === 'darwin',
            isLinux: this.platform === 'linux'
        };
    }

    /**
     * Escapa cadenas para bash (usado en Linux con xdotool)
     */
    escapeForBash(args) {
        return args.map(s => {
            if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
                s = "'" + s.replace(/'/g, "'\\''") + "'";
                s = s.replace(/^(?:'')+/g, '').replace(/\\'''/g, "\\'");
            }
            return s;
        }).join(' ');
    }

    /**
     * Escapa cadenas para Windows SendKeys
     */
    escapeForSendKeys(input) {
        let escapedString = input;

        escapedString = escapedString.replace(/\r\n|\n|\r/g, '{ENTER}');
        escapedString = escapedString.replace(/\t/g, '{TAB}');
        
        const specialChars = /[~!@#$%^&*()_+|:<>?[\]\\;,./`\-=\s]/g;
        escapedString = escapedString.replace(specialChars, match => {
            if (match === ' ') return ' ';
            return `{${match}}`;
        });

        escapedString = escapedString.replace(/"/g, '""');
        return escapedString;
    }

    /**
     * Ejecuta un comando de forma asíncrona con manejo de errores
     */
    executeCommand(command, description = 'Command execution') {
        return new Promise((resolve, reject) => {
            logger.debug(`Executing command: ${command}`, { description });
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`Command failed: ${description}`, { 
                        command, 
                        error: error.message, 
                        stderr 
                    });
                    reject(new Error(`${description} failed: ${error.message}`));
                    return;
                }
                
                logger.debug(`Command completed: ${description}`, { stdout: stdout.trim() });
                resolve(stdout.trim());
            });
        });
    }

    /**
     * Ejecuta un comando de forma síncrona
     */
    executeCommandSync(command, description = 'Sync command execution') {
        try {
            logger.debug(`Executing sync command: ${command}`, { description });
            const result = execSync(command).toString().trim();
            logger.debug(`Sync command completed: ${description}`, { result });
            return result;
        } catch (error) {
            logger.error(`Sync command failed: ${description}`, { 
                command, 
                error: error.message 
            });
            throw new Error(`${description} failed: ${error.message}`);
        }
    }

    /**
     * Envía comando de copia según la plataforma y devuelve el identificador de la ventana
     */
    async sendCopyCommand() {
        logger.platformOperation('sendCopyCommand', this.platform);

        switch (this.platform) {
            case 'win32':
                return sendCopyWindows();
            case 'darwin':
                return sendCopyMac();
            case 'linux':
                return sendCopyLinux();
            default:
                throw new Error(`Unsupported platform: ${this.platform}`);
        }
    }

    /**
     * Envía texto como si fuera escrito según la plataforma
     */
    async sendText(text) {
        if (!text || text.length === 0) {
            logger.debug('Empty text, skipping send');
            return;
        }

        logger.platformOperation('sendText', this.platform);

        switch (this.platform) {
            case 'win32':
                return sendTextWindows(text);
            case 'darwin':
                return sendTextMac(text);
            case 'linux':
                return sendTextLinux(text);
            default:
                throw new Error(`Unsupported platform: ${this.platform}`);
        }
    }

    /**
     * Obtiene la geometría de la ventana según la plataforma
     */
    async getWindowGeometry() {
        logger.platformOperation('getWindowGeometry', this.platform);

        const defaultGeometry = { x: 0, y: 0, width: 0, height: 0 };

        switch (this.platform) {
            case 'win32':
                return getWindowsWindowGeometry();
            case 'darwin':
                return getMacWindowGeometry();
            case 'linux':
                return getLinuxWindowGeometry();
            default:
                return defaultGeometry;
        }
    }

    // === MÉTODOS DE UTILIDAD HEREDADOS ===
    // Los métodos específicos de plataforma ahora se manejan en los controllers dedicados

    // === MÉTODOS ESPECÍFICOS DE MACOS ===

    /**
     * Obtiene información de la aplicación actualmente enfocada (solo macOS)
     */
    async getFrontmostApplication() {
        if (this.platform !== 'darwin') {
            throw new Error('getFrontmostApplication is only available on macOS');
        }
        return getFrontmostApplication();
    }

    /**
     * Obtiene información detallada de la ventana (solo macOS)
     */
    async getMacWindowInfo() {
        if (this.platform !== 'darwin') {
            throw new Error('getMacWindowInfo is only available on macOS');
        }
        return getMacWindowInfo();
    }

    /**
     * Obtiene información del sistema (solo macOS)
     */
    async getSystemInfo() {
        if (this.platform !== 'darwin') {
            throw new Error('getSystemInfo is only available on macOS');
        }
        return getSystemInfo();
    }

    /**
     * Muestra una notificación del sistema (solo macOS)
     */
    async showNotification(title, message, subtitle = '') {
        if (this.platform !== 'darwin') {
            throw new Error('showNotification is only available on macOS');
        }
        return showNotification(title, message, subtitle);
    }
}

// Instancia singleton del servicio de plataforma
const platformService = new PlatformService();

export default platformService;
