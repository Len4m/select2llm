import { exec, execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import logger from '../services/logger.js';
import i18n from '../i18n.js';

let wid;
const sessionType = detectLinuxDisplayServer(); // 'wayland', 'x11', or null

// Wayland streaming coalescing buffer to prevent UTF-8 fragmentation
let waylandBuffer = '';
let waylandFlushTimer = null;
let waylandFlushInProgress = false;
let waylandLastFlushTime = 0;
const WAYLAND_MIN_INTERVAL_MS = 250; // espera mínima entre flushes
const WAYLAND_DEBOUNCE_MS = 400;
const WAYLAND_FORCE_FLUSH_THRESHOLD = 800; // flush inmediato si el buffer crece demasiado
let waylandPendingResolvers = [];
// removed duplicate constants; using single set above
const WAYLAND_PASTE_DELAY_S = 0.25; // delay entre copy y paste
const WAYLAND_POST_PASTE_DELAY_S = 0.12; // delay tras el pegado
const WAYLAND_MIN_FLUSH_CHARS = 120; // mínimo antes de flushear durante streaming
const WAYLAND_MAX_CHUNK_CHARS = 200; // tamaño máximo por bloque en un flush
// Throttle para logs de liberación de modificadores
const CLEAR_LOG_THROTTLE_MS = 300;
let lastClearLogAt = 0;

// Construye locales UTF-8 basados en el idioma del sistema (vía i18n)
function getUtf8Locale() {
    const lang = (i18n && i18n.language) ? String(i18n.language).toLowerCase() : 'en';
    switch (lang) {
        case 'es':
            return { LC: 'es_ES.UTF-8', LANGUAGE: 'es_ES:es' };
        case 'ca':
            return { LC: 'ca_ES.UTF-8', LANGUAGE: 'ca_ES:ca' };
        case 'en':
        default:
            return { LC: 'en_US.UTF-8', LANGUAGE: 'en_US:en' };
    }
}

function buildExecOptions() {
    const { LC, LANGUAGE } = getUtf8Locale();
    return {
        encoding: 'utf8',
        env: {
            ...process.env,
            LC_ALL: LC,
            LANG: LC,
            LC_CTYPE: LC,
            LANGUAGE
        }
    };
}

function scheduleWaylandFlush(execOptions) {
    if (waylandFlushTimer) {
        clearTimeout(waylandFlushTimer);
    }
    // Si el buffer se dispara, forzar flush inmediato
    if (waylandBuffer && waylandBuffer.length >= WAYLAND_FORCE_FLUSH_THRESHOLD && !waylandFlushInProgress) {
        flushWaylandBuffer(execOptions);
        return;
    }
    // Si aún no alcanzamos el tamaño mínimo, retrasar el flush para acumular
    const baseDelay = waylandBuffer.length < WAYLAND_MIN_FLUSH_CHARS ? WAYLAND_DEBOUNCE_MS : 10;
    const sinceLast = Date.now() - waylandLastFlushTime;
    const extra = sinceLast < WAYLAND_MIN_INTERVAL_MS ? (WAYLAND_MIN_INTERVAL_MS - sinceLast) : 0;
    const delay = Math.max(baseDelay, extra);
    waylandFlushTimer = setTimeout(() => {
        flushWaylandBuffer(execOptions);
    }, delay);
}

function flushWaylandBuffer(execOptions) {
    if (waylandFlushInProgress) {
        // Reintentar tras un breve tiempo si ya hay un flush en curso
        scheduleWaylandFlush(execOptions);
        return;
    }
    const payload = waylandBuffer;
    if (!payload || payload.length === 0) {
        return;
    }
    // Generar chunks seguros (no cortar palabra ni acento) de hasta WAYLAND_MAX_CHUNK_CHARS
    const chunks = [];
    let remaining = payload;
    while (remaining.length > 0) {
        const max = Math.min(WAYLAND_MAX_CHUNK_CHARS, remaining.length);
        const cut = sliceChunkAtBoundary(remaining, max);
        chunks.push(cut);
        remaining = remaining.slice(cut.length);
    }

    // Preparar flush
    waylandBuffer = '';
    waylandFlushInProgress = true;

    const sendSequential = (index) => {
        if (index >= chunks.length) {
            waylandFlushInProgress = false;
            waylandLastFlushTime = Date.now();
            logger.debug('Wayland flush completed');
            const resolvers = waylandPendingResolvers; waylandPendingResolvers = [];
            resolvers.forEach(r => { try { r(); } catch {} });
            return;
        }
        const part = chunks[index];
        tryWaylandTypeMulti(part, execOptions)
            .then(() => sendSequential(index + 1))
            .catch((error) => {
                logger.error('Wayland flush chunk failed', { error: error.message, index: index + 1, total: chunks.length });
                // Continuar con siguientes para no bloquear
                sendSequential(index + 1);
            });
    };

    sendSequential(0);
}

// Corta el texto en un punto seguro <= max, evitando cortar palabras/acentos
function sliceChunkAtBoundary(text, max) {
    if (text.length <= max) return text;
    const candidate = text.slice(0, max);
    // Buscar último delimitador natural
    const match = candidate.match(/[\s,.!?¡¿;:\)\]\"'»”\n](?![\s\S]*[\s,.!?¡¿;:\)\]\"'»”\n])/);
    if (match && match.index !== undefined) {
        const idx = candidate.lastIndexOf(match[0]);
        if (idx > 0) return candidate.slice(0, idx + 1);
    }
    // Si no hay delimitador, evitar cortar surrogate
    const last = candidate.charCodeAt(candidate.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
        return candidate.slice(0, -1);
    }
    return candidate;
}

// Exponer un flush explícito para el final del streaming
export function flushPendingLinux() {
    if (sessionType !== 'wayland') return;
    const execOptions = buildExecOptions();
    if (waylandFlushTimer) {
        clearTimeout(waylandFlushTimer);
        waylandFlushTimer = null;
    }
    flushWaylandBuffer(execOptions);
}

/**
 * Try multiple robust strategies to type text on Wayland
 */
function tryWaylandTypeMulti(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempDir = tmpdir();
        const tempFile = join(tempDir, `select2llm_wl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.txt`);
        const origClipFile = join(tempDir, `select2llm_wl_orig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.txt`);
        const pasteTmpFile = join(tempDir, `select2llm_wl_paste_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.txt`);
        try {
            writeFileSync(tempFile, text, { encoding: 'utf8' });
        } catch (e) {
            return reject(new Error(`Failed creating temp file: ${e.message}`));
        }

        const cmds = [];
        const hasYdo = checkCommandAvailable('ydotool');
        const hasWtype = checkCommandAvailable('wtype');
        const hasWlCopy = checkCommandAvailable('wl-copy');
        const hasWlPaste = checkCommandAvailable('wl-paste');
        const hasNonASCII = /[^\x00-\x7F]/.test(text);

        // Asegurar ydotoold corriendo si está disponible
        try {
            if (hasYdo && !checkYdotoolDaemon()) {
                execSync('pgrep ydotoold >/dev/null 2>&1 || nohup ydotoold >/dev/null 2>&1 &');
            }
        } catch {}

        // 1) Para UTF-8: pegar desde portapapeles usando teclas (shift+Insert / ctrl+v)
        if (hasNonASCII && hasWlCopy && hasYdo) {
            cmds.push(
                `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 ` +
                `wl-paste --no-newline > '${origClipFile}' 2>/dev/null || true; ` +
                `wl-copy --type 'text/plain;charset=utf-8' < '${tempFile}'; ` +
                `sleep ${WAYLAND_PASTE_DELAY_S}; ` +
                `ydotool key shift+Insert; ` +
                `sleep ${WAYLAND_POST_PASTE_DELAY_S}; ` +
                `wl-copy < '${origClipFile}' 2>/dev/null || wl-copy --clear; rm -f '${origClipFile}'`
            );
            cmds.push(
                `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 ` +
                `wl-paste --no-newline > '${origClipFile}' 2>/dev/null || true; ` +
                `wl-copy --type 'text/plain;charset=utf-8' < '${tempFile}'; ` +
                `sleep ${WAYLAND_PASTE_DELAY_S}; ` +
                `ydotool key ctrl+v; ` +
                `sleep ${WAYLAND_POST_PASTE_DELAY_S}; ` +
                `wl-copy < '${origClipFile}' 2>/dev/null || wl-copy --clear; rm -f '${origClipFile}'`
            );
        }

        // 2) Directo: ydotool desde archivo (solo ASCII)
        if (!hasNonASCII && hasYdo) {
            cmds.push(`LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 ydotool type --file '${tempFile}'`);
        }

        // 3) Clipboard → ydotool con restauración (para ASCII o si teclas fallan)
        if (hasWlCopy && hasWlPaste && hasYdo) {
            if (!hasNonASCII) {
                cmds.push(
                    `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 ` +
                    `wl-paste --no-newline > '${origClipFile}' 2>/dev/null || true; ` +
                    `wl-copy --type 'text/plain;charset=utf-8' < '${tempFile}'; ` +
                    `sleep ${WAYLAND_PASTE_DELAY_S}; ` +
                    `wl-paste --type text --no-newline > '${pasteTmpFile}'; ydotool type --file '${pasteTmpFile}'; rm -f '${pasteTmpFile}'; ` +
                    `sleep ${WAYLAND_POST_PASTE_DELAY_S}; ` +
                    `wl-copy < '${origClipFile}' 2>/dev/null || wl-copy --clear; rm -f '${origClipFile}'`
                );
            }
        }

        // 3) Clipboard → wtype con restauración (fallback)
        if (hasWlCopy && hasWlPaste && hasWtype) {
            cmds.push(
                `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 ` +
                `wl-paste --no-newline > '${origClipFile}' 2>/dev/null || true; ` +
                `wl-copy --type 'text/plain;charset=utf-8' < '${tempFile}'; ` +
                `sleep ${WAYLAND_PASTE_DELAY_S}; ` +
                `wl-paste --type text --no-newline | wtype -; ` +
                `sleep ${WAYLAND_POST_PASTE_DELAY_S}; ` +
                `wl-copy < '${origClipFile}' 2>/dev/null || wl-copy --clear; rm -f '${origClipFile}'`
            );
        }

        // 4) Directo: wtype desde archivo/stdin (último)
        if (hasWtype) {
            cmds.push(`LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 cat '${tempFile}' | wtype -`);
        }
        // 5) Último recurso: copiar solo al portapapeles (sin pegar automático)
        // 6) Copiar sólo al portapapeles (con tipo UTF-8)
        if (hasWlCopy) {
            cmds.push(`LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 wl-copy --type 'text/plain;charset=utf-8' < '${tempFile}'`);
        }

        let idx = 0;
        const tryNext = () => {
            if (idx >= cmds.length) {
                try { unlinkSync(tempFile); } catch {}
                return reject(new Error('All Wayland typing strategies failed'));
            }
            const cmd = cmds[idx++];
            logger.debug('Wayland strategy attempt', {
                index: idx,
                total: cmds.length,
                cmdPreview: cmd.substring(0, 140) + (cmd.length > 140 ? '...' : ''),
                payloadLength: text.length
            });
            const timedExecOptions = { ...execOptions, timeout: 6000 };
            exec(cmd, timedExecOptions, (error, stdout, stderr) => {
                if (error) {
                    const isCompositorVK = stderr && /virtual keyboard protocol/i.test(stderr);
                    logger.warn('Wayland strategy failed', { error: error.message, isCompositorVK });
                    return tryNext();
                }
                try { unlinkSync(tempFile); } catch {}
                try { unlinkSync(origClipFile); } catch {}
                try { unlinkSync(pasteTmpFile); } catch {}
                return resolve();
            });
        };
        tryNext();
    });
}

