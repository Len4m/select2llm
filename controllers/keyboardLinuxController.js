import { exec } from 'child_process';
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

export function sendCopyLinux() {
    return new Promise((resolve, reject) => {
        // Primero, obtener el ID de la ventana
        exec('xdotool getwindowfocus', (error1, stdout1, stderr1) => {
            if (error1) {
                console.error(`Error al obtener el ID de la ventana: ${error1}\n\n${stderr1}`);
                return reject(error1);
            }
            wid = String(stdout1).trim();

            // Luego, realizar la copia
            exec(`xclip -out -selection primary | xclip -in -selection clipboard`, (error2, stdout2, stderr2) => {
                if (error2) {
                    console.error(`Error al copiar al portapapeles: ${error2}\n\n${stderr2}`);
                    return reject(error2);
                }

                // Resuelve la promesa con el ID de la ventana
                resolve();
            });
        });
    });
}



