const { clipboard, ipcRenderer } = require('electron');
const platform = process.platform;
let shortcuts = [];
let models = [];
let global_config = {
    language: 'es',
    temperature: 0.8,
    'keep-alive': 5,
    host: 'http://127.0.0.1:11434',
};


if (platform === 'darwin') {
    document.getElementById('ctrl-button').src = 'images/command-button-icon.png';
}

// Cargar atajos existentes
ipcRenderer.on('load-shortcuts', (event, loadedShortcuts) => {
    shortcuts = loadedShortcuts;
    renderShortcuts();
});

// Cargar listado de modelos
ipcRenderer.on('load-models', (event, loadModels) => {
    models = loadModels.models;
    renderModels();
});

// Cargar configuración
ipcRenderer.on('load-config', (event, config) => {
    global_config = config;
    setConfigFormData(config);
    clearForm();
    loadAllTranslations();
});


// ollama-is-ok
ipcRenderer.on('load-ollama-ok', (event, isOk) => {
    if (!isOk) {
        document.getElementsByClassName('ollama-alert')[0].style.display = 'block';
        document.getElementById('global-config-host').style.borderColor = 'red';
    }
});

// Función para establecer los valores del formulario desde un objeto
function setConfigFormData(data) {
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const element = form.querySelector(`[name="${key}"]`);
            if (element) {
                element.value = data[key];
            }
        }
    }
    document.getElementById('global-config-temperatura-span').innerText = data.temperature;
}

function htmlencode(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// Renderizar la lista de modelos
function renderModels() {
    const select = document.getElementById('model');
    models.forEach((model, index) => {
        const mOption = document.createElement('option');
        mOption.value = model.name;
        mOption.text = model.name + ` (${formatBytes(model.size)})`;
        select.appendChild(mOption);
    });
}

// Renderizar la lista de atajos
function renderShortcuts() {
    const list = document.getElementById('shortcuts-list');
    list.innerHTML = '';
    shortcuts.forEach((shortcut, index) => {
        const item = document.getElementById('prompts-items').content.cloneNode(true);
        let atajoHtml = '';
        if (shortcut.ctrl) {
            atajoHtml += `<img class="atajo-key" src="images/${platform === 'darwin' ? 'command-button-icon' : 'ctrl-control-button-icon'}.png">` +
                '<img class="atajo-plus" src="images/math-plus-icon.png">';
        }
        if (shortcut.alt) {
            atajoHtml += '<img class="atajo-key" src="images/alt-button-icon.png">' +
                '<img class="atajo-plus" src="images/math-plus-icon.png">';
        }
        if (shortcut.shift) {
            atajoHtml += '<img class="atajo-key" src="images/shift-button-icon.png">' +
                '<img class="atajo-plus" src="images/math-plus-icon.png">';
        }
        atajoHtml += `<span class="key" style="font-weight: bold;font-size:120%;">${shortcut.key}</span>`;
        item.querySelector('.atajo-atajo').innerHTML = atajoHtml;
        item.querySelector('.atajo-model').appendChild(document.createTextNode(shortcut.model));
        item.querySelector('.atajo-temp').appendChild(document.createTextNode(shortcut.temperature));
        item.querySelector('p').innerHTML = htmlencode(shortcut.prompt).replace(/\n/g, "<br>");
        // Del btn
        const delBtn = document.createElement('a');
        delBtn.classList.add('atajo-btn');
        delBtn.setAttribute('title', 'Eliminar atajo')
        delBtn.innerHTML = '<img src="images/checkbox-cross-red-icon.png">';
        delBtn.onclick = (e) => {
            const dialog = document.getElementById('del-confirm');
            dialog.style.display = 'flex';
            document.getElementById('accept-confirm').setAttribute('data-index', index);
        };
        item.querySelector('.atajo-li').insertBefore(delBtn, item.querySelector('.atajo-li').firstChild);


        // Edit btn
        const editBtn = document.createElement('a');
        editBtn.classList.add('atajo-btn');
        editBtn.style.marginLeft = '10px';
        editBtn.setAttribute('title', 'Editar atajo')
        editBtn.innerHTML = '<img src="images/edit-icon.png">';
        editBtn.onclick = (e) => {
            edit_shortcut(index);
        };
        item.querySelector('.atajo-li').insertBefore(editBtn, item.querySelector('.atajo-li').firstChild);

        // Copy prompt btn
        const copyBtn = document.createElement('a');
        copyBtn.setAttribute('title', 'Copiar prompt')
        copyBtn.style.marginLeft = '10px';
        copyBtn.classList.add('atajo-btn');
        copyBtn.innerHTML = '<img src="images/copy-icon.png">';
        copyBtn.onclick = (e) => {
            clipboard.writeText(shortcut.prompt);
        };
        item.querySelector('.atajo-li').insertBefore(copyBtn, item.querySelector('.atajo-li').firstChild);

        list.appendChild(item);
    });
}

function clearForm() {
    document.getElementById('index').value = '';
    document.getElementById('key').value = '';
    document.getElementById('ctrl').checked = true;
    document.getElementById('shift').checked = true;
    document.getElementById('alt').checked = true;
    document.getElementById('prompt').value = '';
    document.getElementById('temperature').value = global_config.temperature;
    document.getElementById('temperatura-span').innerText = global_config.temperature;

    document.getElementById('add-btn').style.display = "inline-block";
    document.getElementById('edit-btn').style.display = "none";

    document.getElementById('cancel-btn').style.display = '';
}

function edit_shortcut(index) {
    let shortcut = shortcuts[index];
    document.getElementById('index').value = index;
    document.getElementById('key').value = shortcut.key;
    document.getElementById('ctrl').checked = shortcut.ctrl;
    document.getElementById('shift').checked = shortcut.shift;
    document.getElementById('alt').checked = shortcut.alt;
    document.getElementById('prompt').value = shortcut.prompt;
    document.getElementById('model').value = shortcut.model;
    document.getElementById('temperature').value = shortcut.temperature;
    document.getElementById('temperatura-span').innerText = shortcut.temperature;
    document.getElementById('edit-btn').style.display = "inline-block";
    document.getElementById('add-btn').style.display = "none";
    document.getElementById('cancel-btn').style.display = 'inline-block';
    window.scrollTo(0, document.body.scrollHeight);
}
document.getElementById('cancel-btn').addEventListener('click', () => clearForm());

Array.from(document.getElementsByClassName('global-settings-btn')).forEach((a) => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('global-config').style.display = 'flex';
    });
});

