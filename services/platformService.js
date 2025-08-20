/**
 * Servicio de abstracción multiplataforma para Select2LLM
 * Proporciona una interfaz unificada para operaciones específicas del SO
 */

import { exec, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

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
     * Envía comando de copia según la plataforma
     */
    async sendCopyCommand() {
        logger.platformOperation('sendCopyCommand', this.platform);

        switch (this.platform) {
            case 'win32':
                return this.sendCopyWindows();
            case 'darwin':
                return this.sendCopyMac();
            case 'linux':
                return this.sendCopyLinux();
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
                return this.sendTextWindows(text);
            case 'darwin':
                return this.sendTextMac(text);
            case 'linux':
                return this.sendTextLinux(text);
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
                return this.getWindowsWindowGeometry();
            case 'darwin':
                return defaultGeometry; // macOS no implementado
            case 'linux':
                return this.getLinuxWindowGeometry();
            default:
                return defaultGeometry;
        }
    }

    // === IMPLEMENTACIONES ESPECÍFICAS DE WINDOWS ===

    /**
     * Envía comando de copia en Windows
     */
    async sendCopyWindows() {
        const command = `powershell.exe -ExecutionPolicy Bypass -File ${this.powerShellScripts.copy}`;
        const result = await this.executeCommand(command, 'Windows copy command');
        this.windowInfo.hWnd = result;
        return result;
    }

    /**
     * Envía texto en Windows
     */
    async sendTextWindows(text) {
        if (!this.windowInfo.hWnd) {
            throw new Error('Windows handle not available. Call sendCopyCommand first.');
        }

        const escapedText = this.escapeForSendKeys(text);
        const command = `powershell.exe -ExecutionPolicy Bypass -File ${this.powerShellScripts.sendText} -hWnd ${this.windowInfo.hWnd} -Texto "${escapedText}"`;
        
        return this.executeCommand(command, 'Windows send text');
    }

    /**
     * Obtiene geometría de ventana en Windows
     */
    async getWindowsWindowGeometry() {
        if (!this.windowInfo.hWnd) {
            throw new Error('Windows handle not available. Call sendCopyCommand first.');
        }

        const command = `powershell.exe -ExecutionPolicy Bypass -File ${this.powerShellScripts.windowGeometry} -hwnd ${this.windowInfo.hWnd}`;
        const result = this.executeCommandSync(command, 'Windows window geometry');
        
        return JSON.parse(result);
    }

    // === IMPLEMENTACIONES ESPECÍFICAS DE LINUX ===

    /**
     * Envía comando de copia en Linux
     */
    async sendCopyLinux() {
        if (this.sessionType === 'x11') {
            return this.sendCopyLinuxX11();
        } else if (this.sessionType === 'wayland') {
            return this.sendCopyLinuxWayland();
        } else {
            throw new Error(`Unsupported Linux session type: ${this.sessionType}`);
        }
    }

    /**
     * Envía comando de copia en Linux X11
     */
    async sendCopyLinuxX11() {
        const wid = await this.executeCommand('xdotool getwindowfocus', 'Get focused window');
        this.windowInfo.wid = wid;
        
        if (!this.windowInfo.wid) {
            throw new Error('No focused window found');
        }

        return this.executeCommand(
            `xdotool key --clearmodifiers --window '${this.windowInfo.wid}' ctrl+c`,
            'X11 copy command'
        );
    }

    /**
     * Envía comando de copia en Linux Wayland
     */
    async sendCopyLinuxWayland() {
        return this.executeCommand(
            'ydotool keydown ctrl && ydotool key c && ydotool keyup ctrl',
            'Wayland copy command'
        );
    }

    /**
     * Envía texto en Linux
     */
    async sendTextLinux(text) {
        const lines = text.split('\n');
        return this.sendTextLinuxRecursive(lines);
    }

    /**
     * Envía líneas de texto recursivamente en Linux
     */
    async sendTextLinuxRecursive(lines) {
        if (lines.length === 0) {
            return;
        }

        const line = lines.shift();
        let command = '';

        if (this.sessionType === 'x11') {
            command = this.buildX11TextCommand(line, lines.length > 0);
        } else if (this.sessionType === 'wayland') {
            command = this.buildWaylandTextCommand(line, lines.length > 0);
        } else {
            throw new Error(`Unsupported Linux session type: ${this.sessionType}`);
        }

        if (command) {
            await this.executeCommand(command, 'Linux send text line');
        }

        // Recursivamente procesar las líneas restantes
        return this.sendTextLinuxRecursive(lines);
    }

    /**
     * Construye comando de texto para X11
     */
    buildX11TextCommand(line, hasMoreLines) {
        if (!this.windowInfo.wid) {
            throw new Error('Window ID not available. Call sendCopyCommand first.');
        }

        let command = '';
        
        if (line.length > 0) {
            command = this.escapeForBash(['xdotool', 'type', '--clearmodifiers', '--window', this.windowInfo.wid, '--', line]);
        }
        
        if (hasMoreLines) {
            const enterCmd = `xdotool key --clearmodifiers --window '${this.windowInfo.wid}' Return`;
            command = line.length > 0 ? `${command} && ${enterCmd}` : enterCmd;
        }

        return command;
    }

    /**
     * Construye comando de texto para Wayland
     */
    buildWaylandTextCommand(line, hasMoreLines) {
        let command = '';
        
        if (line.length > 0) {
            const safeLine = line.replace(/'/g, "'\\''");
            command = `ydotool type '${safeLine}'`;
        }
        
        if (hasMoreLines) {
            const enterCmd = 'ydotool key Return';
            command = line.length > 0 ? `${command} && ${enterCmd}` : enterCmd;
        }

        return command;
    }

    /**
     * Obtiene geometría de ventana en Linux
     */
    getLinuxWindowGeometry() {
        if (this.sessionType === 'x11') {
            return this.getLinuxWindowGeometryX11();
        } else if (this.sessionType === 'wayland') {
            throw new Error('Window geometry not supported in Wayland');
        } else {
            throw new Error(`Unsupported Linux session type: ${this.sessionType}`);
        }
    }

    /**
     * Obtiene geometría de ventana en Linux X11
     */
    getLinuxWindowGeometryX11() {
        if (!this.windowInfo.wid) {
            throw new Error('Window ID not available. Call sendCopyCommand first.');
        }

        const command = `xdotool getwindowgeometry --shell ${this.windowInfo.wid}`;
        const output = this.executeCommandSync(command, 'X11 window geometry');
        
        const geometry = {};
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.startsWith('X=')) {
                geometry.x = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('Y=')) {
                geometry.y = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('WIDTH=')) {
                geometry.width = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('HEIGHT=')) {
                geometry.height = parseInt(line.split('=')[1].trim());
            }
        }

        return geometry;
    }

    // === IMPLEMENTACIONES ESPECÍFICAS DE MACOS ===

    /**
     * Envía comando de copia en macOS
     */
    sendCopyMac() {
        const script = `
            tell application "System Events"
                keystroke "c" using {command down}
            end tell
        `;
        
        return this.executeCommand(`osascript -e '${script}'`, 'macOS copy command');
    }

    /**
     * Envía texto en macOS
     */
    sendTextMac(text) {
        const script = `
            tell application "System Events"
                keystroke "${text}"
            end tell
        `;
        
        return this.executeCommand(`osascript -e '${script}'`, 'macOS send text');
    }
}

// Instancia singleton del servicio de plataforma
const platformService = new PlatformService();

export default platformService;
