/**
 * Servicio mejorado de shortcuts para Select2LLM
 * Maneja el registro, validación y ejecución de shortcuts de forma más robusta
 */

import { globalShortcut } from 'electron';
import clipboard from 'clipboardy';
import logger from './logger.js';
import errorService from './errorService.js';
import configService from './configService.js';
import platformService from './platformService.js';
import ollamaService from './ollamaService.js';
import { SHORTCUTS_CONFIG, ERROR_CODES, CLIPBOARD_CONFIG } from '../constants/index.js';

export class ShortcutService {
    constructor() {
        this.registeredShortcuts = new Map();
        this.startCallback = null;
        this.stopCallback = null;
    }

    /**
     * Establece los callbacks para inicio y fin de procesamiento
     */
    setCallbacks(startCallback, stopCallback) {
        this.startCallback = startCallback;
        this.stopCallback = stopCallback;
    }

    /**
     * Valida la estructura de un shortcut
     */
    validateShortcut(shortcut) {
        const errors = [];

        // Validar tecla
        if (!shortcut.key || typeof shortcut.key !== 'string') {
            errors.push('Key is required and must be a string');
        } else if (!SHORTCUTS_CONFIG.VALID_KEYS.includes(shortcut.key.toLowerCase()) && 
                   !SHORTCUTS_CONFIG.VALID_KEYS.includes(shortcut.key.toUpperCase())) {
            errors.push(`Key "${shortcut.key}" is not valid`);
        }

        // Validar modificadores
        SHORTCUTS_CONFIG.MODIFIERS.forEach(modifier => {
            if (shortcut[modifier] !== undefined && typeof shortcut[modifier] !== 'boolean') {
                errors.push(`${modifier} must be a boolean`);
            }
        });

        // Validar prompt
        if (!shortcut.prompt || typeof shortcut.prompt !== 'string') {
            errors.push('Prompt is required and must be a string');
        }

        // Validar modelo
        if (!shortcut.model || typeof shortcut.model !== 'string') {
            errors.push('Model is required and must be a string');
        }

        // Validar temperatura
        if (typeof shortcut.temperature !== 'number' || 
            shortcut.temperature < 0 || shortcut.temperature > 2) {
            errors.push('Temperature must be a number between 0 and 2');
        }

        // Validar overlay
        if (typeof shortcut.overlay !== 'boolean') {
            errors.push('Overlay must be a boolean');
        }

        // Validar que al menos un modificador esté presente
        const hasModifier = SHORTCUTS_CONFIG.MODIFIERS.some(modifier => shortcut[modifier]);
        if (!hasModifier) {
            errors.push('At least one modifier key (ctrl, shift, alt) must be enabled');
        }

        return errors;
    }

    /**
     * Convierte un shortcut a string de combinación
     */
    shortcutToCombination(shortcut) {
        let combination = '';
        
        if (shortcut.ctrl) combination += 'CommandOrControl+';
        if (shortcut.shift) combination += 'Shift+';
        if (shortcut.alt) combination += 'Alt+';
        combination += shortcut.key;

        return combination;
    }

    /**
     * Verifica si un shortcut ya está registrado
     */
    isShortcutRegistered(shortcut) {
        const combination = this.shortcutToCombination(shortcut);
        return this.registeredShortcuts.has(combination);
    }

    /**
     * Registra un shortcut individual
     */
    registerSingleShortcut(shortcut) {
        const combination = this.shortcutToCombination(shortcut);
        
        try {
            // Validar shortcut
            const validationErrors = this.validateShortcut(shortcut);
            if (validationErrors.length > 0) {
                const error = errorService.createError(
                    ERROR_CODES.SHORTCUT_INVALID,
                    `Invalid shortcut: ${validationErrors.join(', ')}`,
                    { shortcut, combination }
                );
                throw error;
            }

            // Verificar si ya está registrado
            if (this.isShortcutRegistered(shortcut)) {
                const error = errorService.createError(
                    ERROR_CODES.SHORTCUT_ALREADY_EXISTS,
                    `Shortcut ${combination} already exists`,
                    { shortcut: combination }
                );
                throw error;
            }

            logger.debug('Attempting to register shortcut', { combination });

            // Crear función de callback para el shortcut
            const callback = this.createShortcutCallback(combination, shortcut);
            
            // Registrar el shortcut
            const success = globalShortcut.register(combination, callback);

            if (!success) {
                const error = errorService.createError(
                    ERROR_CODES.SHORTCUT_REGISTRATION_FAILED,
                    `Failed to register shortcut: ${combination}`,
                    { shortcut: combination }
                );
                throw error;
            }

            // Guardar en el mapa de shortcuts registrados
            this.registeredShortcuts.set(combination, shortcut);
            
            logger.shortcutTriggered(combination, shortcut.model);
            return true;

        } catch (error) {
            logger.error('Failed to register shortcut', {
                combination,
                error: error.message,
                shortcut
            });
            
            errorService.handleError(error.code || ERROR_CODES.SHORTCUT_REGISTRATION_FAILED, error);
            return false;
        }
    }

    /**
     * Crea el callback para un shortcut
     */
    createShortcutCallback(combination, shortcut) {
        return async () => {
            logger.info('Shortcut triggered', { combination });
            
            try {
                // Verificar si ya hay un procesamiento en curso
                if (ollamaService.isCurrentlyProcessing()) {
                    logger.warn('Already processing, ignoring shortcut', { combination });
                    return;
                }

                await this.executeShortcut(shortcut);

            } catch (error) {
                logger.error('Error executing shortcut', {
                    combination,
                    error: error.message,
                    stack: error.stack
                });
                
                errorService.handleError(
                    ERROR_CODES.SHORTCUT_INVALID,
                    error,
                    { shortcut: combination }
                );
            }
        };
    }