// Detecta emojis (caracteres fuera del BMP, típicos en U+1Fxxx)
function containsEmoji(text) {
    try {
        return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text);
    } catch {
        return false;
    }
}

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
    if (sessionType === 'x11') {
        // Secuencia robusta: limpiar genéricos y variantes L/R + AltGr, en ventana y global
        const cmds = [];
        if (wid) {
            cmds.push(`xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt`);
        }
        cmds.push(`xdotool keyup --clearmodifiers ctrl shift alt`);
        if (wid) {
            cmds.push(`xdotool keyup --window '${wid}' Control_L Control_R Shift_L Shift_R Alt_L Alt_R ISO_Level3_Shift Super_L Super_R`);
        }
        cmds.push(`xdotool keyup Control_L Control_R Shift_L Shift_R Alt_L Alt_R ISO_Level3_Shift Super_L Super_R`);
        const seq = cmds.map(c => `${c} 2>/dev/null || true`).join(' ; sleep 0.02; ');
        exec(seq, (error) => {
            if (error) {
                logger.debug('Error clearing stuck modifiers (X11)', { error: error.message, wid });
            } else {
                const now = Date.now();
                if (now - lastClearLogAt > CLEAR_LOG_THROTTLE_MS) {
                    lastClearLogAt = now;
                    logger.debug('Stuck modifiers cleared successfully (X11)', { wid });
                }
            }
        });
    } else if (sessionType === 'wayland') {
        // En Wayland: enviar keyup para ctrl, shift, alt con ydotool si está disponible
        try {
            if (checkCommandAvailable('ydotool')) {
                exec(`ydotool keyup ctrl shift alt`, (error) => {
                    if (error) {
                        logger.debug('Error clearing stuck modifiers (Wayland)', { error: error.message });
                    } else {
                        const now = Date.now();
                        if (now - lastClearLogAt > CLEAR_LOG_THROTTLE_MS) {
                            lastClearLogAt = now;
                            logger.debug('Stuck modifiers cleared successfully (Wayland)');
                        }
                    }
                });
            }
        } catch {}
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

/**
 * Creates a robust command to type text in Wayland with proper UTF-8 handling
 * @param {string} text - The text to type
 * @returns {string} The command to execute
 */
function createWaylandTypeCommand(text) {
    try {
        // Always use the most robust UTF-8 approach
        return createDirectTypeCommand(text);
        
    } catch (error) {
        logger.warn('Error creating Wayland type command, falling back to basic ydotool', { 
            error: error.message, 
            text: text.substring(0, 50) + (text.length > 50 ? '...' : '') 
        });
        
        // Final fallback: basic ydotool with UTF-8 locale and simple escaping
        if (checkCommandAvailable('ydotool')) {
            const safeLine = text.replace(/'/g, "'\\''");
            return `LC_ALL=C.UTF-8 LANG=C.UTF-8 ydotool type '${safeLine}'`;
        } else {
            throw new Error('No compatible Wayland text input method available (ydotool required)');
        }
    }
}

/**
 * Checks if text contains complex UTF-8 characters or bash-problematic characters
 * @param {string} text - The text to check
 * @returns {boolean} True if text contains complex characters that need special handling
 */
function hasComplexUTF8(text) {
    // Check for any non-ASCII characters (outside 0-127 range)
    if (/[^\x00-\x7F]/.test(text)) {
        return true;
    }
    
    // Check for bash-problematic characters that are dangerous even in single quotes
    // or that could break our command structure
    const bashProblematicChars = /[`$\\"|'{}[\]();&<>*?~^]/.test(text);
    if (bashProblematicChars) {
        return true;
    }
    
    // Check for control characters (including tabs, newlines, carriage returns)
    if (/[\x00-\x1F\x7F]/.test(text)) {
        return true;
    }
    
    // Check for characters that might cause issues in command line contexts
    if (text.includes('\n') || text.includes('\r') || text.includes('\t')) {
        return true;
    }
    
    return false;
}

/**
 * Checks if text should use file-based approach for better UTF-8 handling
 * Always returns true to ensure robust UTF-8 support for all characters
 * @param {string} text - The text to check
 * @returns {boolean} Always true to use the most robust method
 */
function shouldUseFileBasedApproach(text) {
    // Always use file-based approach for maximum UTF-8 compatibility
    // This ensures proper handling of all Unicode characters including:
    // - Emojis, acentos, caracteres especiales
    // - Cualquier carácter UTF-8 válido
    return text.length > 0;
}

/**
 * Creates a file-based type command with enhanced UTF-8 handling using multiple strategies
 * @param {string} text - The text to type
 * @returns {string} The command to execute
 */
function createFileBasedTypeCommand(text) {
    const tempDir = tmpdir();
    const tempFile = join(tempDir, `select2llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.txt`);
    
    try {
        // Write text to temporary file with explicit UTF-8 encoding and no BOM
        writeFileSync(tempFile, text, { encoding: 'utf8' });
        
        // Strategy 1: Try with wtype if available (better UTF-8 support for some compositors)
        if (checkCommandAvailable('wtype')) {
            logger.debug('Using wtype with stdin input for UTF-8 text');
            return `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | wtype - && rm -f '${tempFile}'`;
        }
        
        // Strategy 2: Use ydotool with --file option
        if (checkCommandAvailable('ydotool')) {
            logger.debug('Using ydotool with file input for UTF-8 text');
            return `LC_ALL=C.UTF-8 LANG=C.UTF-8 ydotool type --file '${tempFile}' && rm -f '${tempFile}'`;
        }
        
        throw new Error('Neither wtype nor ydotool available for file-based text input');
        
    } catch (error) {
        logger.error('Failed to create temporary file for UTF-8 text', { error: error.message });
        // Clean up on error
        try {
            unlinkSync(tempFile);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Creates a robust type command with UTF-8 support using multiple strategies
 * @param {string} text - The text to type
 * @returns {string} The command to execute
 */
function createDirectTypeCommand(text) {
    // Check available tools
    const ydotoolAvailable = checkCommandAvailable('ydotool');
    const wtypeAvailable = checkCommandAvailable('wtype');
    const ydotoolDaemonRunning = ydotoolAvailable && checkYdotoolDaemon();

    if (!ydotoolAvailable && !wtypeAvailable) {
        throw new Error('Neither wtype nor ydotool available for Wayland text input');
    }

    if (ydotoolAvailable && !ydotoolDaemonRunning) {
        logger.warn('ydotool is available but daemon ydotoold is not running. This may cause issues with UTF-8 text input.');
    }

    // Strategy 1: File-based approach for UTF-8 (más robusto)
    try {
        if (shouldUseFileBasedApproach(text)) {
            logger.debug('Using file-based approach for robust UTF-8 support');
            return createFileBasedTypeCommand(text);
        }
    } catch (error) {
        logger.warn('File-based approach failed, trying stdin-based wtype', { error: error.message });
    }

    // Strategy 2: wtype con stdin (evita problemas de escape)
    if (wtypeAvailable) {
        logger.debug('Using wtype with stdin for UTF-8');
        const escapedText = text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
        return `LC_ALL=C.UTF-8 LANG=C.UTF-8 printf '%s' "${escapedText}" | wtype -`;
    }

    // Strategy 3: ydotool con archivo (si wtype no está disponible)
    if (ydotoolAvailable) {
        logger.debug('Using ydotool with file as fallback');
        return createFileBasedTypeCommand(text);
    }

    // Strategy 4: Clipboard (último recurso)
    logger.debug('Falling back to clipboard-based method');
    return createClipboardBasedCommand(text);
}

/**
 * Checks if a command is available in the system
 * @param {string} command - The command name to check
 * @returns {boolean} True if command is available
 */
function checkCommandAvailable(command) {
    try {
        execSync(`which ${command}`, { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Checks if ydotool daemon is running
 * @returns {boolean} True if ydotoold is running
 */
function checkYdotoolDaemon() {
    try {
        execSync('pgrep ydotoold', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}



/**
 * Creates a clipboard-based command for complex UTF-8 content as fallback
 * @param {string} text - The text to type
 * @returns {string} The command to execute
 */
function createClipboardBasedCommand(text) {
    // Escape single quotes for shell
    const escapedText = text.replace(/'/g, "'\\''");
    
    if (checkCommandAvailable('wl-copy') && checkCommandAvailable('wl-paste')) {
        // Wayland clipboard method - avoid ctrl+v completely
        // Use wl-paste with command substitution to avoid "v" issue
        if (checkCommandAvailable('wtype')) {
            // Prefer wtype if available - better for piped input
            return `echo '${escapedText}' | wl-copy && sleep 0.1 && wl-paste | wtype - && sleep 0.05 && wl-copy --clear`;
        } else {
            // Use a temp approach with ydotool - create command with content from clipboard
            return `echo '${escapedText}' | wl-copy && sleep 0.1 && ydotool type "$(wl-paste)" && sleep 0.05 && wl-copy --clear`;
        }
    } else if (checkCommandAvailable('xclip')) {
        // X11 clipboard method (fallback) - also avoid ctrl+v
        if (checkCommandAvailable('wtype')) {
            return `echo '${escapedText}' | xclip -selection clipboard && sleep 0.1 && xclip -o -selection clipboard | wtype -`;
        } else {
            return `echo '${escapedText}' | xclip -selection clipboard && sleep 0.1 && ydotool type "$(xclip -o -selection clipboard)"`;
        }
    }
    
    throw new Error('No clipboard utility available for UTF-8 text input');
}



/**
 * Emergency method when compositor doesn't support virtual keyboard protocol
 * Saves text to a temporary file and provides user instructions
 * @param {string} text - Text to save
 * @param {Object} execOptions - Execution options
 * @param {Function} resolve - Promise resolve callback
 * @param {Function} reject - Promise reject callback
 */
function tryEmergencyFileMethod(text, execOptions, resolve, reject) {
    try {
        const tempDir = tmpdir();
        const tempFile = join(tempDir, `select2llm_emergency_${Date.now()}.txt`);
        
        // Write text to temporary file
        writeFileSync(tempFile, text, { encoding: 'utf8' });
        
        logger.warn('Emergency file method activated - compositor incompatible', {
            tempFile,
            textLength: text.length,
            instruction: 'Text saved to file. User needs to manually copy.'
        });
        
        // Try to copy file path to clipboard so user can access it
        const copyPathCmd = `echo '${tempFile}' | wl-copy`;
        exec(copyPathCmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                logger.error('Could not copy file path to clipboard', { 
                    error: error.message,
                    tempFile 
                });
            } else {
                logger.info('Emergency file created and path copied to clipboard', { 
                    tempFile,
                    instruction: 'Paste clipboard to get file path, then open file to copy text manually'
                });
            }
            
            // Show notification (if possible)
            const notifyCmd = `notify-send "Select2LLM" "Text saved to file. Path copied to clipboard. Paste to get location." 2>/dev/null || echo "Notification not available"`;
            exec(notifyCmd, execOptions, () => {
                // Don't wait for notification, just resolve
                resolve();
            });
        });
        
    } catch (fileError) {
        logger.error('Emergency file method failed', { 
            error: fileError.message 
        });
        reject(new Error(`Emergency file method failed: ${fileError.message}`));
    }
}

/**
 * Ultra-robust text input strategy that adapts to any Linux desktop environment
 * Supports: GNOME, KDE, XFCE, i3, Sway, Hyprland, and any Wayland/X11 setup
 */
function tryRobustTextInput(text, execOptions, resolve, reject) {
    // Detect environment capabilities first
    const capabilities = detectEnvironmentCapabilities();
    
    // Build adaptive strategy list based on environment
    const strategies = buildAdaptiveStrategies(text, capabilities, execOptions);
    
    let currentStrategy = 0;
    let lastError = null;

    function tryNextStrategy() {
        if (currentStrategy >= strategies.length) {
            logger.error('All text input strategies exhausted', {
                totalStrategies: strategies.length,
                environment: capabilities,
                lastError: lastError?.message,
                textLength: text.length
            });
            reject(new Error(`All ${strategies.length} text input methods failed. Last error: ${lastError?.message}`));
            return;
        }

        const strategy = strategies[currentStrategy];
        logger.info(`Attempting strategy ${currentStrategy + 1}/${strategies.length}: ${strategy.description}`, {
            strategyName: strategy.name,
            environment: sessionType,
            textLength: text.length,
            hasComplexChars: /[^\x00-\x7F]/.test(text)
        });

        strategy.method()
            .then(() => {
                logger.info(`✅ SUCCESS with strategy: ${strategy.description}`, {
                    strategyName: strategy.name,
                    strategyIndex: currentStrategy + 1,
                    environment: sessionType,
                    textLength: text.length
                });
                clearStuckModifiers();
                resolve();
            })
            .catch((error) => {
                lastError = error;
                logger.warn(`❌ Strategy "${strategy.description}" failed`, {
                    strategyName: strategy.name,
                    error: error.message,
                    strategyIndex: currentStrategy + 1,
                    remaining: strategies.length - currentStrategy - 1
                });
                
                currentStrategy++;
                // Progressive delay: first attempts are quick, later ones have more delay
                const delay = Math.min(50 + (currentStrategy * 25), 200);
                setTimeout(tryNextStrategy, delay);
            });
    }

    logger.debug('Starting ultra-robust text input', {
        sessionType,
        capabilities,
        strategiesCount: strategies.length,
        textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : '')
    });

    tryNextStrategy();
}

/**
 * Detects what text input capabilities are available in the current environment
 */
function detectEnvironmentCapabilities() {
    const capabilities = {
        sessionType,
        desktop: process.env.XDG_CURRENT_DESKTOP || 'unknown',
        compositor: process.env.XDG_SESSION_DESKTOP || 'unknown',
        tools: {
            ydotool: checkCommandAvailable('ydotool'),
            wtype: checkCommandAvailable('wtype'),
            xdotool: checkCommandAvailable('xdotool'),
            wlCopy: checkCommandAvailable('wl-copy'),
            wlPaste: checkCommandAvailable('wl-paste'),
            xclip: checkCommandAvailable('xclip'),
            xsel: checkCommandAvailable('xsel')
        },
        ydotoolDaemon: false // Will be checked dynamically
    };

    // Check ydotool daemon if ydotool is available
    if (capabilities.tools.ydotool) {
        try {
            execSync('ydotool type ""', { encoding: 'utf8', timeout: 1000, stdio: 'pipe' });
            capabilities.ydotoolDaemon = true;
        } catch (error) {
            capabilities.ydotoolDaemon = false;
        }
    }

    logger.debug('Environment capabilities detected', capabilities);
    return capabilities;
}

/**
 * Builds an adaptive list of strategies based on environment capabilities and text characteristics
 */
function buildAdaptiveStrategies(text, capabilities, execOptions) {
    const strategies = [];
    const isComplexText = /[^\x00-\x7F]/.test(text);
    const isLargeText = text.length > 200;
    
    // WAYLAND STRATEGIES
    if (capabilities.sessionType === 'wayland') {
        // Strategy 1: wtype (most reliable for Wayland)
        if (capabilities.tools.wtype) {
            strategies.push({
                name: 'wayland_wtype_direct',
                description: 'Wayland wtype direct input',
                method: () => tryWtypeDirect(text, execOptions)
            });
            
            // For complex text, also try wtype with temp file
            if (isComplexText) {
                strategies.push({
                    name: 'wayland_wtype_file',
                    description: 'Wayland wtype with temp file',
                    method: () => tryWtypeFile(text, execOptions)
                });
            }
        }

        // Strategy 2: ydotool (if daemon is running)
        if (capabilities.tools.ydotool && capabilities.ydotoolDaemon) {
            strategies.push({
                name: 'wayland_ydotool_direct',
                description: 'Wayland ydotool direct',
                method: () => tryYdotoolDirect(text, execOptions)
            });
            
            if (isComplexText) {
                strategies.push({
                    name: 'wayland_ydotool_file',
                    description: 'Wayland ydotool with temp file',
                    method: () => tryYdotoolFile(text, execOptions)
                });
            }
        }

        // Strategy 3: Clipboard methods
        if (capabilities.tools.wlCopy) {
            strategies.push({
                name: 'wayland_clipboard',
                description: 'Wayland clipboard copy',
                method: () => tryWaylandClipboard(text, execOptions)
            });
        }

        // Strategy 4: X11 compatibility tools (some work on Wayland)
        if (capabilities.tools.xdotool) {
            strategies.push({
                name: 'wayland_xdotool_compat',
                description: 'X11 tools on Wayland (compatibility)',
                method: () => tryXdotoolCompat(text, execOptions)
            });
        }
    }
    
    // X11 STRATEGIES
    else if (capabilities.sessionType === 'x11') {
        // Strategy 1: xdotool (most reliable for X11)
        if (capabilities.tools.xdotool) {
            strategies.push({
                name: 'x11_xdotool_direct',
                description: 'X11 xdotool direct',
                method: () => tryXdotoolDirect(text, execOptions)
            });
            
            if (isComplexText) {
                strategies.push({
                    name: 'x11_xdotool_file',
                    description: 'X11 xdotool with temp file',
                    method: () => tryXdotoolFile(text, execOptions)
                });
            }
        }

        // Strategy 2: Wayland tools (some work on X11)
        if (capabilities.tools.wtype) {
            strategies.push({
                name: 'x11_wtype_compat',
                description: 'Wayland tools on X11 (compatibility)',
                method: () => tryWtypeDirect(text, execOptions)
            });
        }

        if (capabilities.tools.ydotool) {
            strategies.push({
                name: 'x11_ydotool_compat',
                description: 'ydotool on X11 (compatibility)',
                method: () => tryYdotoolDirect(text, execOptions)
            });
        }

        // Strategy 3: X11 clipboard
        if (capabilities.tools.xclip) {
            strategies.push({
                name: 'x11_clipboard_xclip',
                description: 'X11 clipboard with xclip',
                method: () => tryX11Clipboard(text, execOptions)
            });
        }
        
        if (capabilities.tools.xsel) {
            strategies.push({
                name: 'x11_clipboard_xsel',
                description: 'X11 clipboard with xsel',
                method: () => tryX11ClipboardXsel(text, execOptions)
            });
        }
    }

    // UNIVERSAL FALLBACK STRATEGIES (work on any system)
    
    // Line-by-line fallback (always works)
    strategies.push({
        name: 'universal_line_by_line',
        description: 'Universal line-by-line fallback',
        method: () => tryLineByLineUniversal(text, execOptions)
    });

    // Emergency clipboard notification (last resort)
    strategies.push({
        name: 'emergency_notification',
        description: 'Emergency clipboard notification',
        method: () => tryEmergencyClipboard(text, execOptions)
    });

    logger.debug(`Built ${strategies.length} adaptive strategies for environment`, {
        sessionType: capabilities.sessionType,
        desktop: capabilities.desktop,
        strategiesCount: strategies.length,
        isComplexText,
        isLargeText
    });

    return strategies;
}

//
// === WAYLAND STRATEGY IMPLEMENTATIONS ===
//

/**
 * Wayland Strategy: wtype direct input
 */
function tryWtypeDirect(text, execOptions) {
    return new Promise((resolve, reject) => {
        const escapedText = text.replace(/'/g, "'\\''");
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 wtype '${escapedText}'`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`wtype direct failed: ${error.message}`));
            } else {
                logger.debug('wtype direct succeeded');
                resolve();
            }
        });
    });
}

