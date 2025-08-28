/**
 * Servicio mejorado de Ollama para Select2LLM
 * Maneja todas las interacciones con Ollama de forma más robusta y mantenible
 */

import { Ollama } from 'ollama';
import http from 'http';
import logger from './logger.js';
import errorService from './errorService.js';
import configService from './configService.js';
import platformService from './platformService.js';
import { OLLAMA_CONFIG, ERROR_CODES, TEXT_STREAMING_CONFIG } from '../constants/index.js';

/**
 * Manager para controlar el flujo de streaming de texto de manera inteligente
 */
class TextStreamManager {
    constructor(options = {}) {
        // Usar configuración de constantes como base
        const baseConfig = TEXT_STREAMING_CONFIG.DEFAULT;
        
        this.minChunkSize = options.minChunkSize || baseConfig.MIN_CHUNK_SIZE;
        this.maxWaitTime = options.maxWaitTime || baseConfig.MAX_WAIT_TIME;
        
        this.lastSendTime = Date.now();
        this.totalCharsSent = 0;
        
        logger.debug('TextStreamManager initialized', {
            minChunkSize: this.minChunkSize,
            maxWaitTime: this.maxWaitTime
        });
    }

    /**
     * Determina si un chunk de texto debe ser enviado ahora - VERSIÓN ROBUSTA ANTI-CORRUPCIÓN
     * @param {string} content - Contenido a evaluar
     * @param {boolean} isLast - Si es el último chunk del stream
     * @returns {boolean} - Si debe enviar el contenido
     */
    shouldSendChunk(content, isLast = false) {
        if (!content || content.length === 0) {
            return false;
        }

        // Siempre enviar el último chunk
        if (isLast) {
            return true;
        }

        const timeSinceLastSend = Date.now() - this.lastSendTime;
        
        // ESTRATEGIA ANTI-CORRUPCIÓN:
        
        // 1. NUNCA enviar chunks muy pequeños (causan corrupción)
        if (content.length < 8) {
            return false;
        }
        
        // 2. VERIFICAR que no cortemos caracteres UTF-8 
        if (this.hasIncompleteUTF8(content)) {
            return false;
        }
        
        // 3. BUSCAR puntos de ruptura SEGUROS (espacios después de palabras completas)
        if (content.length >= this.minChunkSize && /[a-zA-ZáéíóúàèìòùäëïöüâêîôûçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÇÑ]\s+$/.test(content)) {
            return true;
        }
        
        // 4. BUSCAR puntuación natural SEGURA
        if (content.length >= this.minChunkSize && /[.!?¡¿]\s*$/.test(content)) {
            return true;
        }
        
        // 5. Si lleva esperando demasiado tiempo: ENVIAR (pero con verificación de seguridad)
        if (timeSinceLastSend >= this.maxWaitTime) {
            // Solo si termina en un punto seguro o es muy largo
            if (/\s$/.test(content) || content.length >= this.minChunkSize * 2) {
                return true;
            }
        }
        
        // 6. TIMEOUT ABSOLUTO: Si llevamos demasiado tiempo, enviar
        if (timeSinceLastSend >= this.maxWaitTime * 3) {
            return true;
        }

        return false;
    }

    /**
     * Verifica si el texto tiene caracteres UTF-8 incompletos al final
     * @param {string} content - Contenido a verificar
     * @returns {boolean} - True si hay caracteres incompletos
     */
    hasIncompleteUTF8(content) {
        if (!content || content.length === 0) return false;
        
        // Verificar si termina en medio de una palabra con acento
        if (/[áéíóúàèìòùäëïöüâêîôûçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÇÑ]$/.test(content) && !/\s/.test(content.slice(-2))) {
            return true;
        }
        
        // Verificar secuencias de bytes UTF-8 incompletas
        const lastChar = content.charAt(content.length - 1);
        const lastCharCode = lastChar.charCodeAt(0);
        
        // Verificar surrogates UTF-16 (caracteres multi-byte incompletos)
        if (lastCharCode >= 0xD800 && lastCharCode <= 0xDFFF) {
            return true;
        }
        
        return false;
    }

    /**
     * Verifica si el texto contiene caracteres acentuados incompletos
     * @param {string} content - Contenido a verificar
     * @returns {boolean} - True si hay caracteres incompletos
     */
    hasIncompleteAccentedChars(content) {
        // No enviar si termina con una letra acentuada seguida de caracteres especiales
        // Esto evita cortar en medio de palabras como "acompañ" + "ado"
        return /[áéíóúàèìòùäëïöüâêîôûçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÇÑ](?:[^a-zA-ZáéíóúàèìòùäëïöüâêîôûçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÇÑ\s]|$)/.test(content);
    }

