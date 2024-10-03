const { clipboard, ipcRenderer } = require('electron');

const platform = process.platform;
let shortcuts = [];
let models = [];

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

// Manejar envío del formulario para agregar un nuevo atajo
document.getElementById('shortcut-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const key = document.getElementById('key').value.trim();
    const ctrl = document.getElementById('ctrl').checked;
    const shift = document.getElementById('shift').checked;
    const alt = document.getElementById('alt').checked;
    const prompt = document.getElementById('prompt').value.trim() || '%s';
    const model = document.getElementById('model').value;

    // Añadir nueva combinación de atajo con prompt
    shortcuts.push({
        ctrl: ctrl,
        shift: shift,
        alt: alt,
        key: key,
        prompt: prompt,
        model: model
    });
    saveAndRender();

    // Limpiar formulario
    document.getElementById('key').value = '';
    document.getElementById('ctrl').checked = true;
    document.getElementById('shift').checked = true;
    document.getElementById('alt').checked = true;
    document.getElementById('prompt').value = '';
});

// Guardar los atajos y renderizar la lista actualizada
function saveAndRender() {
    ipcRenderer.send('save-shortcuts', shortcuts);
    renderShortcuts();
}
document.getElementById('cancer-confirm').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('del-confirm').style.display = 'none';
});
document.getElementById('accept-confirm').addEventListener('click', (event) => {
    event.preventDefault();
    shortcuts.splice(event.target.getAttribute('data-index'), 1);
    saveAndRender();
    document.getElementById('del-confirm').style.display = 'none';
});



document.getElementById('author-link').addEventListener('click', (event) => {
    ipcRenderer.send('external-link', 'https://len4m.github.io/?select2llm');
});

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


switch (navigator.language.substring(0, 2)) {
    case "es":

        break;
    case "ca":

        break;
    default:

}