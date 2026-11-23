"""Tilawa Checker — recitation-correction server for a free Hugging Face Space.

Runs the open Quran Muaalem model (obadx/muaalem-model-v3_2, MIT; package quran-muaalem, QML 1.0)
on the CPU. The web app sends a short recording (one phrase / ayah, max 15 s); the server
1. transcribes it into the Quranic phonetic script (sounds actually pronounced, including harakat),
2. finds which part of the Quran was recited,
3. compares it with the correct recitation (Hafs) and returns each harakat / tajweed / letter error.

AI notice (required by the QML licence): this is an AI model and may make mistakes. It is an aid
only and is not a substitute for a proficient, authorised Quran teacher (mushafahah).
"""
import io
import os
import time

import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from quran_muaalem.engine.serve import QuranMuaalemAPI
from quran_muaalem.app.serve import run_phonetic_search, run_phonetization_and_error
from quran_transcript.phonetics.moshaf_attributes import MoshafAttributes

MODEL = os.environ.get("MUAALEM_MODEL", "obadx/muaalem-model-v3_2")
MAX_SECONDS = 15
torch.set_num_threads(max(1, os.cpu_count() or 1))

engine = QuranMuaalemAPI(model_name_or_path=MODEL, dtype=torch.float32, max_audio_seconds=MAX_SECONDS)
engine.setup("cpu")

app = FastAPI(title="Tilawa Checker — Muaalem server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

NOTICE = ("This is an AI model and may make mistakes. It is an aid only and not a substitute "
          "for a proficient, authorised Quran teacher.")


class _Upload:
    def __init__(self, data: bytes):
        self.file = io.BytesIO(data)


def transcribe(data: bytes) -> str:
    x = engine.decode_request(_Upload(data))
    out = engine.predict(engine.batch([x]))
    return engine.encode_response(engine.unbatch(out)[0])["phonemes"]


@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "notice": NOTICE}


@app.post("/check")
async def check(
    file: UploadFile = File(...),
    madd_monfasel_len: int = Form(4),
    madd_mottasel_len: int = Form(4),
    madd_aared_len: int = Form(4),
    error_ratio: float = Form(0.15),
):
    t0 = time.time()
    data = await file.read()
    try:
        phonemes = transcribe(data)
    except Exception as e:  # e.g. audio longer than 15 s
        return {"found": False, "error": str(getattr(e, "detail", e))}
    if not phonemes:
        return {"found": False, "phonemes": "", "seconds": round(time.time() - t0, 2)}

    results, message = run_phonetic_search(phonemes, error_ratio)
    if not results:
        return {"found": False, "phonemes": phonemes, "message": message, "seconds": round(time.time() - t0, 2)}

    best = results[0]
    moshaf = MoshafAttributes(
        rewaya="hafs",
        madd_monfasel_len=madd_monfasel_len,
        madd_mottasel_len=madd_mottasel_len,
        madd_mottasel_waqf=madd_mottasel_len,
        madd_aared_len=madd_aared_len,
    )
    reference, errors = run_phonetization_and_error(best.uthmani_text, moshaf, phonemes)
    text = best.uthmani_text

    out = []
    for e in errors:
        start = e.uthmani_pos[0]
        rules = []
        for group in (e.ref_tajweed_rules, e.replaced_tajweed_rules, e.missing_tajweed_rules, e.inserted_tajweed_rules):
            for r in group or []:
                rules.append({"ar": r.name.ar, "en": r.name.en})
        out.append({
            "type": e.error_type,                    # tashkeel | tajweed | normal
            "speech": e.speech_error_type,           # insert | delete | replace
            "word_offset": text[:start].count(" "),  # which word of `uthmani_text`
            "expected": e.expected_ph,
            "heard": e.preditected_ph,
            "expected_len": e.expected_len,
            "heard_len": e.predicted_len,
            "rules": rules,
        })

    return {
        "found": True,
        "start": best.start.model_dump(),
        "end": best.end.model_dump(),
        "uthmani_text": text,
        "phonemes": phonemes,
        "reference": reference,
        "errors": out,
        "seconds": round(time.time() - t0, 2),
        "notice": NOTICE,
    }
