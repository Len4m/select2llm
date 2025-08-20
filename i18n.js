// i18n.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para obtener el idioma por defecto del sistema
function getSystemDefaultLanguage() {
    const locale = (process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
    if (locale.startsWith('ca')) return 'ca';
    if (locale.startsWith('es')) return 'es';
    return 'en';
}

// Función para cargar el idioma desde la configuración
function getConfiguredLanguage() {
    try {
        const configPath = path.join(os.homedir(), '.select2llm', 'config.json');
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(configData);
            if (config.language && typeof config.language === 'string') {
                return config.language;
            }
        }
    } catch (error) {
        // Si hay error leyendo la configuración, usar sistema
        console.warn('Could not read language from config:', error.message);
    }
    return null;
}

class I18n {
    constructor() {
        // Cargar el idioma de la configuración, si no existe usar el del sistema
        this.language = getConfiguredLanguage() || getSystemDefaultLanguage();
        this.translations = {};
        this.localesDir = path.join(__dirname, 'locales');
        this.loadTranslations();
    }

    // Cambia el idioma y recarga las traducciones
    setLanguage(language) {
        this.language = language;
        this.loadTranslations();
    }

    // Actualiza el idioma desde la configuración (llamado cuando configService está disponible)
    updateFromConfig(config) {
        if (config && config.language && config.language !== this.language) {
            this.setLanguage(config.language);
        }
    }

    // Carga el archivo JSON de traducciones para el idioma actual
    loadTranslations() {
        const filePath = path.join(this.localesDir, `${this.language}.json`);
        
        // Si el archivo no existe, crea uno vacío
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
        }

        // Cargar el archivo JSON de traducciones
        const data = fs.readFileSync(filePath, 'utf-8');
        this.translations = JSON.parse(data);
    }

    // Devuelve la traducción para una clave; si no existe, la crea
    t(key) {
        // Si la clave existe, devuelve su traducción
        if (this.translations[key]) {
            return this.translations[key];
        }

        // Si la clave no existe, se añade con un valor predeterminado y se guarda en el archivo
        this.translations[key] = `[${key}]`;
        this.saveTranslations();
        return this.translations[key];
    }

    // Guarda las traducciones en el archivo JSON del idioma actual
    saveTranslations() {
        const filePath = path.join(this.localesDir, `${this.language}.json`);
        fs.writeFileSync(filePath, JSON.stringify(this.translations, null, 2));
    }
}

// Exporta una instancia de I18n para usar en toda la aplicación
const i18n = new I18n();
export default i18n;