/**
 * Wayland Strategy: wtype with temp file
 */
function tryWtypeFile(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempFile = createTempFileWithText(text);
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | wtype -`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            cleanupTempFile(tempFile);
            if (error) {
                reject(new Error(`wtype file method failed: ${error.message}`));
            } else {
                logger.debug('wtype file method succeeded');
                resolve();
            }
        });
    });
}

/**
 * Wayland Strategy: ydotool direct
 */
function tryYdotoolDirect(text, execOptions) {
    return new Promise((resolve, reject) => {
        const escapedText = text.replace(/'/g, "'\\''");
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 ydotool type '${escapedText}'`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`ydotool direct failed: ${error.message}`));
            } else {
                logger.debug('ydotool direct succeeded');
                resolve();
            }
        });
    });
}

/**
 * Wayland Strategy: ydotool with temp file
 */
function tryYdotoolFile(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempFile = createTempFileWithText(text);
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | ydotool type --file -`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            cleanupTempFile(tempFile);
            if (error) {
                reject(new Error(`ydotool file method failed: ${error.message}`));
            } else {
                logger.debug('ydotool file method succeeded');
                resolve();
            }
        });
    });
}

/**
 * Wayland Strategy: clipboard copy
 */
function tryWaylandClipboard(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempFile = createTempFileWithText(text);
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | wl-copy`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            cleanupTempFile(tempFile);
            if (error) {
                reject(new Error(`Wayland clipboard failed: ${error.message}`));
            } else {
                logger.info('Text copied to Wayland clipboard - paste with Ctrl+V');
                resolve();
            }
        });
    });
}

