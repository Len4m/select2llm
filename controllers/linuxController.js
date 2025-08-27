import { exec, execSync } from 'child_process';
import logger from '../services/logger.js';

let wid;
const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase(); // 'wayland' o 'x11'

// Función para limpiar modificadores pegados en X11
export function clearStuckModifiers() {
    if (sessionType === 'x11' && wid) {
        const clearCmd = `xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt`;
        exec(clearCmd, (error) => {
            if (error) {
                logger.debug('Error clearing stuck modifiers', { error: error.message });
            } else {
                logger.debug('Stuck modifiers cleared successfully');
            }
        });
    }
}

// Función para escapar caracteres especiales para bash (se usa con xdotool)
function escapeForBash(args) {
    return args.map(s => {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '').replace(/\\'''/g, "\\'");
        }
        return s;
    }).join(' ');
}

export function sendTextLinux(text) {
    return new Promise((resolve, reject) => {
        const lines = text.split('\n');

        function typeLines(lines) {
            if (lines.length === 0) {
                // Limpiar modificadores al finalizar el envío de texto
                clearStuckModifiers();
                resolve(); // Se procesaron todas las líneas
                return;
            }
            const line = lines.shift();
            let cmd = '';

            if (sessionType === 'x11') {
                // En X11: usamos xdotool y el ID de la ventana (wid)
                logger.debug('Preparando comando para enviar texto en X11', { line, wid });
                
                const buildXdotoolCommand = (action, args = []) => {
                    const baseArgs = ['xdotool', action, '--clearmodifiers'];
                    if (wid) {
                        baseArgs.push('--window', wid);
                    }
                    return escapeForBash([...baseArgs, ...args]);
                };

                const commands = [];

                // Añadir comando de escritura si hay texto
                if (line.length > 0) {
                    commands.push(buildXdotoolCommand('type', ['--delay', '1', '--', line]));
                    logger.debug('Comando de escritura generado', { cmd: commands[commands.length - 1] });
                }

                // Añadir comando de Enter si hay más líneas
                if (lines.length > 0) {
                    commands.push(buildXdotoolCommand('key', ['Return']));
                    logger.debug('Comando de Enter añadido', { cmd: commands[commands.length - 1] });
                }

                cmd = commands.join(' && ');
                logger.debug('Comando final X11', { cmd });
            } else if (sessionType === 'wayland') {
                // En Wayland: usamos ydotool en lugar de wtype
                if (line.length > 0) {
                    // ydotool escribe el texto directamente con el comando "type"
                    const safeLine = line.replace(/'/g, "'\\''");
                    cmd = `ydotool type '${safeLine}'`;
                }
                if (lines.length > 0) {
                    // Para enviar la tecla Enter usamos el comando "key"
                    if (line.length > 0)
                        cmd += ` && ydotool key Return`;
                    else
                        cmd = `ydotool key Return`;
                }
            } else {
                return reject(new Error('Sistema operativo no soportado para enviar texto'));
            }

            if (cmd) {
                exec(cmd, (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`Error escribiendo línea: ${error}\n${stderr}`));
                        return;
                    }
                    typeLines(lines);
                });
            } else {
                typeLines(lines);
            }
        }

        typeLines(lines);
    });
}

export async function sendCopyLinux() {
    return new Promise((resolve, reject) => {
        if (sessionType === 'x11') {
            // En X11: obtenemos el ID de la ventana y enviamos ctrl+c con xdotool
            exec('xdotool getwindowfocus', (error1, stdout1, stderr1) => {
                if (error1) {
                    return reject(new Error(`Error al obtener el ID de la ventana: ${error1}\n${stderr1}`));
                }
                wid = String(stdout1).trim();
                if (!wid) {
                    return reject(new Error('Ventana no encontrada'));
                }
                // Enviamos ctrl+c y luego limpiamos modificadores para evitar teclas pegadas
                const copyCmd = `xdotool key --clearmodifiers --window '${wid}' ctrl+c && xdotool keyup --clearmodifiers --window '${wid}' ctrl shift alt`;
                exec(copyCmd, (error2, stdout2, stderr2) => {
                    if (error2) {
                        return reject(new Error(`Error al copiar al portapapeles: ${error2}\n${stderr2}`));
                    }
                    logger.debug('Ctrl+C sent via X11 with modifier cleanup');
                    resolve();
                });
            });
        } else if (sessionType === 'wayland') {
            // En Wayland: usamos ydotool para enviar ctrl+c
            // Simulamos presionar la tecla Ctrl, luego la tecla 'c' y luego liberar Ctrl
            exec(`ydotool keydown ctrl && ydotool key c && ydotool keyup ctrl`, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`Error al copiar con ydotool: ${error}\n${stderr}`));
                }
                logger.debug('Ctrl+C sent via Wayland');
                resolve();
            });
        } else {
            reject(new Error('Sistema operativo no soportado para copiar'));
        }
    });
}

export function getLinuxWindowGeometry() {
    if (sessionType === 'x11') {
        const cmd = `xdotool getwindowgeometry --shell ${wid}`;
        const output = execSync(cmd).toString();
        const geom = {};
        const lines = output.split('\n');
        for (let line of lines) {
            if (line.startsWith('X=')) {
                geom.x = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('Y=')) {
                geom.y = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('WIDTH=')) {
                geom.width = parseInt(line.split('=')[1].trim());
            } else if (line.startsWith('HEIGHT=')) {
                geom.height = parseInt(line.split('=')[1].trim()); 
            }
        }
        return geom;
    } else if (sessionType === 'wayland') {
        // En Wayland no existe un equivalente sencillo para obtener la geometría de la ventana
        throw new Error('getLinuxWindowGeometry no está implementado en Wayland');
    } else {
        throw new Error('Sistema operativo no soportado');
    }
}
