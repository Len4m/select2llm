
import ollama from 'ollama';
import { sendText } from './keyboardController.js';
import { globals } from '../globals.js';

// Llamada a Ollama
export async function callOllama(prompt, model = 'llama3.2:latest', temperature = 0.8) {

    try {
        console.log(temperature);
        const response = await ollama.generate({
            model: model,
            prompt: prompt,
            stream: true,
            options: {
                temperature: parseFloat(temperature)
            }
        })
        for await (const part of response) {
            if (globals.inferencia) {
                await sendText(part.response);
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
    } catch (error) {
        console.error('Error al listar modelos:', error);
    }
    return list;
}

export function cancelOllama() {
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