//
// === X11 STRATEGY IMPLEMENTATIONS ===
//

// Construye una secuencia segura para X11 con saltos de línea y limpieza de modificadores
function buildXdotoolTypeSequenceX11(text) {
    const commands = [];
    const baseKeyup = ['xdotool', 'keyup', '--clearmodifiers'];
    if (wid) {
        baseKeyup.push('--window', String(wid));
    }
    // Keyup inicial para evitar modificadores pegados
    commands.push(escapeForBash([...baseKeyup, 'ctrl', 'shift', 'alt']));

    const lines = String(text).split('\n');
    const buildType = (line) => {
        const args = ['xdotool', 'type', '--clearmodifiers'];
        if (wid) {
            args.push('--window', String(wid));
        }
        args.push('--delay', '1', '--', line);
        return escapeForBash(args);
    };
    const buildEnter = () => {
        const keyupArgs = ['xdotool', 'keyup', '--clearmodifiers'];
        if (wid) {
            keyupArgs.push('--window', String(wid));
        }
        const keyArgs = ['xdotool', 'key', '--clearmodifiers'];
        if (wid) {
            keyArgs.push('--window', String(wid));
        }
        keyArgs.push('Return');
        const keyupCmd = escapeForBash([...keyupArgs, 'ctrl', 'shift', 'alt']);
        const keyCmd = escapeForBash(keyArgs);
        // Limpieza antes y después para garantizar que no quede ningún modificador activo durante Enter
        return [keyupCmd, keyCmd, keyupCmd].join(' && ');
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && line.length > 0) {
            commands.push(buildType(line));
        }
        if (i < lines.length - 1) {
            commands.push(buildEnter());
        }
    }

    // Keyup final para garantizar que no queden teclas pegadas
    commands.push(escapeForBash([...baseKeyup, 'ctrl', 'shift', 'alt']));

    // Exportar entorno UTF-8 explícito
    return `LC_ALL=C.UTF-8 LANG=C.UTF-8 ${commands.join(' && ')}`;
}

