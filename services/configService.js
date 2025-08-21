/**
 * Servicio centralizado de configuración para Select2LLM
 * Maneja la carga, validación, guardado y sincronización de configuraciones
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import logger from './logger.js';
import { UI_CONFIG } from '../constants/index.js';

export class ConfigService {
    constructor() {
        this.userConfigDir = path.join(os.homedir(), '.select2llm');
        this.configFilePath = path.join(this.userConfigDir, 'config.json');
        this.shortcutsFilePath = path.join(this.userConfigDir, 'shortcuts.json');
        
        this.defaultConfig = this.getDefaultConfig();
        this.currentConfig = null;
        this.shortcuts = [];
        this.languageChangeCallback = null;

        this.ensureConfigDir();
        this.loadConfiguration();
    }

    /**
     * Configuración por defecto del sistema
     */
    getDefaultConfig() {
        const locale = (process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
        
        return {
            language: this.detectDefaultLanguage(locale),
            temperature: 0.8,
            'keep-alive': 5,
            host: 'http://127.0.0.1:11434',
            logLevel: 'INFO',
            autoStart: false,
            windowSettings: {
                width: 660,
                height: 475,
                x: undefined,
                y: undefined,
                remember: true
            },
            uiZoom: UI_CONFIG.ZOOM.DEFAULT
        };
    }

    /**
     * Detecta el idioma predeterminado basado en la configuración del sistema
     */
    detectDefaultLanguage(locale) {
        if (locale.startsWith('ca')) return 'ca';
        if (locale.startsWith('es')) return 'es';
        return 'en';
    }

    /**
     * Asegura que el directorio de configuración existe
     */
    ensureConfigDir() {
        try {
            if (!fs.existsSync(this.userConfigDir)) {
                fs.mkdirSync(this.userConfigDir, { recursive: true });
                logger.info('Configuration directory created', { path: this.userConfigDir });
            }
        } catch (error) {
            logger.error('Failed to create configuration directory', { 
                path: this.userConfigDir, 
                error: error.message 
            });
            throw error;
        }
    }

    /**
     * Normaliza los tipos de datos en la configuración
     */
    normalizeConfig(config) {
        const normalized = {
            ...config,
            temperature: typeof config.temperature === 'string' ? parseFloat(config.temperature) : Number(config.temperature),
            'keep-alive': typeof config['keep-alive'] === 'string' ? parseInt(config['keep-alive']) : Number(config['keep-alive'])
        };

        // Si el host está vacío o no definido, usar el valor por defecto
        if (!normalized.host || normalized.host.trim() === '') {
            normalized.host = 'http://127.0.0.1:11434';
        } else {
            // Limpiar hosts malformados (como http:///127.0.0.1:11434)
            normalized.host = normalized.host.replace(/^(https?:)\/\/+/, '$1//');
        }

        // Normalizar uiZoom
        if (normalized.uiZoom !== undefined) {
            normalized.uiZoom = typeof normalized.uiZoom === 'string' ? parseInt(normalized.uiZoom) : Number(normalized.uiZoom);
        } else {
            normalized.uiZoom = UI_CONFIG.ZOOM.DEFAULT;
        }

        // Asegurar que windowSettings tiene la estructura completa
        if (!normalized.windowSettings) {
            normalized.windowSettings = this.defaultConfig.windowSettings;
        } else {
            normalized.windowSettings = {
                ...this.defaultConfig.windowSettings,
                ...normalized.windowSettings
            };
        }

        return normalized;
    }

    /**
     * Valida la estructura de configuración
     */
    validateConfig(config) {
        const errors = [];

        // Validar campos obligatorios
        if (!config.language || typeof config.language !== 'string') {
            errors.push('language must be a string');
        }

        const temp = Number(config.temperature);
        if (isNaN(temp) || temp < 0 || temp > 2) {
            errors.push('temperature must be a number between 0 and 2');
        }

        const keepAlive = Number(config['keep-alive']);
        if (isNaN(keepAlive) || keepAlive < 0) {
            errors.push('keep-alive must be a positive number');
        }

        if (!config.host || typeof config.host !== 'string') {
            errors.push('host must be a valid string');
        }

        // Validar URL del host
        try {
            new URL(config.host);
        } catch {
            errors.push('host must be a valid URL');
        }

        // Validar zoom de UI
        if (config.uiZoom !== undefined) {
            const zoom = Number(config.uiZoom);
            if (isNaN(zoom) || zoom < UI_CONFIG.ZOOM.MIN || zoom > UI_CONFIG.ZOOM.MAX) {
                errors.push(`uiZoom must be a number between ${UI_CONFIG.ZOOM.MIN} and ${UI_CONFIG.ZOOM.MAX}`);
            }
        }

        return errors;
    }

    /**
     * Normaliza los tipos de datos en shortcuts
     */
    normalizeShortcuts(shortcuts) {
        if (!Array.isArray(shortcuts)) {
            return shortcuts;
        }

        return shortcuts.map(shortcut => ({
            ...shortcut,
            // Convertir strings a booleans
            ctrl: typeof shortcut.ctrl === 'string' ? shortcut.ctrl === 'true' : Boolean(shortcut.ctrl),
            shift: typeof shortcut.shift === 'string' ? shortcut.shift === 'true' : Boolean(shortcut.shift),
            alt: typeof shortcut.alt === 'string' ? shortcut.alt === 'true' : Boolean(shortcut.alt),
            overlay: typeof shortcut.overlay === 'string' ? shortcut.overlay === 'true' : Boolean(shortcut.overlay),
            // Convertir strings a números
            temperature: typeof shortcut.temperature === 'string' ? parseFloat(shortcut.temperature) : Number(shortcut.temperature)
        }));
    }

    /**
     * Valida la estructura de shortcuts
     */
    validateShortcuts(shortcuts) {
        if (!Array.isArray(shortcuts)) {
            return ['shortcuts must be an array'];
        }

        const errors = [];
        shortcuts.forEach((shortcut, index) => {
            if (!shortcut.key || typeof shortcut.key !== 'string') {
                errors.push(`shortcut ${index}: key is required and must be a string`);
            }

            if (!shortcut.prompt || typeof shortcut.prompt !== 'string') {
                errors.push(`shortcut ${index}: prompt is required and must be a string`);
            }

            if (!shortcut.model || typeof shortcut.model !== 'string') {
                errors.push(`shortcut ${index}: model is required and must be a string`);
            }

            const temp = Number(shortcut.temperature);
            if (isNaN(temp) || temp < 0 || temp > 2) {
                errors.push(`shortcut ${index}: temperature must be a number between 0 and 2`);
            }

            if (typeof shortcut.overlay !== 'boolean') {
                errors.push(`shortcut ${index}: overlay must be a boolean`);
            }
        });

        return errors;
    }

    /**
     * Carga la configuración desde el archivo
     */
    loadConfiguration() {
        try {
            // Cargar configuración principal
            if (fs.existsSync(this.configFilePath)) {
                const data = fs.readFileSync(this.configFilePath, 'utf-8');
                const rawConfig = JSON.parse(data);
                
                // Normalizar tipos de datos
                const normalizedConfig = this.normalizeConfig({ ...this.defaultConfig, ...rawConfig });
                
                const validationErrors = this.validateConfig(normalizedConfig);
                if (validationErrors.length > 0) {
                    logger.warn('Configuration validation failed, using defaults', { errors: validationErrors });
                    this.currentConfig = { ...this.defaultConfig };
                } else {
                    this.currentConfig = normalizedConfig;
                    // Guardar la versión normalizada si es diferente
                    if (JSON.stringify(rawConfig) !== JSON.stringify(normalizedConfig)) {
                        logger.info('Normalizing and saving config with corrected types');
                        fs.writeFileSync(this.configFilePath, JSON.stringify(normalizedConfig, null, 2));
                    }
                }
            } else {
                this.currentConfig = { ...this.defaultConfig };
                this.saveConfig(this.currentConfig);
            }

            // Cargar shortcuts
            if (fs.existsSync(this.shortcutsFilePath)) {
                const shortcutsData = fs.readFileSync(this.shortcutsFilePath, 'utf-8');
                const rawShortcuts = JSON.parse(shortcutsData);
                
                // Normalizar tipos de datos
                const normalizedShortcuts = this.normalizeShortcuts(rawShortcuts);
                
                const shortcutErrors = this.validateShortcuts(normalizedShortcuts);
                if (shortcutErrors.length > 0) {
                    logger.warn('Shortcuts validation failed', { errors: shortcutErrors });
                    this.shortcuts = [];
                } else {
                    this.shortcuts = normalizedShortcuts;
                    // Guardar la versión normalizada solo si es diferente a la original
                    if (JSON.stringify(rawShortcuts) !== JSON.stringify(normalizedShortcuts)) {
                        logger.info('Normalizing and saving shortcuts with corrected types');
                        fs.writeFileSync(this.shortcutsFilePath, JSON.stringify(normalizedShortcuts, null, 2));
                    }
                }
            }

            logger.info('Configuration loaded successfully', { 
                configPath: this.configFilePath,
                shortcutsCount: this.shortcuts.length
            });

        } catch (error) {
            logger.error('Failed to load configuration', { error: error.message });
            this.currentConfig = { ...this.defaultConfig };
            this.shortcuts = [];
        }
    }

    /**
     * Guarda la configuración principal
     */
    saveConfig(newConfig) {
        try {
            const configToSave = { ...this.currentConfig, ...newConfig };
            
            // Normalizar tipos de datos antes de validar
            const normalizedConfig = this.normalizeConfig(configToSave);
            
            const validationErrors = this.validateConfig(normalizedConfig);
            if (validationErrors.length > 0) {
                throw new Error(`Configuration validation failed: ${validationErrors.join(', ')}`);
            }

            const previousHost = this.currentConfig.host;
            this.currentConfig = normalizedConfig;

            fs.writeFileSync(this.configFilePath, JSON.stringify(this.currentConfig, null, 2));
            
            logger.configSaved(this.currentConfig);

            // Si cambió el host, registrar el cambio (ya no reiniciamos automáticamente)
            if (previousHost !== this.currentConfig.host) {
                logger.info('Host changed, restart required', { 
                    oldHost: previousHost, 
                    newHost: this.currentConfig.host 
                });
            }

            return true;
        } catch (error) {
            logger.error('Failed to save configuration', { error: error.message });
            throw error;
        }
    }

    /**
     * Guarda los shortcuts
     */
    saveShortcuts(shortcuts) {
        try {
            // Normalizar tipos de datos antes de validar
            const normalizedShortcuts = this.normalizeShortcuts(shortcuts);
            
            const validationErrors = this.validateShortcuts(normalizedShortcuts);
            if (validationErrors.length > 0) {
                throw new Error(`Shortcuts validation failed: ${validationErrors.join(', ')}`);
            }

            this.shortcuts = normalizedShortcuts;
            fs.writeFileSync(this.shortcutsFilePath, JSON.stringify(normalizedShortcuts, null, 2));
            
            logger.info('Shortcuts saved successfully', { count: normalizedShortcuts.length });
            return true;
        } catch (error) {
            logger.error('Failed to save shortcuts', { error: error.message });
            throw error;
        }
    }

    /**
     * Obtiene toda la configuración actual
     */
    getConfig() {
        return { ...this.currentConfig };
    }

    /**
     * Obtiene un valor específico de configuración
     */
    get(key, defaultValue = null) {
        return this.currentConfig[key] !== undefined ? this.currentConfig[key] : defaultValue;
    }

    /**
     * Obtiene los shortcuts actuales
     */
    getShortcuts() {
        return [...this.shortcuts];
    }

    /**
     * Establece un valor específico de configuración
     */
    set(key, value) {
        const newConfig = { [key]: value };
        return this.saveConfig(newConfig);
    }

    /**
     * Resetea la configuración a los valores por defecto
     */
    reset() {
        try {
            this.currentConfig = { ...this.defaultConfig };
            this.shortcuts = [];
            
            fs.writeFileSync(this.configFilePath, JSON.stringify(this.currentConfig, null, 2));
            fs.writeFileSync(this.shortcutsFilePath, JSON.stringify(this.shortcuts, null, 2));
            
            logger.info('Configuration reset to defaults');
            return true;
        } catch (error) {
            logger.error('Failed to reset configuration', { error: error.message });
            throw error;
        }
    }

    /**
     * Obtiene la configuración de ventana
     */
    getWindowSettings() {
        return { ...this.currentConfig.windowSettings };
    }

    /**
     * Guarda la configuración de ventana
     */
    saveWindowSettings(windowSettings) {
        try {
            const newConfig = {
                ...this.currentConfig,
                windowSettings: {
                    ...this.currentConfig.windowSettings,
                    ...windowSettings
                }
            };

            this.currentConfig = newConfig;
            fs.writeFileSync(this.configFilePath, JSON.stringify(this.currentConfig, null, 2));
            
            logger.debug('Window settings saved', { windowSettings });
            return true;
        } catch (error) {
            logger.error('Failed to save window settings', { error: error.message });
            return false;
        }
    }

    /**
     * Actualiza solo las dimensiones de la ventana (sin posición)
     */
    updateWindowSize(width, height) {
        return this.saveWindowSettings({ width, height });
    }

    /**
     * Actualiza solo la posición de la ventana
     */
    updateWindowPosition(x, y) {
        return this.saveWindowSettings({ x, y });
    }

    /**
     * Actualiza tanto dimensiones como posición
     */
    updateWindowBounds(bounds) {
        const { width, height, x, y } = bounds;
        return this.saveWindowSettings({ width, height, x, y });
    }

    /**
     * Reinicia la aplicación
     */
    restartApplication() {
        try {
            logger.info('Application restart requested by user');
            setTimeout(() => {
                app.relaunch();
                app.exit(0);
            }, 500);
            return true;
        } catch (error) {
            logger.error('Failed to restart application', { error: error.message });
            return false;
        }
    }

    /**
     * Verifica si la configuración es válida
     */
    isValid() {
        const configErrors = this.validateConfig(this.currentConfig);
        const shortcutErrors = this.validateShortcuts(this.shortcuts);
        return configErrors.length === 0 && shortcutErrors.length === 0;
    }
}

// Instancia singleton del servicio de configuración
const configService = new ConfigService();

export default configService;
