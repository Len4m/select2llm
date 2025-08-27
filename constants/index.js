/**
 * Constantes centralizadas para Select2LLM
 * Contiene todas las constantes de la aplicación para facilitar el mantenimiento
 */

export const APP_CONFIG = {
    NAME: 'Select2LLM',
    ID: 'com.lenam.Select2llm',
    VERSION: '1.0.0',
    DESCRIPTION: 'Select text to LLM',
    CONFIG_DIR: '.select2llm',
    
    // Archivos de configuración
    FILES: {
        CONFIG: 'config.json',
        SHORTCUTS: 'shortcuts.json',
        LOGS: 'logs'
    }
};

export const WINDOW_CONFIG = {
    CONFIG: {
        WIDTH: 750,
        HEIGHT: 475,
        MIN_WIDTH: 750,
        MIN_HEIGHT: 475
    },
    
    OVERLAY: {
        TRANSPARENT: true,
        FRAME: false,
        ALWAYS_ON_TOP: true,
        RESIZABLE: false,
        MOVABLE: false,
        FOCUSABLE: true,
        SKIP_TASKBAR: true,
        FULLSCREENABLE: false,
        MINIMIZABLE: false,
        MAXIMIZABLE: false,
        HAS_SHADOW: false,
        BACKGROUND_COLOR: '#00000000'
    }
};

export const OLLAMA_CONFIG = {
    DEFAULT_HOST: 'http://127.0.0.1:11434',
    DEFAULT_MODEL: 'llama3.2:latest',
    DEFAULT_TEMPERATURE: 0.8,
    DEFAULT_KEEP_ALIVE: 5,
    
    // Límites de configuración
    LIMITS: {
        TEMPERATURE_MIN: 0,
        TEMPERATURE_MAX: 2,
        KEEP_ALIVE_MIN: 0,
        KEEP_ALIVE_MAX: 60
    },
    
    // Timeouts
    TIMEOUTS: {
        API_CHECK: 5000,
        REQUEST: 30000,
        ABORT: 1000
    }
};

export const PLATFORM_CONFIG = {
    SUPPORTED: ['win32', 'linux', 'darwin'],
    
    LINUX: {
        SESSION_TYPES: ['x11', 'wayland'],
        DEPENDENCIES: {
            X11: ['xclip', 'xdotool'],
            WAYLAND: ['ydotool']
        }
    },
    
    WINDOWS: {
        DEPENDENCIES: ['PowerShell']
    },
    
    MACOS: {
        DEPENDENCIES: ['osascript']
    }
};

export const SHORTCUTS_CONFIG = {
    MODIFIERS: ['ctrl', 'shift', 'alt'],
    
    // Teclas válidas para shortcuts
    VALID_KEYS: [
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ],
    
    // Delays para operaciones
    DELAYS: {
        BEFORE_COPY: 250,
        AFTER_COPY: 250,
        BEFORE_PROCESS: 250
    }
};

export const LOGGING_CONFIG = {
    LEVELS: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
    },
    
    DEFAULT_LEVEL: 'INFO',
    DEVELOPMENT_LEVEL: 'DEBUG',
    
    // Configuración de archivos de log
    FILE_CONFIG: {
        MAX_SIZE: 10 * 1024 * 1024, // 10MB
        MAX_FILES: 5,
        DATE_PATTERN: 'YYYY-MM-DD',
        EXTENSION: '.log'
    },
    
    // Colores para consola
    COLORS: {
        ERROR: '\x1b[31m',  // Rojo
        WARN: '\x1b[33m',   // Amarillo
        INFO: '\x1b[36m',   // Cian
        DEBUG: '\x1b[37m',  // Blanco
        RESET: '\x1b[0m'
    }
};

export const I18N_CONFIG = {
    DEFAULT_LANGUAGE: 'en',
    SUPPORTED_LANGUAGES: ['en', 'es', 'ca'],
    LOCALES_DIR: 'locales',
    
    // Mapeo de locales del sistema
    LOCALE_MAPPING: {
        'ca': ['ca_ES', 'ca_AD', 'ca_FR', 'ca_IT'],
        'es': ['es_ES', 'es_MX', 'es_AR', 'es_CO', 'es_CL', 'es_PE', 'es_VE'],
        'en': ['en_US', 'en_GB', 'en_CA', 'en_AU']
    }
};

export const ERROR_CODES = {
    // Errores de configuración
    CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
    CONFIG_INVALID: 'CONFIG_INVALID',
    CONFIG_SAVE_FAILED: 'CONFIG_SAVE_FAILED',
    
    // Errores de plataforma
    PLATFORM_NOT_SUPPORTED: 'PLATFORM_NOT_SUPPORTED',
    PLATFORM_DEPENDENCIES_MISSING: 'PLATFORM_DEPENDENCIES_MISSING',
    WINDOW_NOT_FOUND: 'WINDOW_NOT_FOUND',
    
    // Errores de Ollama
    OLLAMA_NOT_AVAILABLE: 'OLLAMA_NOT_AVAILABLE',
    OLLAMA_MODEL_NOT_FOUND: 'OLLAMA_MODEL_NOT_FOUND',
    OLLAMA_REQUEST_FAILED: 'OLLAMA_REQUEST_FAILED',
    OLLAMA_TIMEOUT: 'OLLAMA_TIMEOUT',
    
    // Errores de shortcuts
    SHORTCUT_INVALID: 'SHORTCUT_INVALID',
    SHORTCUT_ALREADY_EXISTS: 'SHORTCUT_ALREADY_EXISTS',
    SHORTCUT_REGISTRATION_FAILED: 'SHORTCUT_REGISTRATION_FAILED',
    
    // Errores de archivo
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    FILE_PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
    FILE_CORRUPTED: 'FILE_CORRUPTED'
};

export const ANIMATION_CONFIG = {
    FRAMES: 20,
    FRAME_DELAY: 100, // milliseconds
    FRAME_PATTERN: 'frame_{index}_delay-0.06s.png',
    ANIMATION_DIR: 'images/animation'
};

export const TRAY_CONFIG = {
    TOOLTIP: 'Select2LLM',
    CLICK_TIMEOUT: 300 // milliseconds for double-click detection
};

export const CLIPBOARD_CONFIG = {
    MAX_SIZE: 1024 * 1024, // 1MB
    ENCODING: 'utf-8',
    TIMEOUT: 5000 // milliseconds
};

export const UI_CONFIG = {
    ZOOM: {
        MIN: 100,        // Zoom mínimo 100%
        MAX: 150,       // Zoom máximo 150%
        DEFAULT: 100,   // Zoom por defecto 100%
        STEP: 1        // Incrementos de 1%
    }
};

// Exportar todo como un objeto para importación selectiva
export default {
    APP_CONFIG,
    WINDOW_CONFIG,
    OLLAMA_CONFIG,
    PLATFORM_CONFIG,
    SHORTCUTS_CONFIG,
    LOGGING_CONFIG,
    I18N_CONFIG,
    ERROR_CODES,
    ANIMATION_CONFIG,
    TRAY_CONFIG,
    CLIPBOARD_CONFIG,
    UI_CONFIG
};
