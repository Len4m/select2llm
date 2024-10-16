import { globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getSelectedText, sendCopyCommand } from './keyboardController.js';
import { callOllama } from './ollamaController.js';
import { globals } from '../globals.js';


// Ruta de la carpeta de configuración del usuario
const userConfigDir = path.join(os.homedir(), '.select2llm');
const shortcutsFilePath = path.join(userConfigDir, 'shortcuts.json');


// Guardar combinaciones de teclas en el archivo JSON en la carpeta del usuario
export function saveShortcuts(shortcuts) {
    ensureConfigDir(); // Asegurarse de que la carpeta existe
    fs.writeFileSync(shortcutsFilePath, JSON.stringify(shortcuts, null, 2));
}


// Leer combinaciones de teclas desde un archivo JSON
export function loadShortcuts() {
    ensureConfigDir(); // Asegurarse de que la carpeta existe
    if (fs.existsSync(shortcutsFilePath)) {
        const data = fs.readFileSync(shortcutsFilePath);
        return JSON.parse(data);
    }
    return []; // Si no existe el archivo, retorna un array vacío
}


// Registrar atajos globales dinámicamente
export function registerShortcuts(startCallBack = null, stopCallBack = null) {
    const shortcuts = loadShortcuts();

    // Desregistrar atajos previos para evitar duplicados
    globalShortcut.unregisterAll();

    shortcuts.forEach((shortcut) => {
        let combination = '';
        if (shortcut.ctrl) combination += 'CommandOrControl+';
        if (shortcut.shift) combination += 'Shift+';
        if (shortcut.alt) combination += 'Alt+';
        combination += shortcut.key;

        console.log(`Intentando registrar atajo: ${combination}`); // Debug
        const success = globalShortcut.register(combination, callShortcut(combination, startCallBack, shortcut, stopCallBack));

        if (!success) {
            console.error(`Error al registrar la combinación de teclas: ${combination}`);
        } else {
            console.log(`Atajo registrado correctamente: ${combination}`);
        }
    });

    console.log('Registro de atajos completado.');
}


function callShortcut(combination, startCallBack, shortcut, stopCallBack) {
    return async () => {
        console.log(`¡Combinación de teclas ${combination} detectada!`);
        
        // Definir una función de retardo reutilizable para evitar la repetición de código
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        try {
            
            await delay(250);
            // Enviar señal de copiar al portapapeles (OS)
            await sendCopyCommand();
            await delay(250);
            // Obtener los datos del portapapeles (OS).
            const selectData = await getSelectedText();
            await delay(250);
            
            // Validar si la inferencia no está activa y hay texto seleccionado
            if (!globals.inferencia && selectData) {
                if (startCallBack) await startCallBack();
                
                // Formar el mensaje a partir del prompt del atajo
                const message = shortcut.prompt.includes('%s')
                    ? shortcut.prompt.replace('%s', selectData)
                    : `${shortcut.prompt} ${selectData}`;
                
                console.log(`Prompt (${shortcut.model}): ${message}`);
                
                // Llamar a Ollama para procesar el mensaje
                await callOllama(message, shortcut.model);
                
                if (stopCallBack) await stopCallBack();
            }
        } catch (error) {
            console.error('Error al ejecutar el atajo:', error);
        }
    };
}

// Crear la carpeta de configuración si no existe
function ensureConfigDir() {
    if (!fs.existsSync(userConfigDir)) {
        fs.mkdirSync(userConfigDir, { recursive: true });
    }
}