// Manejar envío del formulario para agregar un nuevo atajo
document.getElementById('shortcut-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const index = document.getElementById('index').value;
    const key = document.getElementById('key').value.trim();
    const ctrl = document.getElementById('ctrl').checked;
    const shift = document.getElementById('shift').checked;
    const alt = document.getElementById('alt').checked;
    const prompt = document.getElementById('prompt').value.trim() || '%s';
    const model = document.getElementById('model').value;
    const temperature = document.getElementById('temperature').value;

    if (index == "") {
        // Validate
        if (shortcuts.some(
            atajo =>
                atajo.ctrl === ctrl &&
                atajo.shift === shift &&
                atajo.alt === alt &&
                atajo.key === key
        )) {
            document.getElementById('key').focus();
            beep();
            return;
        }
        // Añadir nueva combinación de atajo 
        shortcuts.push({
            ctrl: ctrl,
            shift: shift,
            alt: alt,
            key: key,
            prompt: prompt,
            model: model,
            temperature: temperature
        });
    } else {
        // Validate
        if (shortcuts.some(
            (atajo, i) =>
                parseInt(index) !== i &&
                atajo.ctrl === ctrl &&
                atajo.shift === shift &&
                atajo.alt === alt &&
                atajo.key === key
        )) {
            edit_shortcut(index);
            beep();
            return;
        }
        // Editar combinación de atajo 
        shortcuts[index] = {
            ctrl: ctrl,
            shift: shift,
            alt: alt,
            key: key,
            prompt: prompt,
            model: model,
            temperature: temperature
        };
    }
    saveAndRender();
    clearForm();
});

// Guardar los atajos y renderizar la lista actualizada
function saveAndRender() {
    ipcRenderer.send('save-shortcuts', shortcuts);

    renderShortcuts();
}

document.getElementById('accept-confirm').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('del-confirm').style.display = 'none';
    shortcuts.splice(event.target.getAttribute('data-index'), 1);
    try {
        saveAndRender();
        clearForm();
    } catch (e) {
        alert(e.toString());
    }
});

document.getElementById('author-link').addEventListener('click', (event) => {
    ipcRenderer.send('external-link', 'https://len4m.github.io/?select2llm');
});




Array.from(document.getElementsByClassName('ollama-download-link')).forEach((element) => {
    element.addEventListener('click', (event) => {
        event.preventDefault();
        ipcRenderer.send('external-link', 'https://ollama.com/download');
    });
});


document.getElementById('key').addEventListener('focus', () => document.getElementById('key').select());

// bytes para humanos
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

// Disable selection in APP
disableSelect = (e) => { return false; };
reEnableSelect = () => { return true };
document.onselectstart = new Function("return false");
if (window.sidebar) {
    document.onmousedown = disableSelect;
    document.onclick = reEnableSelect;
}

