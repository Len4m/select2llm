/**
 * Servicio de manejo de errores global para Select2LLM
 * Proporciona manejo consistente de errores, recuperación y notificaciones
 */

import { dialog, app, shell } from 'electron';
import logger from './logger.js';
import { ERROR_CODES } from '../constants/index.js';

export class ErrorService {
    constructor() {
        this.errorHandlers = new Map();
        this.setupGlobalHandlers();
        this.setupErrorCodeHandlers();
    }

    /**
     * Configura manejadores globales de errores
     */
    setupGlobalHandlers() {
        // Manejo de errores no capturados
        process.on('uncaughtException', (error) => {
            this.handleCriticalError('Uncaught Exception', error);
        });

        // Manejo de promesas rechazadas no capturadas
        process.on('unhandledRejection', (reason, promise) => {
            this.handleCriticalError('Unhandled Promise Rejection', reason);
        });

        // Manejo de advertencias
        process.on('warning', (warning) => {
            logger.warn('Process warning', {
                name: warning.name,
                message: warning.message,
                stack: warning.stack
            });
        });
    }

    /**
     * Configura manejadores específicos por código de error
     */
    setupErrorCodeHandlers() {
        // Errores de configuración
        this.errorHandlers.set(ERROR_CODES.CONFIG_NOT_FOUND, this.handleConfigNotFound.bind(this));
        this.errorHandlers.set(ERROR_CODES.CONFIG_INVALID, this.handleConfigInvalid.bind(this));
        this.errorHandlers.set(ERROR_CODES.CONFIG_SAVE_FAILED, this.handleConfigSaveFailed.bind(this));

        // Errores de plataforma
        this.errorHandlers.set(ERROR_CODES.PLATFORM_NOT_SUPPORTED, this.handlePlatformNotSupported.bind(this));
        this.errorHandlers.set(ERROR_CODES.PLATFORM_DEPENDENCIES_MISSING, this.handleDependenciesMissing.bind(this));
        this.errorHandlers.set(ERROR_CODES.WINDOW_NOT_FOUND, this.handleWindowNotFound.bind(this));

        // Errores de Ollama
        this.errorHandlers.set(ERROR_CODES.OLLAMA_NOT_AVAILABLE, this.handleOllamaNotAvailable.bind(this));
        this.errorHandlers.set(ERROR_CODES.OLLAMA_MODEL_NOT_FOUND, this.handleOllamaModelNotFound.bind(this));
        this.errorHandlers.set(ERROR_CODES.OLLAMA_REQUEST_FAILED, this.handleOllamaRequestFailed.bind(this));
        this.errorHandlers.set(ERROR_CODES.OLLAMA_TIMEOUT, this.handleOllamaTimeout.bind(this));

        // Errores de shortcuts
        this.errorHandlers.set(ERROR_CODES.SHORTCUT_INVALID, this.handleShortcutInvalid.bind(this));
        this.errorHandlers.set(ERROR_CODES.SHORTCUT_ALREADY_EXISTS, this.handleShortcutAlreadyExists.bind(this));
        this.errorHandlers.set(ERROR_CODES.SHORTCUT_REGISTRATION_FAILED, this.handleShortcutRegistrationFailed.bind(this));
    }

    /**
     * Maneja errores críticos que pueden causar el cierre de la aplicación
     */
    handleCriticalError(type, error) {
        logger.error(`Critical error: ${type}`, {
            error: error.message,
            stack: error.stack,
            type
        });

        // Mostrar diálogo de error al usuario
        this.showErrorDialog(
            'Error Crítico',
            `Se ha producido un error crítico en la aplicación:\n\n${error.message}\n\nLa aplicación se cerrará.`,
            true
        );

        // Dar tiempo para que el usuario vea el diálogo antes de cerrar
        setTimeout(() => {
            app.exit(1);
        }, 5000);
    }

    /**
     * Maneja errores con código específico
     */
    handleError(errorCode, error, context = {}) {
        const handler = this.errorHandlers.get(errorCode);
        
        if (handler) {
            return handler(error, context);
        } else {
            return this.handleGenericError(error, context);
        }
    }

