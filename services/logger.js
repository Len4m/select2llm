/**
 * Servicio de logging estructurado para Select2LLM
 * Proporciona logging con niveles, contexto y formato consistente
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export class Logger {
    constructor() {
        this.levels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        this.currentLevel = this.levels.INFO;
        this.logDir = path.join(os.homedir(), '.select2llm', 'logs');
        this.ensureLogDir();
    }

    /**
     * Asegura que el directorio de logs existe
     */
    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Obtiene el timestamp formateado
     */
    getTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Formatea el mensaje de log
     */
    formatMessage(level, message, context = {}) {
        return {
            timestamp: this.getTimestamp(),
            level,
            message,
            context,
            pid: process.pid,
            platform: process.platform
        };
    }

    /**
     * Escribe el log tanto a consola como a archivo
     */
    writeLog(level, message, context = {}) {
        if (this.levels[level] > this.currentLevel) {
            return;
        }

        const logEntry = this.formatMessage(level, message, context);
        
        // Log a consola con color
        this.logToConsole(level, logEntry);
        
        // Log a archivo
        this.logToFile(logEntry);
    }

    /**
     * Log a consola con colores
     */
    logToConsole(level, logEntry) {
        const colors = {
            ERROR: '\x1b[31m', // Rojo
            WARN: '\x1b[33m',  // Amarillo
            INFO: '\x1b[36m',  // Cian
            DEBUG: '\x1b[37m'  // Blanco
        };
        
        const reset = '\x1b[0m';
        const color = colors[level] || colors.INFO;
        
        console.log(`${color}[${logEntry.timestamp}] ${level}: ${logEntry.message}${reset}`);
        
        if (Object.keys(logEntry.context).length > 0) {
            console.log(`${color}Context:${reset}`, logEntry.context);
        }
    }

    /**
     * Log a archivo
     */
    logToFile(logEntry) {
        try {
            const logFile = path.join(this.logDir, `select2llm-${new Date().toISOString().split('T')[0]}.log`);
            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(logFile, logLine);
        } catch (error) {
            console.error('Error escribiendo al archivo de log:', error);
        }
    }

    /**
     * Establece el nivel de logging
     */
    setLevel(level) {
        if (this.levels[level] !== undefined) {
            this.currentLevel = this.levels[level];
        }
    }

    /**
     * Métodos de logging por nivel
     */
    error(message, context = {}) {
        this.writeLog('ERROR', message, context);
    }

    warn(message, context = {}) {
        this.writeLog('WARN', message, context);
    }

    info(message, context = {}) {
        this.writeLog('INFO', message, context);
    }

    debug(message, context = {}) {
        this.writeLog('DEBUG', message, context);
    }

    /**
     * Log de eventos específicos de la aplicación
     */
    shortcutTriggered(combination, model) {
        this.info('Shortcut triggered', { combination, model });
    }

    ollamaRequest(model, prompt) {
        this.info('Ollama request started', { 
            model, 
            promptLength: prompt.length,
            promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '')
        });
    }

    ollamaError(error, model) {
        this.error('Ollama request failed', { error: error.message, model, stack: error.stack });
    }

    configSaved(config) {
        this.info('Configuration saved', { 
            host: config.host,
            language: config.language,
            temperature: config.temperature
        });
    }

    platformOperation(operation, platform) {
        this.debug('Platform operation', { operation, platform });
    }
}

// Instancia singleton del logger
const logger = new Logger();

// En modo desarrollo, usar nivel DEBUG
if (process.env.NODE_ENV === 'development') {
    logger.setLevel('DEBUG');
}

export default logger;
