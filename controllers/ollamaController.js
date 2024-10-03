
import ollama from 'ollama';
import { sendText } from './keyboardController.js';

// Llamada a Ollama
export async function callOllama(prompt, model = 'llama3.2:latest') {
    const message = { role: 'user', content: prompt }
    try {
        const response = await ollama.chat({ model: model, messages: [message], stream: true })
        for await (const part of response) {
            if (global.inferencia) {
                sendText(part.message.content)
            }
        }
    } catch (_) {
        // Error por cancelación
    }
    global.inferencia = false;
}

export function listOllama() {
    let list = [];
    try {
        list = ollama.list();
    } catch (error) {
        console.error('Error al listar modelos:', error);
    }
    return list;
}

export function cancelOllama() {
    if (global.inferencia) {
        global.inferencia = false;
        try {
            ollama.abort();
        } catch (error) {
            console.error('Error al cancelar:', error);
            return;
        }
        console.log("Petición cancelada");
    }
}