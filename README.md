# Select2LLM

**Select2LLM** lets you send selected text to [Ollama](https://ollama.com) with a shortcut and paste the result back, making translations, corrections, summaries and code tasks fast and simple.

![Interface Image](image.png)

## Features

- **Send selected text with a shortcut** to your preferred Ollama model.
- **Multiple shortcuts and prompts** configured by the user to cover different workflows.
- **Simple in‑app settings** (language, temperature, UI zoom, etc.).
- **Model list** shown in alphabetical order.
- **Thinking filter** for reasoning models (shows only the final answer).
- **Light/Dark themes** and **multilingual UI** (English, Spanish, Catalan).
- **Quick cancel** from tray icon or overlay button.

## System Requirements

- **Linux**: 
  - For **X11**, it requires `xclip` and `xdotool`.
  - For **Wayland**, it requires `wtype` and `ydotool`.
- **Windows**: **PowerShell** must be installed and enabled.
- **macOS**: Support is planned for future versions.

## Installation

### 1. Dependencies

- **Ollama** with at least one model:
  ```bash
  ollama pull llama3.2
  ```
- **Linux** packages:
  - X11: `sudo apt-get install xclip xdotool`
  - Wayland (e.g. Fedora): `sudo dnf install wtype ydotool`
- **Windows**: Ensure PowerShell is installed and enabled.

### 2. Installing Select2LLM

1. **Clone**
   ```bash
   git clone https://github.com/Len4m/select2llm.git
   ```
2. **Install**
   ```bash
   cd select2llm && npm install
   ```
3. **Run / Build**
   ```bash
   npm start
   # or
   npm run build
   ```

## Configuration

### Shortcut and Prompt Configuration

Manage everything from the app. Advanced users can edit `~/.select2llm/shortcuts.json`:
```json
[
  {
    "ctrl": true,
    "shift": true,
    "alt": true,
    "key": "t",
    "prompt": "Translate the following text to English. Return only the English translation without any additional comments or explanations:",
    "model": "llama3.2:latest",
    "temperature": 0.7,
    "overlay": true
  }
]
```

### Global Configuration

Global settings in `~/.select2llm/config.json`:
```json
{
  "language": "en",
  "temperature": 0.8,
  "keep-alive": 5,
  "host": "http://127.0.0.1:11434",
  "uiZoom": 100
}
```

## How to Use

1. Select any text on your computer.
2. Use a configured keyboard shortcut to send the selected text to the pre-configured LLM in Ollama.
3. The processed response will be automatically pasted.

> **Important**
> - Do not interact with or move focus away from the destination application while Select2LLM is typing; losing focus can cause unexpected behavior.
> - You can cancel the current streaming/typing process by double-clicking the tray icon or using the cancel button in the overlay window.

## Recent Technical Improvements

- **Smart Thinking Filtering**: Automatically detects and filters content between `<think>` and `</think>` tags from models with reasoning capabilities.
- **Service-Oriented Architecture**: The application has been refactored with a modular and robust architecture, improving communication with Ollama, configuration management, and error handling.
- **Model Organization**: Models are now displayed alphabetically for easier navigation.
- **Accessibility and Usability**: Includes an interface zoom slider for better readability, with changes applied in real-time.
- **UI/UX improvements**: Polished configuration interface with light and dark themes.
- **Multilingual interface**: Available in English, Spanish and Catalan.
- **Quick cancellation**: Double-click the tray icon or use the overlay cancel button to stop streaming.

## Contributing

**Select2LLM** is my first application in [Electron](https://www.electronjs.org/), so there are likely bugs and areas for improvement. All contributions are welcome!

## Future Enhancements

- **Cross-platform support**: Improve Windows support and complete macOS.
- **Output options**: Choose between simulated typing or clipboard paste.
- **Automatic updates**: Built-in auto-update system.

## License

This project is licensed under the **GPL-3** License. See the `LICENSE` file for more details.
