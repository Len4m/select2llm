
import { Ollama } from 'ollama';
import { sendText } from './keyboardController.js';
import { globals } from '../globals.js';
import http from 'http';

const ollama = new Ollama({ host: globals.host })

// Función para procesar texto y determinar qué se puede enviar de forma segura
function processSafeText(accumulatedText, lastSentIndex) {
    // Primero, filtrar todo el contenido de <think>
    const filteredText = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Verificar si hay una etiqueta <think> abierta sin cerrar
    const openThinkIndex = accumulatedText.lastIndexOf('<think>');
    const closeThinkIndex = accumulatedText.lastIndexOf('</think>');
    
    let safeText = filteredText;
    
    // Si hay una etiqueta <think> abierta después de la última cerrada
    if (openThinkIndex > closeThinkIndex) {
        // Encontrar el texto antes de la etiqueta <think> abierta
        const beforeThink = accumulatedText.substring(0, openThinkIndex);
        safeText = beforeThink.replace(/<think>[\s\S]*?<\/think>/gi, '');
    }
    
    // Solo enviar el nuevo contenido que es seguro
    const newSafeContent = safeText.slice(lastSentIndex);
    
    return {
        safeContent: newSafeContent,
        newSentIndex: safeText.length
    };
}

// Llamada a Ollama
export async function callOllama(prompt, model = 'llama3.2:latest', temperature = 0.8) {
    try {
        ollama.host = globals.host;
        const response = await ollama.generate({
            model: model,
            prompt: prompt,
            stream: true,
            keep_alive: globals['keep-alive'] + 'm', // minutes
            options: {
                temperature: parseFloat(temperature)
            }
        })
        
        let accumulatedText = '';
        let lastSentIndex = 0;
        
        for await (const part of response) {
            if (globals.inferencia) {
                accumulatedText += part.response;
                
                // Procesar texto de forma segura
                const result = processSafeText(accumulatedText, lastSentIndex);
                
                // Enviar solo el contenido seguro
                if (result.safeContent) {
                    await sendText(result.safeContent);
                    lastSentIndex = result.newSentIndex;
                }
            }
        }
        
        // Al finalizar el stream, enviar cualquier contenido restante (filtrado)
        if (globals.inferencia && accumulatedText) {
            const finalFiltered = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '');
            const finalContent = finalFiltered.slice(lastSentIndex);
            if (finalContent) {
                await sendText(finalContent);
            }
        }
    } catch (err) {
        if (err.code !== 20) // Abort error
            console.error(err);
    }
}

export async function listOllama() {
    let list = [];
    try {
        list = await ollama.list();
        // Ordenar la lista alfabéticamente por el campo 'name'
        if (list && list.models && Array.isArray(list.models)) {
            list.models.sort((a, b) => a.name.localeCompare(b.name));
        }
                
    } catch (error) {
        console.error('Error al listar modelos:', error);
    }
    return list;
}

export  function  cancelOllama() {
    if (globals.inferencia) {
        globals.inferencia = false;
        try {
             ollama.abort();
        } catch (error) {
            console.error('Error al cancelar:', error);
            return;
        }
        console.log("Petición cancelada");
    }
}


export function checkApi() {
    return new Promise((resolve) => {
        let host = globals.host==''?'http://127.0.0.1:11434':globals.host;
        
        const req = http.get(host, (res) => {
            let data = '';

            // Escucha los datos entrantes del body de la respuesta
            res.on('data', (chunk) => {
                data += chunk;
            });

            // Cuando termina de recibir los datos, verifica el contenido
            res.on('end', () => {
                if (res.statusCode === 200 && data.trim() === "Ollama is running") {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });

        // Manejador de errores
        req.on('error', () => {
            resolve(false);
        });
        req.end();
    });
}