/**
 * X11 Strategy: xdotool direct
 */
function tryXdotoolDirect(text, execOptions) {
    return new Promise((resolve, reject) => {
        const cmd = buildXdotoolTypeSequenceX11(text);
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`xdotool direct failed: ${error.message}`));
            } else {
                logger.debug('xdotool direct succeeded');
                resolve();
            }
        });
    });
}

/**
 * X11 Strategy: xdotool with temp file
 */
function tryXdotoolFile(text, execOptions) {
    return new Promise((resolve, reject) => {
        const cmd = buildXdotoolTypeSequenceX11(text);
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`xdotool file method failed: ${error.message}`));
            } else {
                logger.debug('xdotool file method succeeded');
                resolve();
            }
        });
    });
}

/**
 * X11 Strategy: clipboard with xclip
 */
function tryX11Clipboard(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempFile = createTempFileWithText(text);
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | xclip -selection clipboard`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            cleanupTempFile(tempFile);
            if (error) {
                reject(new Error(`X11 clipboard (xclip) failed: ${error.message}`));
            } else {
                logger.info('Text copied to X11 clipboard - paste with Ctrl+V');
                resolve();
            }
        });
    });
}

/**
 * X11 Strategy: clipboard with xsel
 */
function tryX11ClipboardXsel(text, execOptions) {
    return new Promise((resolve, reject) => {
        const tempFile = createTempFileWithText(text);
        const cmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 cat '${tempFile}' | xsel --clipboard --input`;
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            cleanupTempFile(tempFile);
            if (error) {
                reject(new Error(`X11 clipboard (xsel) failed: ${error.message}`));
            } else {
                logger.info('Text copied to X11 clipboard - paste with Ctrl+V');
                resolve();
            }
        });
    });
}

