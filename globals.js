// globals.js
import path from 'path';
import fs from 'fs';
import os from 'os';

// Ruta de la carpeta de configuración del usuario
const userConfigDir = path.join(os.homedir(), '.select2llm');
const configFilePath = path.join(userConfigDir, 'config.json');

// Datos de configuración iniciales
const defaultConfig = {
  language: 'es',
  temperature: 0.8,
  'keep-alive': 5,
  host: 'http://127.0.0.1:11434',
};

// Verifica si la carpeta de configuración existe; si no, la crea
if (!fs.existsSync(userConfigDir)) {
  fs.mkdirSync(userConfigDir);
}

// Verifica si el archivo de configuración existe; si no, crea uno con los valores predeterminados
if (!fs.existsSync(configFilePath)) {
  fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2));
}

// Leer la configuración una sola vez al inicio
let currentConfig;
try {
  const data = fs.readFileSync(configFilePath, 'utf-8');
  currentConfig = JSON.parse(data);
} catch (err) {
  console.error('Error al leer la configuración al inicio:', err);
  currentConfig = defaultConfig;
}

// Funciones para guardar la configuración
export const globals = {
  inferencia: false,
  ...currentConfig,

  // Guarda la configuración proporcionada en el archivo config.json y actualiza la variable en memoria
  saveConfig: (newConfig) => {
    try {
      currentConfig = { ...currentConfig, ...newConfig };
      fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2));
      Object.assign(globals, currentConfig);
    } catch (err) {
      console.error('Error al guardar la configuración:', err);
    }
  },
};