    /**
     * Ejecuta un shortcut
     */
    async executeShortcut(shortcut) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        try {
            // Delay inicial
            await delay(SHORTCUTS_CONFIG.DELAYS.BEFORE_COPY);
            
            // Enviar comando de copia
            await platformService.sendCopyCommand();
            await delay(SHORTCUTS_CONFIG.DELAYS.AFTER_COPY);
            
            // Obtener texto del portapapeles
            const selectedText = await this.getSelectedText();
            await delay(SHORTCUTS_CONFIG.DELAYS.BEFORE_PROCESS);
            
            // Validar que hay texto seleccionado
            if (!selectedText || selectedText.trim().length === 0) {
                logger.warn('No text selected', { shortcut: shortcut.key });
                return;
            }

            // Callback de inicio si está definido
            if (this.startCallback) {
                await this.startCallback(shortcut.overlay);
            }
            
            // Formar el mensaje a partir del prompt
            const message = this.buildPromptMessage(shortcut.prompt, selectedText);
            
            logger.info('Executing shortcut', {
                model: shortcut.model,
                promptLength: message.length,
                temperature: shortcut.temperature,
                overlay: shortcut.overlay
            });
            
            // Llamar a Ollama para procesar el mensaje
            await ollamaService.generateText(message, shortcut.model, shortcut.temperature);
            
        } catch (error) {
            logger.error('Error executing shortcut', {
                error: error.message,
                shortcut: shortcut.key
            });
            throw error;
            
        } finally {
            // Limpiar modificadores pegados antes del callback de fin
            platformService.clearStuckModifiers();
            
            // Callback de fin si está definido
            if (this.stopCallback) {
                await this.stopCallback(shortcut.overlay);
            }
        }
    }

    /**
     * Construye el mensaje del prompt
     */
    buildPromptMessage(prompt, selectedText) {
        if (prompt.includes('%s')) {
            return prompt.replace('%s', selectedText);
        } else {
            return `${prompt} ${selectedText}`;
        }
    }

    /**
     * Obtiene el texto seleccionado del portapapeles
     */
    async getSelectedText() {
        try {
            logger.debug('Reading clipboard content');
            
            const clipboardContent = await clipboard.read();
            
            // Validar tamaño del contenido
            if (clipboardContent.length > CLIPBOARD_CONFIG.MAX_SIZE) {
                logger.warn('Clipboard content too large', { 
                    size: clipboardContent.length,
                    maxSize: CLIPBOARD_CONFIG.MAX_SIZE
                });
                return clipboardContent.substring(0, CLIPBOARD_CONFIG.MAX_SIZE);
            }
            
            const result = clipboardContent.trim();
            logger.debug('Clipboard content read', { 
                length: result.length,
                preview: result.substring(0, 100) + (result.length > 100 ? '...' : '')
            });
            
            return result;
            
        } catch (error) {
            logger.error('Failed to read clipboard', { error: error.message });
            throw new Error('Failed to read clipboard content');
        }
    }

    /**
     * Registra todos los shortcuts desde la configuración
     */
    async registerShortcuts() {
        try {
            // Desregistrar shortcuts previos
            this.unregisterAll();
            
            // Obtener shortcuts de la configuración
            const shortcuts = configService.getShortcuts();
            
            if (!Array.isArray(shortcuts) || shortcuts.length === 0) {
                logger.info('No shortcuts to register');
                return { registered: 0, failed: 0 };
            }

            let registered = 0;
            let failed = 0;

            // Registrar cada shortcut
            for (const shortcut of shortcuts) {
                const success = this.registerSingleShortcut(shortcut);
                if (success) {
                    registered++;
                } else {
                    failed++;
                }
            }

            logger.info('Shortcuts registration completed', { 
                total: shortcuts.length,
                registered,
                failed
            });

            return { registered, failed };

        } catch (error) {
            logger.error('Failed to register shortcuts', { error: error.message });
            throw error;
        }
    }

    /**
     * Desregistra todos los shortcuts
     */
    unregisterAll() {
        try {
            globalShortcut.unregisterAll();
            const previousCount = this.registeredShortcuts.size;
            this.registeredShortcuts.clear();
            
            logger.info('All shortcuts unregistered', { count: previousCount });
            
        } catch (error) {
            logger.error('Failed to unregister shortcuts', { error: error.message });
        }
    }

    /**
     * Obtiene la lista de shortcuts registrados
     */
    getRegisteredShortcuts() {
        return Array.from(this.registeredShortcuts.entries()).map(([combination, shortcut]) => ({
            combination,
            ...shortcut
        }));
    }

    /**
     * Obtiene estadísticas del servicio
     */
    getStats() {
        return {
            registeredCount: this.registeredShortcuts.size,
            hasCallbacks: !!(this.startCallback && this.stopCallback),
            registered: this.getRegisteredShortcuts()
        };
    }

    /**
     * Reinicia el servicio
     */
    reset() {
        this.unregisterAll();
        this.startCallback = null;
        this.stopCallback = null;
        logger.info('Shortcut service reset');
    }
}

// Instancia singleton del servicio de shortcuts
const shortcutService = new ShortcutService();

export default shortcutService;
