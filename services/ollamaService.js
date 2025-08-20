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
import { OLLAMA_CONFIG, ERROR_CODES } from '../constants/index.js';

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

            for await (const part of response) {
                if (!this.isProcessing) {
                    logger.info('Generation cancelled by user');
                    break;
                }

                accumulatedText += part.response;
                
                // Procesar texto de forma segura
                const result = this.processSafeText(accumulatedText, lastSentIndex);
                
                // Enviar solo el contenido seguro
                if (result.safeContent) {
                    await platformService.sendText(result.safeContent);
                    lastSentIndex = result.newSentIndex;
                }
            }
            
            // Al finalizar el stream, enviar cualquier contenido restante filtrado
            if (this.isProcessing && accumulatedText) {
                const finalFiltered = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '');
                const finalContent = finalFiltered.slice(lastSentIndex);
                if (finalContent) {
                    await platformService.sendText(finalContent);
                }
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