//
// === COMPATIBILITY STRATEGY IMPLEMENTATIONS ===
//

/**
 * Compatibility Strategy: xdotool on Wayland (works with XWayland apps)
 */
function tryXdotoolCompat(text, execOptions) {
    return new Promise((resolve, reject) => {
        const cmd = buildXdotoolTypeSequenceX11(text);
        
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`xdotool compatibility failed: ${error.message}`));
            } else {
                logger.debug('xdotool compatibility succeeded (XWayland)');
                resolve();
            }
        });
    });
}

//
// === UNIVERSAL FALLBACK IMPLEMENTATIONS ===
//

/**
 * Universal Strategy: line-by-line fallback
 */
function tryLineByLineUniversal(text, execOptions) {
    return new Promise((resolve, reject) => {
        logger.debug('Using universal line-by-line fallback');
        sendTextLineByLine(text, resolve, reject);
    });
}

/**
 * Emergency Strategy: clipboard notification (last resort)
 */
function tryEmergencyClipboard(text, execOptions) {
    return new Promise((resolve, reject) => {
        try {
            const tempFile = createTempFileWithText(text);
            
            // Try to copy to any available clipboard
            let clipboardCmd = null;
            if (checkCommandAvailable('wl-copy')) {
                clipboardCmd = `cat '${tempFile}' | wl-copy`;
            } else if (checkCommandAvailable('xclip')) {
                clipboardCmd = `cat '${tempFile}' | xclip -selection clipboard`;
            } else if (checkCommandAvailable('xsel')) {
                clipboardCmd = `cat '${tempFile}' | xsel --clipboard --input`;
            }
            
            if (clipboardCmd) {
                exec(clipboardCmd, execOptions, (clipError) => {
                    if (!clipError) {
                        logger.info('Emergency: Text copied to clipboard - paste manually');
                        showNotification('Select2LLM', 'Text copied to clipboard. Paste with Ctrl+V');
                    } else {
                        logger.warn('Emergency: Clipboard copy failed, text saved to file', { tempFile });
                        showNotification('Select2LLM', `Text saved to file: ${tempFile}`);
                    }
                    resolve(); // Always resolve - this is the last resort
                });
            } else {
                logger.warn('Emergency: No clipboard available, text saved to file', { tempFile });
                showNotification('Select2LLM', `Text saved to file: ${tempFile}`);
                resolve();
            }
        } catch (error) {
            logger.error('Emergency method failed completely', { error: error.message });
            reject(new Error(`Emergency clipboard failed: ${error.message}`));
        }
    });
}

