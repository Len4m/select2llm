import { exec, execSync } from 'child_process';

let wid;


// Función para escapar caracteres especiales para bash y xdotool
function escapeForBash(a) {
    var ret = [];
    a.forEach(function (s) {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
                .replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
        }
        ret.push(s);
    });

    return ret.join(' ');
}


export function sendTextLinux(text) {
    return new Promise((resolve, reject) => {
        const lines = text.split('\n');

        function typeLines(lines) {
            if (lines.length === 0) {
                resolve(); // Resolución cuando todas las líneas han sido procesadas
                return;
            }
            const line = lines.shift();
            let cmd;

            if (line.length > 0) {
                cmd = escapeForBash(['xdotool', 'type', '--clearmodifiers', '--window', wid, '--', line]);
            }

            if (lines.length > 0) {
                if (line.length > 0)
                    cmd += ` && xdotool key --clearmodifiers --window '${wid}' Return`;
                else
                    cmd = `xdotool key --clearmodifiers --window '${wid}' Return`;
            }

            if (cmd) {
                exec(cmd, (error, stdout, stderr) => {
                    if (error) {
                        reject(`Error escribiendo línea con xdotool: ${error}\n\n${stderr}`);
                        return;
                    }
                    // Llamar recursivamente para procesar la siguiente línea
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
        // Primero, obtener el ID de la ventana
        exec('xdotool getwindowfocus', (error1, stdout1, stderr1) => {
            if (error1) {
                return reject(new Error(`Error al obtener el ID de la ventana: ${error1}\n\n${stderr1}`));
            }
            wid = String(stdout1).trim();
            if (!wid) {
                return reject(new Error('Ventana no encontrada'));
            }
           
            // Luego, realizar la copia
            exec(`xdotool key --clearmodifiers --window '${wid}' ctrl+c`, (error2) => {
                if (error2) {
                    return reject(new Error(`Error al copiar al portapapeles: ${error2}`));
                }
                console.log('ctrl+c enviado');
                // Resuelve la promesa con el ID de la ventana
                resolve();
            });
        });
    });
}

/*
export async function sendCopyLinux() {
    try {
        wid =  execSync('xdotool getwindowfocus').toString().trim();
        if (!wid) {
            throw new Error('Ventana no encontrada');
        }
        execSync(`xdotool key --clearmodifiers --window '${wid}' ctrl+c`);
    } catch (error) {
        throw new Error(e);
    }
}
*/

export function getLinuxWindowGeometry() {
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
}



