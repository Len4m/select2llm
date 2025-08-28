import { exec, execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../services/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PowerShell script paths
const PS_SCRIPTS = {
    copy: path.join(__dirname, '../bin/copy.ps1'),
    sendText: path.join(__dirname, '../bin/sendText.ps1'),
    windowGeometry: path.join(__dirname, '../bin/windowGeometry.ps1')
};

// Configuration constants
const CONFIG = {
    TIMEOUT: 5000, // 5 seconds timeout (realistic for SendKeys operations)
    MAX_RETRIES: 2, // Reduced retries since operations are now faster
    RETRY_DELAY: 300 // 300ms delay between retries
};

// Window handle state
let currentHWnd = null;
let lastValidationTime = 0;
const HWND_VALIDATION_INTERVAL = 5000; // Validate handle every 5 seconds

/**
 * Executes PowerShell command with timeout and error handling
 */
async function executePowerShell(scriptPath, args = '', options = {}) {
    const timeout = options.timeout || CONFIG.TIMEOUT;
    const command = `powershell.exe -ExecutionPolicy Bypass -NoProfile -InputFormat Text -OutputFormat Text -File "${scriptPath}" ${args}`;
    
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`PowerShell execution timeout after ${timeout}ms`));
        }, timeout);

        exec(command, { 
            encoding: 'utf8', 
            windowsHide: true,
            env: { ...process.env, 'POWERSHELL_TELEMETRY_OPTOUT': '1' }
        }, (error, stdout, stderr) => {
            clearTimeout(timer);
            
            if (error) {
                logger.error('PowerShell execution failed', { 
                    script: path.basename(scriptPath), 
                    command, 
                    error: error.message,
                    stderr 
                });
                reject(error);
                return;
            }
            
            resolve(stdout.trim());
        });
    });
}

/**
 * Retry wrapper for async operations
 */
async function withRetry(operation, maxRetries = CONFIG.MAX_RETRIES) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            logger.warn(`Operation failed (attempt ${attempt}/${maxRetries})`, { error: error.message });
            
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
            }
        }
    }
    
    throw lastError;
}

/**
 * Validates if window handle is still valid
 */
function isHWndValid() {
    const now = Date.now();
    if (!currentHWnd || (now - lastValidationTime) > HWND_VALIDATION_INTERVAL) {
        return false;
    }
    return true;
}

// Note: Text escaping is no longer needed as we use SendInput with Unicode support

/**
 * Captures the current active window and copies selected text
 * @returns {Promise<void>}
 */
export async function sendCopyWindows() {
    try {
        logger.debug('Executing copy operation');
        
        const result = await withRetry(async () => {
            return await executePowerShell(PS_SCRIPTS.copy);
        });
        
        // Validate and store window handle
        const hwnd = result.trim();
        if (!hwnd || hwnd === '0') {
            throw new Error('Invalid window handle received');
        }
        
        currentHWnd = hwnd;
        lastValidationTime = Date.now();
        
        logger.debug('Copy operation completed', { hwnd: currentHWnd });
    } catch (error) {
        logger.error('Copy operation failed', { error: error.message });
        currentHWnd = null;
        throw error;
    }
}

/**
 * Sends text to the previously captured window using optimized Unicode input
 * @param {string} text - Text to send (raw text, supports emojis and special characters)
 * @returns {Promise<void>}
 */
export async function sendTextWindows(text) {
    // Early validation
    if (!text || typeof text !== 'string' || text.length === 0) {
        logger.debug('No text to send, skipping operation');
        return;
    }
    
    if (!currentHWnd) {
        throw new Error('No valid window handle available. Call sendCopyWindows first.');
    }
    
    try {
        logger.debug('Sending Unicode text to window', { 
            hwnd: currentHWnd, 
            textLength: text.length,
            hasEmojis: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(text)
        });
        
        // Pass text directly to PowerShell script - it will handle Unicode properly
        await withRetry(async () => {
            // Escape quotes in text for PowerShell string parameter
            const escapedText = text.replace(/"/g, '""').replace(/`/g, '``');
            const args = `-hWnd ${currentHWnd} -Texto "${escapedText}"`;
            return await executePowerShell(PS_SCRIPTS.sendText, args);
        });
        
        logger.debug('Unicode text sent successfully');
    } catch (error) {
        logger.error('Send text operation failed', { 
            error: error.message,
            hwnd: currentHWnd,
            textLength: text.length 
        });
        
        // Invalidate handle on certain errors
        if (error.message.includes('window') || error.message.includes('handle')) {
            currentHWnd = null;
        }
        
        throw error;
    }
}

/**
 * Gets the geometry of the currently tracked window
 * @returns {Promise<Object>} Window geometry object with x, y, width, height
 */
export async function getWindowsWindowGeometry() {
    if (!currentHWnd) {
        throw new Error('No valid window handle available. Call sendCopyWindows first.');
    }
    
    try {
        logger.debug('Getting window geometry', { hwnd: currentHWnd });
        
        const result = await withRetry(async () => {
            const args = `-hwnd ${currentHWnd}`;
            return await executePowerShell(PS_SCRIPTS.windowGeometry, args);
        });
        
        const geometry = JSON.parse(result);
        
        // Validate geometry data
        if (typeof geometry.x !== 'number' || typeof geometry.y !== 'number' ||
            typeof geometry.width !== 'number' || typeof geometry.height !== 'number') {
            throw new Error('Invalid geometry data received');
        }
        
        // Log visibility status if available
        if (typeof geometry.visible === 'boolean') {
            logger.debug('Window visibility status', { visible: geometry.visible });
        }
        
        logger.debug('Window geometry retrieved', geometry);
        return geometry;
        
    } catch (error) {
        logger.error('Get window geometry failed', { 
            error: error.message,
            hwnd: currentHWnd 
        });
        
        // Invalidate handle on certain errors
        if (error.message.includes('window') || error.message.includes('handle')) {
            currentHWnd = null;
        }
        
        throw error;
    }
}

/**
 * Gets the current window handle (for debugging purposes)
 * @returns {string|null} Current window handle
 */
export function getCurrentHWnd() {
    return currentHWnd;
}

/**
 * Manually sets window handle (for advanced usage)
 * @param {string} hwnd - Window handle to set
 */
export function setCurrentHWnd(hwnd) {
    if (hwnd && typeof hwnd === 'string' && hwnd !== '0') {
        currentHWnd = hwnd;
        lastValidationTime = Date.now();
        logger.debug('Window handle manually set', { hwnd });
    } else {
        logger.warn('Invalid window handle provided for manual setting', { hwnd });
    }
}

/**
 * Clears the current window handle
 */
export function clearCurrentHWnd() {
    currentHWnd = null;
    lastValidationTime = 0;
    logger.debug('Window handle cleared');
}