    /**
     * Maneja errores genéricos
     */
    handleGenericError(error, context = {}) {
        logger.error('Generic error', {
            error: error.message,
            stack: error.stack,
            context
        });

        return {
            success: false,
            error: error.message,
            code: 'GENERIC_ERROR',
            recoverable: true
        };
    }

    /**
     * Muestra diálogo de error al usuario
     */
    async showErrorDialog(title, message, critical = false) {
        const options = {
            type: critical ? 'error' : 'warning',
            title,
            message,
            buttons: critical ? ['Cerrar'] : ['OK', 'Reportar Bug'],
            defaultId: 0
        };

        try {
            const result = await dialog.showMessageBox(options);
            
            if (!critical && result.response === 1) {
                // Usuario quiere reportar bug
                this.openBugReport();
            }
        } catch (dialogError) {
            logger.error('Failed to show error dialog', {
                error: dialogError.message,
                originalTitle: title,
                originalMessage: message
            });
        }
    }

    /**
     * Abre el navegador para reportar un bug
     */
    openBugReport() {
        shell.openExternal('https://github.com/Len4m/select2llm/issues/new');
    }

    // === MANEJADORES ESPECÍFICOS DE ERROR ===

    /**
     * Maneja errores de configuración no encontrada
     */
    handleConfigNotFound(error, context) {
        logger.warn('Configuration not found, creating default', context);
        
        return {
            success: false,
            error: 'Configuración no encontrada',
            code: ERROR_CODES.CONFIG_NOT_FOUND,
            recoverable: true,
            action: 'create_default'
        };
    }

    /**
     * Maneja errores de configuración inválida
     */
    handleConfigInvalid(error, context) {
        logger.error('Invalid configuration', { error: error.message, context });
        
        this.showErrorDialog(
            'Configuración Inválida',
            'La configuración actual no es válida. Se restaurarán los valores por defecto.'
        );

        return {
            success: false,
            error: 'Configuración inválida',
            code: ERROR_CODES.CONFIG_INVALID,
            recoverable: true,
            action: 'reset_to_default'
        };
    }

    /**
     * Maneja errores de guardado de configuración
     */
    handleConfigSaveFailed(error, context) {
        logger.error('Failed to save configuration', { error: error.message, context });
        
        this.showErrorDialog(
            'Error al Guardar',
            'No se pudo guardar la configuración. Verifica los permisos de archivo.'
        );

        return {
            success: false,
            error: 'Error al guardar configuración',
            code: ERROR_CODES.CONFIG_SAVE_FAILED,
            recoverable: true
        };
    }

    /**
     * Maneja errores de plataforma no soportada
     */
    handlePlatformNotSupported(error, context) {
        logger.error('Platform not supported', { platform: context.platform });
        
        this.showErrorDialog(
            'Plataforma No Soportada',
            `Esta plataforma (${context.platform}) no está soportada actualmente.`,
            true
        );

        return {
            success: false,
            error: 'Plataforma no soportada',
            code: ERROR_CODES.PLATFORM_NOT_SUPPORTED,
            recoverable: false
        };
    }

    /**
     * Maneja errores de dependencias faltantes
     */
    handleDependenciesMissing(error, context) {
        logger.error('Platform dependencies missing', { 
            dependencies: context.dependencies,
            platform: context.platform 
        });
        
        const depsList = context.dependencies?.join(', ') || 'desconocidas';
        
        this.showErrorDialog(
            'Dependencias Faltantes',
            `Faltan dependencias necesarias: ${depsList}\n\nConsulta la documentación para instalarlas.`
        );

        return {
            success: false,
            error: 'Dependencias faltantes',
            code: ERROR_CODES.PLATFORM_DEPENDENCIES_MISSING,
            recoverable: false
        };
    }

    /**
     * Maneja errores de ventana no encontrada
     */
    handleWindowNotFound(error, context) {
        logger.warn('Window not found', context);
        
        return {
            success: false,
            error: 'Ventana no encontrada',
            code: ERROR_CODES.WINDOW_NOT_FOUND,
            recoverable: true,
            action: 'retry'
        };
    }

