# Third-party notices

Jade's own source code is MIT-licensed (see `LICENSE`). Packaged builds of Jade
also bundle the third-party software and AI models below. Each remains under its
own license; if you redistribute a Jade build, you must keep these notices.

## Runtimes

| Component | Used for | License |
|---|---|---|
| [Ollama](https://github.com/ollama/ollama) | Runs the local language model | MIT |
| [Electron](https://github.com/electron/electron) | Desktop shell | MIT |
| [Python](https://www.python.org/) (bundled via PyInstaller) | Backend runtime | PSF License |
| [PyTorch](https://github.com/pytorch/pytorch) | Embedding model runtime | BSD-3-Clause |
| [sentence-transformers](https://github.com/UKPLab/sentence-transformers) | Embeddings | Apache 2.0 |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Audio/video transcription | MIT |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | PDF text extraction | **AGPL-3.0** (see note below) |
| [FastAPI](https://github.com/fastapi/fastapi), [Uvicorn](https://github.com/encode/uvicorn) | Backend web server | MIT / BSD-3-Clause |
| [React](https://github.com/facebook/react), [Vite](https://github.com/vitejs/vite), [Lucide](https://github.com/lucide-icons/lucide) | Interface | MIT / MIT / ISC |

Full license texts for npm and pip packages are included in each package's
folder under `node_modules/` and the Python environment.

**Note on PyMuPDF:** PyMuPDF is licensed under the GNU AGPL-3.0 (or a commercial
license from Artifex). Jade's own code stays MIT, but a *packaged build* that
bundles PyMuPDF is subject to the AGPL's terms when distributed, which this
project satisfies by publishing its complete source code. If you build a
closed-source product from Jade, replace PyMuPDF (for example with `pypdf`) or
obtain a commercial license.

## AI models

| Model | Used for | License |
|---|---|---|
| [Gemma 2 2B](https://ai.google.dev/gemma) (`gemma2:2b`) | Default chat model (GPUs under 6 GB) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) |
| [Qwen2.5 7B Instruct](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) (`qwen2.5:7b`) | Chat model on stronger GPUs | Apache 2.0 |
| [BAAI bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) | Document embeddings (search) | MIT |
| [Whisper small](https://github.com/openai/whisper) ([faster-whisper conversion](https://huggingface.co/Systran/faster-whisper-small)) | Transcribing audio and video | MIT |

### Gemma

Gemma is provided under and subject to the Gemma Terms of Use found at
<https://ai.google.dev/gemma/terms>. Use of Gemma is also subject to the Gemma
Prohibited Use Policy at <https://ai.google.dev/gemma/prohibited_use_policy>.
By using a Jade build that includes Gemma, you agree to those terms.
