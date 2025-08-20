
import { Ollama } from 'ollama';
import { sendText } from './keyboardController.js';
import { globals } from '../globals.js';
import http from 'http';

const ollama = new Ollama({ host: globals.host })

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