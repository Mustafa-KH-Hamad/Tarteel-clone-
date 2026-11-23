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
from quran_transcript import Aya, quran_phonetizer, explain_error
from quran_transcript.phonetics.moshaf_attributes import MoshafAttributes
from quran_transcript.phonetics.search import PhoneticSearch, NoPhonemesSearchResult

MODEL = os.environ.get("MUAALEM_MODEL", "obadx/muaalem-model-v3_2")
MAX_SECONDS = 15
torch.set_num_threads(max(1, os.cpu_count() or 1))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"   # free GPU on Google Colab, CPU elsewhere

engine = QuranMuaalemAPI(model_name_or_path=MODEL, dtype=torch.float32, max_audio_seconds=MAX_SECONDS)
engine.setup(DEVICE)

app = FastAPI(title="Tilawa Checker — Muaalem server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

NOTICE = ("This is an AI model and may make mistakes. It is an aid only and not a substitute "
          "for a proficient, authorised Quran teacher.")


searcher = PhoneticSearch()


def find_in_quran(phonemes: str, error_ratio: float):
    """Which part of the Quran was recited (best match), or None."""
    try:
        results = searcher.search(phonemes, error_ratio=error_ratio)
    except NoPhonemesSearchResult:
        return None
    if not results:
        return None
    r = results[0]
    span = lambda p: {"sura_idx": p.sura_idx, "aya_idx": p.aya_idx, "uthmani_word_idx": p.uthmani_word_idx}
    return {"start": span(r.start), "end": span(r.end), "uthmani_text": searcher.get_uthmani_from_result(r)}


def reference_from_hint(sura: int, aya_from: int, aya_to: int):
    """The app knows which ayah(s) you were reciting; use them when the search can't place the audio."""
    if not (1 <= sura <= 114) or aya_from < 1 or aya_to < aya_from or aya_to - aya_from > 3:
        return None
    try:
        texts = [Aya(sura, a).get().uthmani for a in range(aya_from, aya_to + 1)]
    except Exception:
        return None
    span = {"sura_idx": sura, "aya_idx": aya_from, "uthmani_word_idx": 0}
    return {"start": span, "end": {**span, "aya_idx": aya_to}, "uthmani_text": " ".join(texts), "from_hint": True}


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
    return {"ok": True, "model": MODEL, "device": DEVICE, "notice": NOTICE}


@app.post("/check")
async def check(
    file: UploadFile = File(...),
    madd_monfasel_len: int = Form(4),
    madd_mottasel_len: int = Form(4),
    madd_aared_len: int = Form(4),
    error_ratio: float = Form(0.15),
    sura: int = Form(0),
    aya_from: int = Form(0),
    aya_to: int = Form(0),
):
    t0 = time.time()
    data = await file.read()
    try:
        phonemes = transcribe(data)
    except Exception as e:  # e.g. audio longer than 15 s
        return {"found": False, "error": str(getattr(e, "detail", e))}
    if not phonemes:
        return {"found": False, "phonemes": "", "seconds": round(time.time() - t0, 2)}

    best = find_in_quran(phonemes, error_ratio)
    if best and sura and not (best["start"]["sura_idx"] == sura and aya_from - 1 <= best["start"]["aya_idx"] <= aya_to + 1):
        best = None                      # the search found a different place than the one being recited
    if not best and sura:
        best = reference_from_hint(sura, aya_from, aya_to)
    if not best:
        return {"found": False, "phonemes": phonemes, "seconds": round(time.time() - t0, 2)}
    moshaf = MoshafAttributes(
        rewaya="hafs",
        madd_monfasel_len=madd_monfasel_len,
        madd_mottasel_len=madd_mottasel_len,
        madd_mottasel_waqf=madd_mottasel_len,
        madd_aared_len=madd_aared_len,
    )
    text = best["uthmani_text"]
    ref = quran_phonetizer(text, moshaf, remove_spaces=True)
    reference = ref.phonemes
    errors = explain_error(uthmani_text=text, ref_ph_text=ref.phonemes, predicted_ph_text=phonemes, mappings=ref.mappings)

    out = []
    for e in errors:
        start = e.uthmani_pos[0]
        # Hamzat al-wasl at the start is only pronounced when you start there, not when you continue (wasl).
        if e.speech_error_type == "delete" and start == 0 and e.expected_ph.startswith("ء") and text[:1] in "ٱا":
            continue
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
        "start": best["start"],
        "end": best["end"],
        "uthmani_text": text,
        "from_hint": bool(best.get("from_hint")),
        "phonemes": phonemes,
        "reference": reference,
        "errors": out,
        "seconds": round(time.time() - t0, 2),
        "notice": NOTICE,
    }
