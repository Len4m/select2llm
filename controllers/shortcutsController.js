import { globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getSelectedText } from './keyboardController.js';
import { callOllama } from './ollamaController.js';

// Ruta de la carpeta de configuración del usuario
const userConfigDir = path.join(os.homedir(), '.select2llm'); // Cambia '.mi-app-electron' por el nombre de tu aplicación
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
export function registerShortcuts() {
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
        const success = globalShortcut.register(combination, async () => {
            if (!global.inferencia) {
                console.log(`¡Combinación de teclas ${combination} detectada!`);
                // Reemplazar %s en el prompt con la tecla
                const selectData = await getSelectedText();
                if (selectData && selectData !== '') {
                    global.inferencia = true;
                    const message = shortcut.prompt.indexOf('%s') !== -1 ?
                        shortcut.prompt.replace('%s', selectData) : shortcut.prompt + ' ' + selectData;
                    console.log(`Prompt (${shortcut.model}): ${message}`);
                    // Llamada a ollama con el prompt
                    callOllama(message, shortcut.model);
                }
            }
        });

        if (!success) {
            console.error(`Error al registrar la combinación de teclas: ${combination}`);
        } else {
            console.log(`Atajo registrado correctamente: ${combination}`);
        }
    });

    console.log('Registro de atajos completado.');
}


// Crear la carpeta de configuración si no existe
function ensureConfigDir() {
    if (!fs.existsSync(userConfigDir)) {
        fs.mkdirSync(userConfigDir, { recursive: true });
    }
}