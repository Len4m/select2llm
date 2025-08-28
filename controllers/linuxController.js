import { exec, execSync } from 'child_process';
import logger from '../services/logger.js';

let wid;
const sessionType = detectLinuxDisplayServer(); // 'wayland', 'x11', or null

/**
 * Detects the display server in Linux
 * @returns {string|null} 'wayland', 'x11', or null if unknown
 */
export function detectLinuxDisplayServer() {
    const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const display = process.env.DISPLAY;
    
    // Detect Wayland
    if (sessionType === 'wayland' || waylandDisplay) {
        return 'wayland';
    }
    // Detect X11
    else if (sessionType === 'x11' || display) {
        return 'x11';
    }
    // Special cases for other environments
    else if (sessionType) {
        return sessionType; // mir, etc.
    }
    else {
        return null; // unknown
    }
}

// Function to clear stuck modifiers in X11
export function clearStuckModifiers() {
    if (sessionType === 'x11' && wid) {
        const clearCmd = `xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt`;
        exec(clearCmd, (error) => {
            if (error) {
                logger.debug('Error clearing stuck modifiers', { error: error.message });
            } else {
                logger.debug('Stuck modifiers cleared successfully');
            }
        });
    }
}

// Function to escape special characters for bash (used with xdotool)
function escapeForBash(args) {
    return args.map(s => {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '').replace(/\\'''/g, "\\'");
        }
        return s;
    }).join(' ');
}

export function sendTextLinux(text) {
    return new Promise((resolve, reject) => {
        const lines = text.split('\n');

        function typeLines(lines) {
            if (lines.length === 0) {
                // Limpiar modificadores al finalizar el envío de texto
                clearStuckModifiers();
                resolve(); // All lines processed
                return;
            }
            const line = lines.shift();
            let cmd = '';

            if (sessionType === 'x11') {
                // In X11: use xdotool and window ID (wid)
                logger.debug('Preparing command to send text in X11', { line, wid });
                
                const buildXdotoolCommand = (action, args = []) => {
                    const baseArgs = ['xdotool', action, '--clearmodifiers'];
                    if (wid) {
                        baseArgs.push('--window', wid);
                    }
                    return escapeForBash([...baseArgs, ...args]);
                };

                const commands = [];

                // Add write command if there is text
                if (line.length > 0) {
                    commands.push(buildXdotoolCommand('type', ['--delay', '1', '--', line]));
                    logger.debug('Write command generated', { cmd: commands[commands.length - 1] });
                }

                // Add Enter command if there are more lines
                if (lines.length > 0) {
                    commands.push(buildXdotoolCommand('key', ['Return']));
                    logger.debug('Enter command added', { cmd: commands[commands.length - 1] });
                }

                cmd = commands.join(' && ');
                logger.debug('Final X11 command', { cmd });
            } else if (sessionType === 'wayland') {
                // In Wayland: use ydotool instead of wtype
                if (line.length > 0) {
                    // ydotool writes text directly with the "type" command
                    const safeLine = line.replace(/'/g, "'\\''");
                    cmd = `ydotool type '${safeLine}'`;
                }
                if (lines.length > 0) {
                    // To send Enter key we use the "key" command
                    if (line.length > 0)
                        cmd += ` && ydotool key Return`;
                    else
                        cmd = `ydotool key Return`;
                }
            } else {
                return reject(new Error('Operating system not supported for text sending'));
            }

            if (cmd) {
                exec(cmd, (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`Error escribiendo línea: ${error}\n${stderr}`));
                        return;
                    }
                    typeLines(lines);
                });
            } else {
                typeLines(lines);
            }
        }

        typeLines(lines);
    });
}

export async function sendCopyLinux() {
    return new Promise((resolve, reject) => {
        if (sessionType === 'x11') {
            // In X11: get window ID and send ctrl+c with xdotool
            exec('xdotool getwindowfocus', (error1, stdout1, stderr1) => {
                if (error1) {
                    return reject(new Error(`Error getting window ID: ${error1}\n${stderr1}`));
                }
                wid = String(stdout1).trim();
                if (!wid) {
                    return reject(new Error('Window not found'));
                }
                // Send ctrl+c and then clear modifiers to avoid stuck keys
                const copyCmd = `xdotool key --clearmodifiers --window '${wid}' ctrl+c && xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt`;
                exec(copyCmd, (error2, stdout2, stderr2) => {
                    if (error2) {
                        return reject(new Error(`Error copying to clipboard: ${error2}\n${stderr2}`));
                    }
                    logger.debug('Ctrl+C sent via X11 with modifier cleanup');
                    resolve();
                });
            });
        } else if (sessionType === 'wayland') {
            // In Wayland: use ydotool to send ctrl+c
            // Use the 'key' command with modifiers syntax
            exec(`ydotool key ctrl+c`, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`Error copying with ydotool: ${error}\n${stderr}`));
                }
                logger.debug('Ctrl+C sent via Wayland');
                resolve();
            });
        } else {
            reject(new Error('Operating system not supported for copying'));
        }
    });
}

export function getLinuxWindowGeometry() {
    if (sessionType === 'x11') {
        // In X11: get focused window geometry using xdotool
        if (!wid) {
            logger.debug('No window ID available, cannot get geometry');
            return false;
        }
        
        try {
            const cmd = `xdotool getwindowgeometry --shell ${wid}`;
            const output = execSync(cmd).toString();
            const geom = {};
            const lines = output.split('\n');
            for (let line of lines) {
                if (line.startsWith('X=')) {
                    geom.x = parseInt(line.split('=')[1].trim());
                } else if (line.startsWith('Y=')) {
                    geom.y = parseInt(line.split('=')[1].trim());
                } else if (line.startsWith('WIDTH=')) {
                    geom.width = parseInt(line.split('=')[1].trim());
                } else if (line.startsWith('HEIGHT=')) {
                    geom.height = parseInt(line.split('=')[1].trim()); 
                }
            }
            logger.debug('Got window geometry from xdotool', geom);
            return geom;
        } catch (error) {
            logger.debug('Failed to get window geometry with xdotool', { error: error.message });
            return false;
        }
    } else {
        // In Wayland: no equivalent to get focused window geometry
        logger.debug('getLinuxWindowGeometry not available in Wayland');
        return false;
    }
}

/**
 * Applies Wayland-specific configurations for Electron (Linux Wayland only)
 * @param {Object} app - Electron app instance
 * @param {string} currentSessionType - Current session type ('wayland', 'x11', etc.)
 * @returns {boolean} True if flags were applied successfully
 */
export function applyWaylandElectronFlags(app, currentSessionType) {
    if (currentSessionType !== 'wayland') {
        return false;
    }

    try {
        // Enable enhanced Wayland support in Electron
        app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WaylandWindowDecorations');
        app.commandLine.appendSwitch('enable-wayland-ime');
        
        // Suppress non-critical X11/UI warnings in Wayland mode
        app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
        // En desarrollo, mostrar todos los logs (log-level=0)
        const logLevel = process.env.NODE_ENV === 'development' ? '0' : '2';
        app.commandLine.appendSwitch('log-level', logLevel);

        logger.info('Wayland Electron flags applied', {
            sessionType: currentSessionType,
            waylandDisplay: process.env.WAYLAND_DISPLAY,
            compositor: process.env.XDG_CURRENT_DESKTOP,
            flags: [
                'GlobalShortcutsPortal', 
                'enable-wayland-ime',
                'disable-features=VizDisplayCompositor',
                `log-level=${logLevel}`
            ]
        });
        
        return true;
    } catch (error) {
        logger.error('Error applying Wayland Electron flags', { error: error.message });
        return false;
    }
}

/**
 * Provides Wayland environment diagnosis for Linux systems
 * @param {Object} platformInfo - Platform information from platformService
 */
export function logWaylandEnvironmentDiagnosis(platformInfo) {
    if (!platformInfo.isLinux) {
        return;
    }

    if (platformInfo.isWayland) {
        logger.info('Wayland environment diagnosis', {
            XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP,
            XDG_SESSION_DESKTOP: process.env.XDG_SESSION_DESKTOP,
            DESKTOP_SESSION: process.env.DESKTOP_SESSION,
            WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR
        });
        
        logger.warn('WAYLAND LIMITATION: Global shortcuts may not work outside the focused application window.');
        logger.warn('For true global shortcuts, consider using an X11 session instead.');
        logger.warn('You can usually select X11 at login by choosing "GNOME on Xorg" or similar option.');
    } else if (platformInfo.isX11) {
        logger.info('X11 session detected: using standard global shortcuts', {
            sessionType: platformInfo.sessionType,
            display: process.env.DISPLAY
        });
    } else if (platformInfo.isLinux && !platformInfo.sessionType) {
        logger.warn('Unknown display server on Linux - shortcuts may not work properly', {
            sessionType: platformInfo.sessionType,
            waylandDisplay: process.env.WAYLAND_DISPLAY,
            display: process.env.DISPLAY
        });
    }
}

/**
 * Checks Wayland portals availability for global shortcuts support
 * @param {Object} platformService - Platform service instance to execute commands
 * @returns {Promise<Object>} Portal status and recommendations
 */
export async function checkWaylandPortals(platformService) {
    try {
        logger.info('Checking Wayland portals for global shortcuts support...');
        
        // Check if portals are available
        const portalChecks = [
            // Check xdg-desktop-portal in multiple ways (silent failures expected for non-native package managers)
            Promise.allSettled([
                platformService.executeCommandSilent('which xdg-desktop-portal', 'Check xdg-desktop-portal via which').catch(() => null),
                platformService.executeCommandSilent('whereis xdg-desktop-portal', 'Check xdg-desktop-portal via whereis').then(result => {
                    // whereis returns "name:" if not found, "name: /path" if found
                    return result && result.includes('/') ? result : null;
                }).catch(() => null),
                platformService.executeCommandSilent('dpkg -l | grep xdg-desktop-portal', 'Check xdg-desktop-portal via dpkg').catch(() => null),
                platformService.executeCommandSilent('rpm -qa | grep xdg-desktop-portal', 'Check xdg-desktop-portal via rpm').catch(() => null),
                platformService.executeCommandSilent('pacman -Q xdg-desktop-portal', 'Check xdg-desktop-portal via pacman').catch(() => null)
            ]).then(results => results.some(r => r.status === 'fulfilled' && r.value)),
            
            // Check Wayland-specific portal (silent failures expected for non-native package managers)
            Promise.allSettled([
                platformService.executeCommandSilent('which xdg-desktop-portal-wlr', 'Check xdg-desktop-portal-wlr via which').catch(() => null),
                platformService.executeCommandSilent('whereis xdg-desktop-portal-wlr', 'Check xdg-desktop-portal-wlr via whereis').then(result => {
                    // whereis returns "name:" if not found, "name: /path" if found
                    return result && result.includes('/') ? result : null;
                }).catch(() => null)
            ]).then(results => results.some(r => r.status === 'fulfilled' && r.value && r.value.trim())).catch(() => null),
            
            // Check KDE-specific portal in multiple ways (silent failures expected for non-native package managers)
            Promise.allSettled([
                platformService.executeCommandSilent('which xdg-desktop-portal-kde', 'Check xdg-desktop-portal-kde via which').catch(() => null),
                platformService.executeCommandSilent('whereis xdg-desktop-portal-kde', 'Check xdg-desktop-portal-kde via whereis').then(result => {
                    // whereis returns "name:" if not found, "name: /path" if found
                    return result && result.includes('/') ? result : null;
                }).catch(() => null),
                platformService.executeCommandSilent('dpkg -l | grep "ii.*xdg-desktop-portal-kde"', 'Check xdg-desktop-portal-kde via dpkg').catch(() => null),
                platformService.executeCommandSilent('rpm -qa | grep xdg-desktop-portal-kde', 'Check xdg-desktop-portal-kde via rpm').catch(() => null),
                platformService.executeCommandSilent('pacman -Q xdg-desktop-portal-kde', 'Check xdg-desktop-portal-kde via pacman').catch(() => null)
            ]).then(results => results.some(r => r.status === 'fulfilled' && r.value && r.value.trim())),
            
            // Check if portal is running
            platformService.executeCommand('pgrep -f xdg-desktop-portal', 'Check portal process').catch(() => null),
            
            // Check specifically if KDE portal is running
            platformService.executeCommand('pgrep -f xdg-desktop-portal-kde', 'Check KDE portal process').catch(() => null)
        ];
        
        const [portalBin, portalWlr, portalKde, portalProcess, portalKdeProcess] = await Promise.all(portalChecks);
        
        const portalStatus = {
            'xdg-desktop-portal': !!portalBin,
            'xdg-desktop-portal-wlr': !!portalWlr,
            'xdg-desktop-portal-kde': !!portalKde,
            'xdg-desktop-portal-kde-running': !!portalKdeProcess,
            'portal-running': !!portalProcess,
            compositor: process.env.XDG_CURRENT_DESKTOP || 'unknown'
        };
        
        logger.info('Wayland portals status', portalStatus);
        
        // Give specific recommendations based on compositor
        const compositor = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
        
        if (!portalBin) {
            logger.warn('❌ xdg-desktop-portal not found. Install it for global shortcuts support:');
            logger.info('   Ubuntu/Debian: sudo apt install xdg-desktop-portal');
            logger.info('   Fedora: sudo dnf install xdg-desktop-portal');
            logger.info('   Arch: sudo pacman -S xdg-desktop-portal');
        } else {
            logger.info('✅ xdg-desktop-portal is installed');
        }
        
        // Compositor-specific checks
        if (compositor.includes('kde') || compositor.includes('plasma')) {
            if (!portalKde && !portalKdeProcess) {
                logger.warn('❌ xdg-desktop-portal-kde not found for KDE Plasma:');
                logger.info('   Ubuntu/Debian: sudo apt install xdg-desktop-portal-kde');
                logger.info('   Fedora: sudo dnf install xdg-desktop-portal-kde');
                logger.info('   Arch: sudo pacman -S xdg-desktop-portal-kde');
            } else if (portalKde || portalKdeProcess) {
                if (portalKde) {
                    logger.info('✅ xdg-desktop-portal-kde is installed');
                } else {
                    logger.info('✅ xdg-desktop-portal-kde detected via running process');
                }
                
                if (!portalKdeProcess) {
                    logger.warn('⚠️  xdg-desktop-portal-kde is not running. Try:');
                    logger.info('   systemctl --user restart xdg-desktop-portal');
                    logger.info('   killall xdg-desktop-portal && sleep 2 && /usr/libexec/xdg-desktop-portal &');
                } else {
                    logger.info('✅ xdg-desktop-portal-kde process is running');
                }
            }
        }
        
        if (!portalWlr && (compositor.includes('sway') || compositor.includes('wlroots'))) {
            logger.warn('❌ xdg-desktop-portal-wlr not found for wlroots-based compositor:');
            logger.info('   Ubuntu/Debian: sudo apt install xdg-desktop-portal-wlr');
            logger.info('   Fedora: sudo dnf install xdg-desktop-portal-wlr');
            logger.info('   Arch: sudo pacman -S xdg-desktop-portal-wlr');
        }
        
        if (!portalProcess) {
            logger.warn('⚠️  xdg-desktop-portal process not running. Try starting it:');
            logger.info('   systemctl --user start xdg-desktop-portal');
        } else {
            logger.info('✅ xdg-desktop-portal process is running');
        }
        
        // Compositor-specific information
        switch (compositor) {
            case 'gnome':
                logger.info('GNOME detected: Global shortcuts should work with xdg-desktop-portal-gnome');
                break;
            case 'kde':
                logger.info('KDE Plasma detected: Global shortcuts require xdg-desktop-portal-kde');
                
                if (portalKde || portalKdeProcess) {
                    logger.warn('⚠️  Even with xdg-desktop-portal-kde, KDE Plasma Wayland has significant limitations:');
                    logger.warn('   • Global shortcuts only work when app window is focused');
                    logger.warn('   • True system-wide shortcuts are not supported');
                    logger.warn('   • This is a known limitation of KDE Plasma Wayland compositor');
                } else {
                    logger.warn('⚠️  KDE Plasma Wayland has limited global shortcuts support even with portals');
                }
                
                logger.warn('🔧 For reliable global shortcuts in KDE, consider:');
                logger.warn('   1. Switch to Plasma X11 session (recommended)');
                logger.warn('   2. Configure shortcuts manually in System Settings > Shortcuts > Custom Shortcuts');
                logger.warn('   3. Use KRunner or similar KDE-specific tools');
                break;
            case 'plasma':
                logger.info('KDE Plasma detected: Global shortcuts require xdg-desktop-portal-kde');
                logger.warn('⚠️  Plasma Wayland has limited global shortcuts support');
                logger.warn('🔧 Switch to X11 session for full global shortcuts functionality');
                break;
            case 'sway':
                logger.info('Sway detected: Requires xdg-desktop-portal-wlr for global shortcuts');
                break;
            default:
                logger.warn(`Unknown compositor '${compositor}': Global shortcuts support may be limited`);
        }
        
        return portalStatus;
        
    } catch (error) {
        logger.error('Error checking Wayland portals', { error: error.message });
        return null;
    }
}