    /**
     * Registra que se ha enviado un chunk
     * @param {number} charsCount - Número de caracteres enviados
     */
    onChunkSent(charsCount) {
        this.lastSendTime = Date.now();
        this.totalCharsSent += charsCount;
    }

    /**
     * Obtiene estadísticas del stream
     * @returns {Object} Estadísticas
     */
    getStats() {
        return {
            totalCharsSent: this.totalCharsSent,
            lastSendTime: this.lastSendTime
        };
    }
}

export class OllamaService {
    constructor() {
        this.client = null;
        this.abortController = null;
        this.isProcessing = false;
        this.initializeClient();
    }

    /**
     * Inicializa el cliente de Ollama
     */
    initializeClient() {
        const host = configService.get('host', OLLAMA_CONFIG.DEFAULT_HOST);
        this.client = new Ollama({ host });
        logger.info('Ollama client initialized', { host });
    }

    /**
     * Actualiza la configuración del cliente cuando cambia el host
     */
    updateClientConfig() {
        this.initializeClient();
    }

    /**
     * Verifica si Ollama está disponible
     */
    async checkAvailability() {
        const host = configService.get('host', OLLAMA_CONFIG.DEFAULT_HOST);
        
        return new Promise((resolve) => {
            logger.debug('Checking Ollama availability', { host });
            
            const timeout = setTimeout(() => {
                logger.warn('Ollama check timeout', { host });
                resolve(false);
            }, OLLAMA_CONFIG.TIMEOUTS.API_CHECK);

            const req = http.get(host, (res) => {
                clearTimeout(timeout);
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    const isAvailable = res.statusCode === 200 && data.trim() === "Ollama is running";
                    logger.info('Ollama availability check completed', { 
                        host, 
                        available: isAvailable,
                        statusCode: res.statusCode,
                        response: data.trim()
                    });
                    resolve(isAvailable);
                });
            });

            req.on('error', (error) => {
                clearTimeout(timeout);
                logger.error('Ollama availability check failed', { 
                    host, 
                    error: error.message 
                });
                resolve(false);
            });

            req.end();
        });
    }

    /**
     * Lista todos los modelos disponibles en Ollama
     */
    async listModels() {
        try {
            logger.debug('Listing Ollama models');
            
            const result = await this.client.list();
            
            if (result && result.models && Array.isArray(result.models)) {
                // Ordenar alfabéticamente
                result.models.sort((a, b) => a.name.localeCompare(b.name));
                
                logger.info('Models listed successfully', { 
                    count: result.models.length,
                    models: result.models.map(m => m.name)
                });
                
                return result;
            }
            
            logger.warn('No models found or invalid response');
            return { models: [] };
            
        } catch (error) {
            logger.error('Failed to list models', { error: error.message });
            
            errorService.handleError(
                ERROR_CODES.OLLAMA_REQUEST_FAILED,
                error,
                { operation: 'list_models' }
            );
            
            return { models: [] };
        }
    }

    /**
     * Verifica si un modelo específico está disponible
     */
    async isModelAvailable(modelName) {
        try {
            const models = await this.listModels();
            const available = models.models.some(model => model.name === modelName);
            
            logger.debug('Model availability check', { 
                model: modelName, 
                available 
            });
            
            return available;
        } catch (error) {
            logger.error('Model availability check failed', { 
                model: modelName, 
                error: error.message 
            });
            return false;
        }
    }

    /**
     * Procesa texto con <think> tags de forma segura
     */
    processSafeText(accumulatedText, lastSentIndex) {
        // Filtrar contenido de <think>
        const filteredText = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // Verificar si hay una etiqueta <think> abierta sin cerrar
        const openThinkIndex = accumulatedText.lastIndexOf('<think>');
        const closeThinkIndex = accumulatedText.lastIndexOf('</think>');
        
        let safeText = filteredText;
        
        // Si hay una etiqueta <think> abierta después de la última cerrada
        if (openThinkIndex > closeThinkIndex) {
            const beforeThink = accumulatedText.substring(0, openThinkIndex);
            safeText = beforeThink.replace(/<think>[\s\S]*?<\/think>/gi, '');
        }
        
        // Solo devolver el nuevo contenido seguro
        const newSafeContent = safeText.slice(lastSentIndex);
        
        return {
            safeContent: newSafeContent,
            newSentIndex: safeText.length
        };
    }

    /**
     * Crea un manager para controlar el flujo de streaming de texto
     * Detecta automáticamente el tipo de modelo y aplica la configuración apropiada
     * @returns {TextStreamManager} Manager de streaming de texto
     */
    createTextStreamManager() {
        const currentModel = configService.get('model', OLLAMA_CONFIG.DEFAULT_MODEL).toLowerCase();
        
        // Detectar tipo de modelo usando las constantes
        const modelType = this.detectModelType(currentModel);
        
        // Seleccionar configuración apropiada
        let config;
        switch (modelType) {
            case 'code':
                config = TEXT_STREAMING_CONFIG.CODE_MODELS;
                logger.debug('Using CODE_MODELS configuration for streaming');
                break;
            case 'chat':
                config = TEXT_STREAMING_CONFIG.CHAT_MODELS;
                logger.debug('Using CHAT_MODELS configuration for streaming');
                break;
            default:
                config = TEXT_STREAMING_CONFIG.DEFAULT;
                logger.debug('Using DEFAULT configuration for streaming');
        }
        
        return new TextStreamManager({
            minChunkSize: config.MIN_CHUNK_SIZE,
            maxWaitTime: config.MAX_WAIT_TIME
        });
    }

    /**
     * Detecta el tipo de modelo basado en el nombre
     * @param {string} modelName - Nombre del modelo en minúsculas
     * @returns {string} Tipo de modelo: 'code', 'chat', o 'default'
     */
    detectModelType(modelName) {
        const { CODE_KEYWORDS, CHAT_KEYWORDS } = TEXT_STREAMING_CONFIG.MODEL_DETECTION;
        
        // Verificar si es un modelo de código
        if (CODE_KEYWORDS.some(keyword => modelName.includes(keyword))) {
            return 'code';
        }
        
        // Verificar si es un modelo de chat
        if (CHAT_KEYWORDS.some(keyword => modelName.includes(keyword))) {
            return 'chat';
        }
        
        return 'default';
    }

    /**
     * Valida los parámetros de la petición
     */
    validateRequestParams(prompt, model, temperature) {
        const errors = [];

        if (!prompt || typeof prompt !== 'string') {
            errors.push('Prompt must be a non-empty string');
        }

        if (!model || typeof model !== 'string') {
            errors.push('Model must be a non-empty string');
        }

        if (typeof temperature !== 'number' || 
            temperature < OLLAMA_CONFIG.LIMITS.TEMPERATURE_MIN || 
            temperature > OLLAMA_CONFIG.LIMITS.TEMPERATURE_MAX) {
            errors.push(`Temperature must be between ${OLLAMA_CONFIG.LIMITS.TEMPERATURE_MIN} and ${OLLAMA_CONFIG.LIMITS.TEMPERATURE_MAX}`);
        }

        return errors;
    }

    /**
     * Realiza una petición a Ollama para generar texto
     */
    async generateText(prompt, model = null, temperature = null) {
        // Usar valores por defecto de configuración si no se proporcionan
        const finalModel = model || configService.get('model', OLLAMA_CONFIG.DEFAULT_MODEL);
        const finalTemperature = temperature !== null ? temperature : configService.get('temperature', OLLAMA_CONFIG.DEFAULT_TEMPERATURE);
        
        // Validar parámetros
        const validationErrors = this.validateRequestParams(prompt, finalModel, finalTemperature);
        if (validationErrors.length > 0) {
            const error = errorService.createError(
                ERROR_CODES.OLLAMA_REQUEST_FAILED,
                `Invalid parameters: ${validationErrors.join(', ')}`,
                { prompt, model: finalModel, temperature: finalTemperature }
            );
            throw error;
        }

        // Verificar disponibilidad del modelo
        const modelAvailable = await this.isModelAvailable(finalModel);
        if (!modelAvailable) {
            const error = errorService.createError(
                ERROR_CODES.OLLAMA_MODEL_NOT_FOUND,
                `Model ${finalModel} not found`,
                { model: finalModel }
            );
            throw error;
        }

        try {
            this.isProcessing = true;
            this.abortController = new AbortController();
            
            logger.ollamaRequest(finalModel, prompt);

            // Actualizar el host del cliente si ha cambiado
            const currentHost = configService.get('host', OLLAMA_CONFIG.DEFAULT_HOST);
            if (this.client.host !== currentHost) {
                this.updateClientConfig();
            }

            const response = await this.client.generate({
                model: finalModel,
                prompt: prompt,
                stream: true,
                keep_alive: configService.get('keep-alive', OLLAMA_CONFIG.DEFAULT_KEEP_ALIVE) + 'm',
                options: {
                    temperature: parseFloat(finalTemperature)
                }
            });

            let accumulatedText = '';
            let lastSentIndex = 0;
            
            const textStreamManager = this.createTextStreamManager();

            for await (const part of response) {
                if (!this.isProcessing) {
                    logger.info('Generation cancelled by user');
                    break;
                }

                accumulatedText += part.response;
                
                // Procesar texto de forma segura
                const result = this.processSafeText(accumulatedText, lastSentIndex);
                
                // Usar el manager para decidir cuándo enviar texto
                if (result.safeContent) {
                    const shouldSend = textStreamManager.shouldSendChunk(
                        result.safeContent, 
                        part.done || false
                    );
                    
                    if (shouldSend) {
                        logger.debug('Sending text chunk', {
                            length: result.safeContent.length,
                            preview: result.safeContent.substring(0, 20) + '...',
                            hasAccents: /[áéíóúàèìòùäëïöüâêîôûçñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÇÑ]/.test(result.safeContent)
                        });
                        
                        await platformService.sendText(result.safeContent);
                        lastSentIndex = result.newSentIndex;
                        textStreamManager.onChunkSent(result.safeContent.length);
                    } else {
                        logger.debug('Holding text chunk', {
                            length: result.safeContent.length,
                            reason: 'waiting for better breakpoint'
                        });
                    }
                }
            }
            
            // Al finalizar el stream, enviar cualquier contenido restante filtrado
            if (this.isProcessing && accumulatedText) {
                const finalFiltered = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '');
                const finalContent = finalFiltered.slice(lastSentIndex);
                if (finalContent && finalContent.trim()) {
                    logger.debug('Sending final content chunk', {
                        length: finalContent.length,
                        preview: finalContent.substring(0, 50) + '...'
                    });
                    await platformService.sendText(finalContent);
                }
                // Forzar flush pendiente (Wayland)
                try { platformService.flushPending(); } catch {}
            }

            logger.info('Text generation completed', { 
                model: finalModel,
                promptLength: prompt.length,
                responseLength: accumulatedText.length
            });

            return {
                success: true,
                model: finalModel,
                response: accumulatedText,
                promptLength: prompt.length,
                responseLength: accumulatedText.length
            };

        } catch (error) {
            logger.ollamaError(error, finalModel);
            
            // Si es un error de cancelación, no es realmente un error
            if (error.code === 20 || error.name === 'AbortError') {
                logger.info('Generation aborted', { model: finalModel });
                return {
                    success: false,
                    cancelled: true,
                    model: finalModel
                };
            }

            const errorResult = errorService.handleError(
                ERROR_CODES.OLLAMA_REQUEST_FAILED,
                error,
                { prompt, model: finalModel, temperature: finalTemperature }
            );

            throw error;

        } finally {
            this.isProcessing = false;
            this.abortController = null;
        }
    }

    /**
     * Cancela la generación actual
     */
    cancel() {
        if (this.isProcessing) {
            logger.info('Cancelling Ollama generation');
            this.isProcessing = false;
            
            try {
                if (this.client && typeof this.client.abort === 'function') {
                    this.client.abort();
                }
                
                if (this.abortController) {
                    this.abortController.abort();
                }
            } catch (error) {
                logger.error('Error cancelling Ollama request', { 
                    error: error.message 
                });
            }
        }
    }

    /**
     * Verifica si actualmente se está procesando una petición
     */
    isCurrentlyProcessing() {
        return this.isProcessing;
    }

    /**
     * Obtiene estadísticas del servicio
     */
    getStats() {
        return {
            isProcessing: this.isProcessing,
            host: this.client?.host || 'unknown',
            hasAbortController: !!this.abortController
        };
    }

    /**
     * Reinicia el servicio
     */
    reset() {
        this.cancel();
        this.initializeClient();
        logger.info('Ollama service reset');
    }
}

// Instancia singleton del servicio de Ollama
const ollamaService = new OllamaService();

export default ollamaService;
