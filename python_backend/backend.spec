# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Collect binary packages that hiddenimports alone can't handle
fitz_d,    fitz_b,    fitz_h    = collect_all('fitz')
docx_d,    docx_b,    docx_h    = collect_all('docx')
pptx_d,    pptx_b,    pptx_h    = collect_all('pptx')
openpyxl_d,openpyxl_b,openpyxl_h = collect_all('openpyxl')
bs4_d,     bs4_b,     bs4_h     = collect_all('bs4')
httpx_d,   httpx_b,   httpx_h   = collect_all('httpx')

all_datas    = [
    ('routers', 'routers'),
    ('venv/Lib/site-packages/faster_whisper/assets', 'faster_whisper/assets'),
] + fitz_d + docx_d + pptx_d + openpyxl_d + bs4_d + httpx_d
all_binaries = fitz_b + docx_b + pptx_b + openpyxl_b + bs4_b + httpx_b

a = Analysis(
    ['main.py'],
    pathex=[str(Path('.').resolve())],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=[
        # FastAPI / Starlette / uvicorn
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'anyio',
        'anyio._backends._asyncio',
        'anyio.abc',
        # ML
        'torch',
        'torch.nn',
        'numpy',
        'numpy.core._methods',
        'numpy.lib.format',
        'sklearn',
        'sklearn.utils._cython_blas',
        'sklearn.neighbors._partition_nodes',
        'sentence_transformers',
        'transformers',
        'huggingface_hub',
        # faster-whisper / audio
        'faster_whisper',
        'ctranslate2',
        # DB
        'sqlite3',
        # HTTP
        'multipart',
        'aiofiles',
    ] + fitz_h + docx_h + pptx_h + openpyxl_h + bs4_h + httpx_h,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'IPython', 'jupyter'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=True,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='backend',
)
