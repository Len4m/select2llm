/**
 * Servicio de abstracción multiplataforma para Select2LLM
 * Proporciona una interfaz unificada para operaciones específicas del SO
 */

import { exec, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { screen } from 'electron';
import logger from './logger.js';

// Importar controllers específicos de plataforma
import { 
    sendCopyLinux, 
    sendTextLinux, 
    getLinuxWindowGeometry, 
    clearLinuxStuckModifiers, 
    detectLinuxDisplayServer
} from '../controllers/linuxController.js';
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
        this.sessionType = detectLinuxDisplayServer();
        
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
            isLinux: this.platform === 'linux',
            isWayland: this.platform === 'linux' && this.sessionType === 'wayland',
            isX11: this.platform === 'linux' && this.sessionType === 'x11'
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
     * Executes a command asynchronously with error handling
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
     * Executes a command asynchronously without error logging (for multi-distro checks)
     */
    executeCommandSilent(command, description = 'Silent command execution') {
        return new Promise((resolve, reject) => {
            logger.debug(`Executing silent command: ${command}`, { description });
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // No log errors for silent commands - they're expected to fail in multi-distro checks
                    reject(new Error(`${description} failed: ${error.message}`));
                    return;
                }
                
                logger.debug(`Silent command completed: ${description}`, { stdout: stdout.trim() });
                resolve(stdout.trim());
            });
        });
    }

    /**
     * Executes a command synchronously
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
     * Sends copy command according to platform and returns window identifier
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
     * Sends text as if typed according to platform
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
     * Gets window geometry according to platform
     */
    async getWindowGeometry() {
        logger.platformOperation('getWindowGeometry', this.platform);

        // Try to get platform-specific focused window geometry first
        let platformGeometry = null;
        
        try {
            switch (this.platform) {
                case 'win32':
                    platformGeometry = getWindowsWindowGeometry();
                    break;
                case 'darwin':
                    platformGeometry = getMacWindowGeometry();
                    break;
                case 'linux':
                    platformGeometry = getLinuxWindowGeometry();
                    break;
            }
        } catch (error) {
            logger.debug('Platform-specific geometry failed', { error: error.message });
        }

        // If platform-specific method worked, use it
        if (platformGeometry && platformGeometry !== false) {
            logger.debug('Using platform-specific window geometry', platformGeometry);
            return platformGeometry;
        }

        // Fallback: use Electron's screen API for full-screen overlay
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
            
            const fullScreenGeometry = {
                x: 0,
                y: 0,
                width: screenWidth,
                height: screenHeight
            };
            
            logger.debug('Using full-screen geometry from Electron screen API', {
                ...fullScreenGeometry,
                scaleFactor: primaryDisplay.scaleFactor
            });
            
            return fullScreenGeometry;
            
        } catch (electronError) {
            logger.warn('Failed to get screen geometry, using safe defaults', { 
                error: electronError.message  
            });
            
            // Ultimate fallback
            return {
                x: 0,
                y: 0,
                width: 500,
                height: 500
            };
        }
    }

    /**
     * Clears stuck modifiers (especially useful in Linux X11)
     */
    clearStuckModifiers() {
        logger.platformOperation('clearStuckModifiers', this.platform);

        switch (this.platform) {
            case 'linux':
                clearLinuxStuckModifiers();
                break;
            case 'win32':
            case 'darwin':
                // En Windows y macOS normalmente no tenemos este problema
                logger.debug('clearStuckModifiers not needed for this platform');
                break;
            default:
                logger.warn('clearStuckModifiers not supported for platform', { platform: this.platform });
        }
    }


    // === INHERITED UTILITY METHODS ===
    // Platform-specific methods are now handled in dedicated controllers

    // === MACOS-SPECIFIC METHODS ===

    /**
     * Gets information of currently focused application (macOS only)
     */
    async getFrontmostApplication() {
        if (this.platform !== 'darwin') {
            throw new Error('getFrontmostApplication is only available on macOS');
        }
        return getFrontmostApplication();
    }

    /**
     * Gets detailed window information (macOS only)
     */
    async getMacWindowInfo() {
        if (this.platform !== 'darwin') {
            throw new Error('getMacWindowInfo is only available on macOS');
        }
        return getMacWindowInfo();
    }

    /**
     * Gets system information (macOS only)
     */
    async getSystemInfo() {
        if (this.platform !== 'darwin') {
            throw new Error('getSystemInfo is only available on macOS');
        }
        return getSystemInfo();
    }

    /**
     * Shows a system notification (macOS only)
     */
    async showNotification(title, message, subtitle = '') {
        if (this.platform !== 'darwin') {
            throw new Error('showNotification is only available on macOS');
        }
        return showNotification(title, message, subtitle);
    }

    // === LINUX-SPECIFIC METHODS ===
    // These methods are now greatly simplified or removed.
    // The simplified linuxController does not require these complex helpers anymore.

}

// Instancia singleton del servicio de plataforma
const platformService = new PlatformService();

export default platformService;
