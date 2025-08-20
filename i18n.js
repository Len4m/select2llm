// i18n.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para obtener el idioma por defecto del sistema
function getDefaultLanguage() {
    const locale = (process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
    if (locale.startsWith('ca')) return 'ca';
    if (locale.startsWith('es')) return 'es';
    return 'en';
}

class I18n {
    constructor() {
        // Cargar el idioma predeterminado del sistema
        this.language = getDefaultLanguage();
        this.translations = {};
        this.localesDir = path.join(__dirname, 'locales');
        this.loadTranslations();
    }

    // Cambia el idioma y recarga las traducciones
    setLanguage(language) {
        this.language = language;
        this.loadTranslations();
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