//
// === UTILITY FUNCTIONS ===
//

/**
 * Creates a temporary file with the given text
 */
function createTempFileWithText(text) {
    const tempDir = tmpdir();
    const tempFile = join(tempDir, `select2llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.txt`);
    writeFileSync(tempFile, text, { encoding: 'utf8' });
    return tempFile;
}

/**
 * Cleans up a temporary file
 */
function cleanupTempFile(tempFile) {
    try {
        unlinkSync(tempFile);
    } catch (error) {
        // Ignore cleanup errors
        logger.debug('Temp file cleanup failed (non-critical)', { tempFile, error: error.message });
    }
}

/**
 * Shows a desktop notification if possible
 */
function showNotification(title, message) {
    try {
        const notifyCmd = `notify-send "${title}" "${message}" 2>/dev/null || echo "Notification: ${title} - ${message}"`;
        exec(notifyCmd, () => {}); // Fire and forget
    } catch (error) {
        // Ignore notification errors
    }
}

export function sendTextLinux(text) {
    return new Promise((resolve, reject) => {
        const execOptions = buildExecOptions();

        logger.debug('Starting robust text input strategy', {
            sessionType,
            textLength: text.length,
            hasNonASCII: /[^\x00-\x7F]/.test(text),
            platform: 'linux'
        });

        // Wayland: coalesce streaming chunks to avoid UTF-8 fragmentation
        if (sessionType === 'wayland') {
            try {
                waylandBuffer += String(text);
                // Programar flush periódico para feedback visual y evitar acumulación excesiva
                scheduleWaylandFlush(execOptions);
                // Resolver cuando el próximo flush termine
                waylandPendingResolvers.push(resolve);
                return;
            } catch (e) {
                logger.warn('Wayland coalescing failed, falling back to robust strategy', { error: e.message });
            }
        }

        // X11 or fallback: use comprehensive robust strategy
        tryRobustTextInput(text, execOptions, resolve, reject);
    });
}

