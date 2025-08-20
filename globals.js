// globals.js
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

// Ruta de la carpeta de configuración del usuario
const userConfigDir = path.join(os.homedir(), '.select2llm');
const configFilePath = path.join(userConfigDir, 'config.json');

// Datos de configuración iniciales
const getDefaultLanguage = () => {
  const locale = (process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
  if (locale.startsWith('ca')) return 'ca';
  if (locale.startsWith('es')) return 'es';
  return 'en';
};

const defaultConfig = {
  language: getDefaultLanguage(),
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
    let actual_host = currentConfig.host;
    try {
      currentConfig = { ...currentConfig, ...newConfig };
      fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2));
      Object.assign(globals, currentConfig);

      if (actual_host !== currentConfig.host) {
        setTimeout(() => {
          app.relaunch(); // Reinicia la aplicación
          app.exit(0);    // Cierra la aplicación actual para que la reinicie
        }, 1500);
      }

    } catch (err) {
      console.error('Error al guardar la configuración:', err);
    }
  },
};