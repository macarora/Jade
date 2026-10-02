import logging
import asyncio
import os
from pathlib import Path
from config import MODEL_CONFIG

logger = logging.getLogger(__name__)

_model = None

_progress: dict[str, float] = {}
_cancel_flags: dict[str, bool] = {}

def get_progress(source_id: str) -> float | None:
    return _progress.get(source_id)

def request_cancel(source_id: str) -> None:
    _cancel_flags[source_id] = True


def _resolve_whisper_path(size: str) -> str:
    """Return local snapshot path for the bundled Whisper model, or fall back to size string."""
    models_cache = os.environ.get("JADE_MODELS_CACHE", "")
    if models_cache:
        repo_id = f"Systran/faster-whisper-{size}"
        folder = "models--" + repo_id.replace("/", "--")
        snapshots_dir = Path(models_cache) / "hub" / folder / "snapshots"
        if snapshots_dir.exists():
            children = list(snapshots_dir.iterdir())
            if children:
                return str(children[0])
    return size


def _load_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        whisper_size = MODEL_CONFIG.get("whisper", "base")
        model_path = _resolve_whisper_path(whisper_size)
        logger.info(f"[Transcribe] Loading Whisper {whisper_size} from {model_path}...")
        _model = WhisperModel(model_path, device="cpu", compute_type="int8")
        logger.info("[Transcribe] Whisper ready.")
    return _model


_SAMPLE_RATE = 16000
_CHUNK_SEC   = 1800  # 30 minutes — keeps per-chunk STFT under ~300 MB


def _load_full_audio(path: str):
    """Decode the entire audio/video file to 16 kHz mono float32 via PyAV."""
    import av
    import numpy as np

    container = av.open(path)
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=_SAMPLE_RATE)
    chunks = []

    for frame in container.decode(audio=0):
        for out_frame in resampler.resample(frame):
            chunks.append(out_frame.to_ndarray()[0])

    # flush resampler
    for out_frame in resampler.resample(None):
        chunks.append(out_frame.to_ndarray()[0])

    container.close()
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


async def transcribe_file(path: str, source_id: str | None = None) -> str:
    """
    Transcribe an audio or video file. Runs in a thread pool to avoid
    blocking the async event loop during CPU-intensive inference.
    """
    logger.info(f"[Transcribe] Starting: {Path(path).name}")
    try:
        text = await asyncio.to_thread(_transcribe_sync, path, source_id)
        logger.info(f"[Transcribe] Done: {len(text)} chars from {Path(path).name}")
        return text
    finally:
        if source_id:
            _progress.pop(source_id, None)
            _cancel_flags.pop(source_id, None)


def _transcribe_sync(path: str, source_id: str | None = None) -> str:
    import numpy as np

    model = _load_model()

    logger.info(f"[Transcribe] Decoding audio: {Path(path).name}")
    audio = _load_full_audio(path)

    total_samples  = len(audio)
    total_duration = total_samples / _SAMPLE_RATE
    chunk_samples  = _CHUNK_SEC * _SAMPLE_RATE
    n_chunks = max(1, -(-total_samples // chunk_samples))  # ceiling division

    logger.info(f"[Transcribe] Duration {total_duration/60:.1f} min -> {n_chunks} chunk(s)")

    parts: list[str] = []
    detected_language: str | None = None

    for i in range(n_chunks):
        # honour cancellation between chunks
        if source_id and _cancel_flags.get(source_id):
            raise RuntimeError("Transcription cancelled by user")

        start = i * chunk_samples
        chunk = audio[start : start + chunk_samples]
        chunk_offset_sec = start / _SAMPLE_RATE

        logger.info(f"[Transcribe] Chunk {i+1}/{n_chunks} offset={chunk_offset_sec/60:.1f}min")

        segments, info = model.transcribe(
            chunk,
            beam_size=3,
            language=detected_language,   # None on first chunk → auto-detect
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )

        # lock in language after first chunk to skip per-chunk detection overhead
        if detected_language is None and getattr(info, "language", None):
            detected_language = info.language
            logger.info(f"[Transcribe] Language detected: {detected_language}")

        for seg in segments:
            if source_id and _cancel_flags.pop(source_id, False):
                raise RuntimeError("Transcription cancelled by user")
            text = seg.text.strip()
            if text:
                parts.append(text)
            if source_id:
                global_pos = chunk_offset_sec + seg.end
                _progress[source_id] = min(global_pos / total_duration, 0.99)

    return " ".join(parts)
