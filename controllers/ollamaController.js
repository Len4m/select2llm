
import ollama from 'ollama';
import { sendText } from './keyboardController.js';

/**
 * TODO:  
 * - El proceso tarda mucho, hacerlo en streaming para no hacer esperar al usuario.
 * - El cancelar con esta solución no es efectivo, con streaming se podría solucionar.
 **/ 
// Llamada a Ollama
export async function callOllama(prompt, model = 'llama3.2:latest') {
    try {
        const response = await ollama.generate({
            model: model,
            prompt: prompt,
        });
        if (global.inferencia) {
            console.log('Respuesta de Ollama:', response.response);
            sendText(response.response);
        }
    } catch (error) {
        console.error('Error al llamar a Ollama:', error);
    }
    global.inferencia = false;
}

export function listOllama() {
    let list = [];
    try {
        list = ollama.list();
    } catch (error) {
        console.error('Error al cancelar a Ollama:', error);
    }
    return list;
}

export function cancelOllama() {
    try {
        ollama.abort();
    } catch (error) {
        console.error('Error al cancelar a Ollama:', error);
        return;
    }
    global.inferencia = false;
    console.log("Petición cancelada");
}