function sendTextLineByLine(text, resolve, reject) {
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
                // En Wayland: unir la línea con salto de línea y enviar como un bloque
                const payload = lines.length > 0 ? `${line}\n` : line;
                if (payload.length > 0) {
                    logger.debug('Preparing Wayland text command (with inline newline if needed)', {
                        payloadLength: payload.length,
                        preview: payload.substring(0, 50) + (payload.length > 50 ? '...' : '')
                    });
                    cmd = createWaylandTypeCommand(payload);
                    logger.debug('Wayland command generated', { cmd: cmd.substring(0, 100) + (cmd.length > 100 ? '...' : '') });
                }
            } else {
                return reject(new Error('Operating system not supported for text sending'));
            }

            if (cmd) {
                // Set explicit UTF-8 encoding for the execution environment with enhanced locale settings
                const execOptions = buildExecOptions();
                
                exec(cmd, execOptions, (error, stdout, stderr) => {
                    if (error) {
                        // Enhanced error logging for UTF-8 debugging
                        logger.error('Error executing Wayland text command', { 
                            error: error.message, 
                            stderr, 
                            sessionType,
                            cmdPreview: cmd.substring(0, 200) + (cmd.length > 200 ? '...' : ''),
                            textPreview: line.substring(0, 50) + (line.length > 50 ? '...' : ''),
                            textLength: line.length,
                            hasNonASCII: /[^\x00-\x7F]/.test(line),
                            exitCode: error.code
                        });
                        
                        // Check if this is a wtype compositor incompatibility error
                        const isWtypeCompositorError = stderr && stderr.includes('Compositor does not support the virtual keyboard protocol');
                        const isWtypeCommand = cmd.includes('wtype');
                        const isYdotoolDaemonError = stderr && (stderr.includes('Connection refused') || stderr.includes('ydotoold'));
                        
                        if (isWtypeCompositorError && isWtypeCommand) {
                            logger.warn('wtype failed due to compositor incompatibility, retrying with ydotool', {
                                originalError: error.message,
                                stderr
                            });
                            
                            // Retry with ydotool fallback using multiple strategies
                            const fallbackLine = line || '';
                            
                            // Try clipboard-based approach first for UTF-8 content
                            let fallbackCmd;
                            try {
                                fallbackCmd = createClipboardBasedCommand(fallbackLine);
                                logger.debug('Trying clipboard-based fallback for wtype failure');
                            } catch (clipboardError) {
                                // Fall back to direct ydotool
                                const safeLine = fallbackLine.replace(/'/g, "'\\''");
                                fallbackCmd = `LC_ALL=C.UTF-8 LANG=C.UTF-8 ydotool type '${safeLine}'`;
                                logger.debug('Trying direct ydotool fallback for wtype failure');
                            }
                            
                            exec(fallbackCmd, execOptions, (fallbackError, fallbackStdout, fallbackStderr) => {
                                if (fallbackError) {
                                    logger.error('All Wayland text input methods failed', {
                                        wtypeError: error.message,
                                        fallbackError: fallbackError.message,
                                        stderr: fallbackStderr,
                                        textHasUTF8: /[^\x00-\x7F]/.test(fallbackLine)
                                    });
                                    reject(new Error(`All Wayland text input methods failed. Original: ${error.message}, Fallback: ${fallbackError.message}`));
                                    return;
                                }
                                
                                logger.info('Successfully used fallback method after wtype failure', { 
                                    method: fallbackCmd.includes('wl-copy') ? 'clipboard' : 'direct'
                                });
                                typeLines(lines);
                            });
                            return;
                        }
                        
                        if (isYdotoolDaemonError) {
                            logger.error('ydotool daemon (ydotoold) appears to not be running', {
                                error: error.message,
                                stderr,
                                suggestion: 'Try running: ydotoold &'
                            });
                        }
                        
                        reject(new Error(`Error writing line: ${error.message}\n${stderr}`));
                        return;
                    }
                    
                    logger.debug('Wayland text command executed successfully', { 
                        stdout: stdout ? stdout.substring(0, 100) : null,
                        method: cmd.includes('wtype') ? 'wtype' : cmd.includes('wl-copy') ? 'clipboard' : 'ydotool'
                    });
                    typeLines(lines);
                });
            } else {
                typeLines(lines);
            }
        }

        typeLines(lines);
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
                const copyCmd = `xdotool key --clearmodifiers --window '${wid}' ctrl+c && xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt && xdotool keyup Control_L Control_R Shift_L Shift_R Alt_L Alt_R ISO_Level3_Shift Super_L Super_R`;
                exec(copyCmd, (error2, stdout2, stderr2) => {
                    if (error2) {
                        return reject(new Error(`Error copying to clipboard: ${error2}\n${stderr2}`));
                    }
                    logger.debug('Ctrl+C sent via X11 with modifier cleanup');
                    resolve();
                });
            });
        } else if (sessionType === 'wayland') {
            // Wayland: asegurar ydotoold, limpiar modificadores, luego Ctrl+C
            try {
                if (checkCommandAvailable('ydotool') && !checkYdotoolDaemon()) {
                    execSync('pgrep ydotoold >/dev/null 2>&1 || nohup ydotoold >/dev/null 2>&1 &');
                }
            } catch {}

            exec('ydotool keyup ctrl shift alt', (err1) => {
                if (err1) {
                    logger.debug('Error sending keyup before copy (Wayland)', { error: err1.message });
                }
                setTimeout(() => {
                    exec('ydotool key ctrl+c', (error, stdout, stderr) => {
                        if (error) {
                            return reject(new Error(`Error copying with ydotool: ${error}\n${stderr}`));
                        }
                        logger.debug('Ctrl+C sent via Wayland');
                        resolve();
                    });
                }, 30);
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