    /**
     * Maneja errores de Ollama no disponible
     */
    handleOllamaNotAvailable(error, context) {
        logger.error('Ollama not available', { host: context.host });
        
        this.showErrorDialog(
            'Ollama No Disponible',
            `No se puede conectar con Ollama en ${context.host}.\n\nAsegúrate de que Ollama esté ejecutándose.`
        );

        return {
            success: false,
            error: 'Ollama no disponible',
            code: ERROR_CODES.OLLAMA_NOT_AVAILABLE,
            recoverable: true,
            action: 'check_connection'
        };
    }

    /**
     * Maneja errores de modelo de Ollama no encontrado
     */
    handleOllamaModelNotFound(error, context) {
        logger.error('Ollama model not found', { model: context.model });
        
        this.showErrorDialog(
            'Modelo No Encontrado',
            `El modelo ${context.model} no está disponible en Ollama.\n\nDescargar el modelo con: ollama pull ${context.model}`
        );

        return {
            success: false,
            error: 'Modelo no encontrado',
            code: ERROR_CODES.OLLAMA_MODEL_NOT_FOUND,
            recoverable: true
        };
    }

    /**
     * Maneja errores de petición de Ollama fallida
     */
    handleOllamaRequestFailed(error, context) {
        logger.error('Ollama request failed', { 
            error: error.message, 
            model: context.model,
            prompt: context.prompt?.substring(0, 100) + '...' 
        });

        return {
            success: false,
            error: 'Error en petición a Ollama',
            code: ERROR_CODES.OLLAMA_REQUEST_FAILED,
            recoverable: true,
            action: 'retry'
        };
    }

    /**
     * Maneja errores de timeout de Ollama
     */
    handleOllamaTimeout(error, context) {
        logger.warn('Ollama request timeout', { 
            model: context.model,
            timeout: context.timeout 
        });

        return {
            success: false,
            error: 'Timeout en petición a Ollama',
            code: ERROR_CODES.OLLAMA_TIMEOUT,
            recoverable: true,
            action: 'retry'
        };
    }

    /**
     * Maneja errores de shortcut inválido
     */
    handleShortcutInvalid(error, context) {
        logger.error('Invalid shortcut', { 
            shortcut: context.shortcut,
            error: error.message 
        });

        return {
            success: false,
            error: 'Shortcut inválido',
            code: ERROR_CODES.SHORTCUT_INVALID,
            recoverable: true
        };
    }

    /**
     * Maneja errores de shortcut ya existente
     */
    handleShortcutAlreadyExists(error, context) {
        logger.warn('Shortcut already exists', { shortcut: context.shortcut });
        
        this.showErrorDialog(
            'Shortcut Duplicado',
            `La combinación de teclas ${context.shortcut} ya está en uso.`
        );

        return {
            success: false,
            error: 'Shortcut ya existe',
            code: ERROR_CODES.SHORTCUT_ALREADY_EXISTS,
            recoverable: true
        };
    }

    /**
     * Maneja errores de registro de shortcut fallido
     */
    handleShortcutRegistrationFailed(error, context) {
        logger.error('Shortcut registration failed', { 
            shortcut: context.shortcut,
            error: error.message 
        });

        return {
            success: false,
            error: 'Error al registrar shortcut',
            code: ERROR_CODES.SHORTCUT_REGISTRATION_FAILED,
            recoverable: true,
            action: 'retry'
        };
    }

    /**
     * Crea una instancia de error con código específico
     */
    createError(code, message, context = {}) {
        const error = new Error(message);
        error.code = code;
        error.context = context;
        return error;
    }

    /**
     * Verifica si un error es recuperable
     */
    isRecoverable(error) {
        if (error.code && this.errorHandlers.has(error.code)) {
            const result = this.handleError(error.code, error);
            return result.recoverable;
        }
        return true; // Por defecto, los errores son recuperables
    }
}

// Instancia singleton del servicio de errores
const errorService = new ErrorService();

export default errorService;
