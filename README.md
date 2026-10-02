# Jade

**A private, offline second brain for your documents.** Drop in your PDFs, notes,
slides and lecture recordings, then chat with them. Jade finds the relevant passages,
answers with citations, and maps how your sources connect. Everything runs on your
own computer: no account, no cloud, no API keys, and nothing leaves your machine.

## What it does

- **Chat with your sources.** Ask questions across a whole collection and get answers
  that cite the documents they came from.
- **Many file types.** PDF, Word, PowerPoint, Excel, Markdown, plain text and HTML, plus
  web pages by URL. Audio and video (`.mp3`, `.wav`, `.m4a`, `.mp4`) are transcribed
  locally with Whisper.
- **Connections and knowledge graph.** Jade spots related ideas across your documents
  and shows them as a graph.
- **Study guides.** Generate a guide for any collection.
- **Fully offline.** Language model, search and transcription all run locally through
  [Ollama](https://ollama.com), sentence-transformers and faster-whisper.

## System requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10/11, 64-bit | Windows 11 |
| RAM | 8 GB | 16 GB |
| GPU | Not required (runs on CPU, slower) | NVIDIA with 4 GB+ VRAM |
| Disk | 12 GB free | SSD |

Jade picks a model for your hardware automatically: **Gemma 2 2B** for most machines,
**Qwen2.5 7B** when an NVIDIA GPU has 6 GB or more of video memory. You can change it
in Settings.

> Windows only for now. The backend is cross-platform Python, but the launcher and
> build scripts currently target Windows.

## Run from source

### 1. Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [Python](https://www.python.org/downloads/) 3.11 or newer (tick "Add to PATH" during install)
- [Git](https://git-scm.com)
- Optional: [LibreOffice](https://www.libreoffice.org), only needed for old `.doc` / `.ppt` files

### 2. Get the code and install dependencies

```bash
git clone <this-repo-url> jade
cd jade
npm install
cd frontend
npm install
npm run build
cd ..
```

### 3. Set up the Python backend

```bash
cd python_backend
.\setup.bat
```

(Works in both PowerShell and Command Prompt. When it says "Setup complete", press any key to close it.)

This creates `python_backend\venv` and installs CPU-only PyTorch plus everything in
`requirements.txt`.

### 4. Download the embedding and transcription models

Still in `python_backend`:

```bash
venv\Scripts\python -c "from huggingface_hub import snapshot_download; [snapshot_download(r, cache_dir='models_cache/hub') for r in ('BAAI/bge-small-en-v1.5', 'Systran/faster-whisper-small')]"
```

This downloads about 600 MB into `python_backend\models_cache\hub`. After this, Jade
never needs the internet for search or transcription.

### 5. Add Ollama

Download `ollama-windows-amd64.zip` from the
[Ollama releases page](https://github.com/ollama/ollama/releases) and extract it into a
folder named `ollama` at the project root, so that `ollama\ollama.exe` exists.

### 6. Start Jade

From the project root:

```bash
npm start
```

On first launch:

- Jade asks **where to save your source files** (the documents you add). Pick any folder,
  or cancel to keep them inside Jade's data folder.
- It downloads its language model (Gemma 2 2B, about 1.6 GB) through Ollama.
- Startup takes a minute or two while the Python backend loads, and the **first answer**
  can take up to a minute while the model loads into memory. Later answers take seconds.

## Build a standalone app

Building produces a folder you can copy to any Windows PC, with Ollama and the models
bundled so it works with no internet at all.

1. Complete all the "Run from source" steps and launch Jade once, so the language
   model is downloaded.
2. Copy the downloaded models into the folder the build bundles:
   ```bash
   robocopy ollama\models ollama_models_dist /E
   ```
3. Build:
   ```bash
   powershell -ExecutionPolicy Bypass -File .\build.ps1
   ```

The app lands in `dist_electron\win-unpacked\`. Run `Jade.exe` from that folder (keep
the whole folder together). Expect around 5 to 10 GB depending on which models you
bundled.

For a **portable build** that keeps its data next to `Jade.exe` (handy on a USB SSD),
run `build-portable.ps1` instead. Output goes to `dist_electron_portable\win-unpacked\`.

### Heads-up for downloaded builds

- **Windows SmartScreen** will warn that the app is unrecognised because it isn't
  code-signed. Click **More info → Run anyway**.
- Some antivirus tools flag apps packaged with PyInstaller. This is a known false
  positive; building from source yourself avoids any doubt.

## Where your data lives

| Build | Library, chats and settings |
|---|---|
| Standard / from source | `%APPDATA%\jade` |
| Portable | `UserData\` next to `Jade.exe` |

Delete that folder to reset Jade completely. A log file, `launcher.log`, is written
there too and is the first place to look when something goes wrong.

## Project structure

```
main.js              Electron launcher: splash screen, starts Ollama and the backend
preload.js           Bridge between the window and Electron
frontend/            React + Vite + TypeScript interface
python_backend/      FastAPI backend: ingestion, search, chat, connections
  routers/           HTTP endpoints
  ingest.py          Text extraction, chunking and embedding
  connections.py     Cross-source connection finding
  transcribe.py      Audio/video transcription (faster-whisper)
build.ps1            Standard build
build-portable.ps1   Portable build
```

## Contributing

Issues and pull requests are welcome. If you report a bug, please attach your
`launcher.log` (see "Where your data lives"), and check it first for anything
personal such as file names.

## License

Jade's source code is released under the [MIT License](LICENSE). Packaged builds
bundle third-party software and AI models under their own licenses, including the
Gemma Terms of Use. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