function beep() {
    var snd = new Audio("data:audio/wav;base64,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qJrx4KOQjahZxWbcZgztj2c49nKmkId44S71j0c8eV9yDK6uPRzx5X18eDvjvQ6yKo9ZSS6l//8elePK/Lf//IInrOF/FvDoADYAGBMGb7FtErm5MXMlmPAJQVgWta7Zx2go+8xJ0UiCb8LHHdftWyLJE0QIAIsI+UbXu67dZMjmgDGCGl1H+vpF4NSDckSIkk7Vd+sxEhBQMRU8j/12UIRhzSaUdQ+rQU5kGeFxm+hb1oh6pWWmv3uvmReDl0UnvtapVaIzo1jZbf/pD6ElLqSX+rUmOQNpJFa/r+sa4e/pBlAABoAAAAA3CUgShLdGIxsY7AUABPRrgCABdDuQ5GC7DqPQCgbbJUAoRSUj+NIEig0YfyWUho1VBBBA//uQZB4ABZx5zfMakeAAAAmwAAAAF5F3P0w9GtAAACfAAAAAwLhMDmAYWMgVEG1U0FIGCBgXBXAtfMH10000EEEEEECUBYln03TTTdNBDZopopYvrTTdNa325mImNg3TTPV9q3pmY0xoO6bv3r00y+IDGid/9aaaZTGMuj9mpu9Mpio1dXrr5HERTZSmqU36A3CumzN/9Robv/Xx4v9ijkSRSNLQhAWumap82WRSBUqXStV/YcS+XVLnSS+WLDroqArFkMEsAS+eWmrUzrO0oEmE40RlMZ5+ODIkAyKAGUwZ3mVKmcamcJnMW26MRPgUw6j+LkhyHGVGYjSUUKNpuJUQoOIAyDvEyG8S5yfK6dhZc0Tx1KI/gviKL6qvvFs1+bWtaz58uUNnryq6kt5RzOCkPWlVqVX2a/EEBUdU1KrXLf40GoiiFXK///qpoiDXrOgqDR38JB0bw7SoL+ZB9o1RCkQjQ2CBYZKd/+VJxZRRZlqSkKiws0WFxUyCwsKiMy7hUVFhIaCrNQsKkTIsLivwKKigsj8XYlwt/WKi2N4d//uQRCSAAjURNIHpMZBGYiaQPSYyAAABLAAAAAAAACWAAAAApUF/Mg+0aohSIRobBAsMlO//Kk4soosy1JSFRYWaLC4qZBYWFRGZdwqKiwkNBVmoWFSJkWFxX4FFRQWR+LsS4W/rFRb/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////VEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU291bmRib3kuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjAwNGh0dHA6Ly93d3cuc291bmRib3kuZGUAAAAAAAAAACU=");
    snd.play();
}

const globalConfigDiv = document.getElementById('global-config');
globalConfigDiv.addEventListener('click', function (event) {
    // Si el div clickeado es exactamente el div exterior (no el interior)
    if (event.target === globalConfigDiv || event.target.classList.contains('global-config-close')) {
        globalConfigDiv.style.display = '';
    }
});

// Global config form:
const form = document.getElementById("global-config-form");
// Función para obtener los valores del formulario y generar el objeto
function getFormData() {
    const formData = new FormData(form);
    const data = {};
    formData.forEach((value, key) => {
        // Convertir "temperature" y "keep-alive" a números
        if (key === "temperature") {
            data[key] = parseFloat(value);
        } else if (key === "keep-alive") {
            data[key] = parseInt(value, 10);
        } else {
            data[key] = value;
        }
    });
    global_config = data;


    ipcRenderer.send('save-config', data);

    ipcRenderer.send('change-language', data.language);
    clearForm();

}
// Agregar event listener al formulario para detectar cambios
form.addEventListener("change", getFormData);

clearForm();


/* i18n */
// Solicitar y cargar una traducción específica
const langSelect = document.getElementById('global-config-language');

function updateText(data) {
    const { key, translation } = data;
    const elements = document.querySelectorAll(`[data-i18n="${key}"]`); // Selecciona todos los elementos que coinciden con la clave
    elements.forEach((element) => {
        element.textContent = translation;
    });
}

// Escuchar la respuesta de traducción y actualizar el DOM
ipcRenderer.on('translation', (event, data) => {
    updateText(data);
});

ipcRenderer.on('language-changed', (event, translations) => {
    loadAllTranslations()
});

function loadAllTranslations() {
    const htmlElements = document.querySelectorAll('[data-i18n-lan]');
    htmlElements.forEach((element) => {
        if (element.getAttribute('data-i18n-lan') === global_config.language) {
            element.style.display = 'block';
        } else {
            element.style.display = '';
        }
    });

    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach((element) => {
        const key = element.getAttribute('data-i18n');
        ipcRenderer.send('get-translation', key); // Solicitar traducción al proceso principal
    });
}


