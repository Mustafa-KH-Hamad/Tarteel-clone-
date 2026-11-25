# CLAUDE.md — Tilawa Checker (project memory)

Read this first. It records everything decided so far, so work can continue after the chat is cleared.

## What this is
A **free** web app (made for the repo owner, who doesn't want to pay for Tarteel) that listens to Quran
recitation and flags mistakes, like the paid Tarteel app. Name: **Tilawa Checker**. Don't use Tarteel's
name, logo or look in the app (trademark); "Tarteel-clone-" is only the repo name.

- Live site: https://mustafa-kh-hamad.github.io/Tarteel-clone-/ (GitHub Pages, served from branch
  `ccr-5562aaa5-x58c0h`, root folder). Pushing to that branch redeploys within ~1–2 minutes.
- Work branch: `ccr-5562aaa5-x58c0h` (commit and push there; no PRs unless asked).
- Plain static site: no build step. `index.html`, `style.css`, `app.js`, `sw.js`, `asr-worker.js`, `data/`.

## The user
- Not a programmer; communicates in short English messages, tests on a Windows PC (Chrome, also uses
  Brave) and wants it to work on their phone too.
- **Will not pay** for anything (no paid hosting, no paid APIs). Willing to create free accounts and
  follow click-by-click steps.
- Wants: accuracy (no false mistakes), harakat checking, a real-mushaf look, clear mistake reports.
- Explain in plain language; say honestly what is tested and what isn't.

## Features (all implemented)
- Mushaf view: Uthmani text, 604 Madani pages (two-page spread ≥900px, one page on phones), surah
  banners, bismillah, ayah markers, juz in header, page numbers, swipe/arrow page turning.
- Navigation: surah, ayah, juz, hizb (240 quarters ¼ ½ ¾), page — all kept in sync.
- Recitation checking (Chrome/Edge/Safari): browser `SpeechRecognition` (`ar-SA`, continuous,
  interim, `maxAlternatives=5`). Words turn green / red (mistake) / orange (skipped) / grey dotted
  ("unsure": single word the engine probably dropped — not counted unless Strict).
- Going back to repeat earlier ayat is NOT a mistake (back-match with 2-word confirmation).
- Continues across surahs; ignores isti'adha/basmala/"sadaq Allah" at starts; handles muqatta'at
  (الم، يس…); engine word splits/merges; repeated words; extra inserted words.
- Live mistakes panel grouped by ayah (click → jumps to word), red counter badges on ayah markers,
  "✓ corrected" when fixed by repeating.
- Mistakes report (📋 button anytime, auto on Stop): per ayah, full ayah with highlights, word
  position, "you said X → correct Y". Full-screen sheet on phones. History tab: sessions, accuracy,
  most-missed words, "View mistakes report" per session (stored in localStorage).
- Listen: per-ayah audio from EveryAyah.com. Reciters: Yasser Al-Dosari (default), Al-Husary
  (murattal / mujawwad / muallim), Alafasy, Abdul Basit, Minshawi, Sudais, Shuraim, Muaiqly.
  Repeat ayah 1–10× or ∞, speed, stop at end of ayah/page/quarter/hizb/surah/juz/none,
  "Loop forever". **Gapless**: Web Audio API, next ayah pre-decoded, silence trimmed, scheduled
  back-to-back (measured 0.000 s gaps). Basmala (001001.mp3) before each surah except 1 and 9.
- Memorization mode (hide text), translation (Saheeh Intl) of current ayah, themes, font size,
  strictness (Lenient / Normal / Strict), PWA (installable, offline text).
- Brave/Firefox (no Google speech): on-device Quran Whisper model in `asr-worker.js`
  (transformers.js 3.8.1 from jsdelivr, model `aaqibhabib/whisper-base-ar-quran-onnx`, q8, ~105 MB,
  WebGPU only if an adapter exists, else WASM). Phrase-based (after pauses), slower, less exact.
  The user said "forget Brave for now".

## v19 additions
- UI languages English / Arabic / Kurdish Sorani (`I18N` in app.js, `data-t` attributes in index.html; ar/ckb set dir=rtl).
- Translation: English (Saheeh, local) or Kurdish (Burhan Muhammad Amin, fetched per surah from jsdelivr fawazahmed0/quran-api `kur-burhanmuhammada`).
- Tafsir panel: fetched per surah on demand from jsdelivr `spa5k/tafsir_api` (Kurdish Rebar/Mukhtasar, Arabic Mukhtasar/Sa'di/Ibn Kathir/Jalalayn, English ...); big surah files 403 on the CDN → falls back to per-ayah files. Cached in memory for the session.
- Volume slider 0–200% (Web Audio GainNode). Layout: mushaf first, then translation/tafsir, then controls.

## Harakat & tajweed check (beta) — how it works
- Google's engine returns words without harakat, so it can't check them.
- A Quran-trained Whisper "auto-corrects" to the true text, so it also can't catch harakat
  (tried and removed).
- Solution: the open **Quran Muaalem** model (`obadx/muaalem-model-v3_2`, MIT; package
  `quran-muaalem` 0.3.0 under QML 1.0, which requires an AI-advisory notice, no ads, free access —
  notice is in Settings and on the server). It transcribes the sounds actually made (phonetic script
  with harakat), finds the Quran span, and returns errors typed tashkeel / tajweed / normal.
- `server/app.py` (FastAPI): `GET /health`, `POST /check` (WAV ≤15 s, optional `sura`, `aya_from`,
  `aya_to` hint used when the phonetic search fails or disagrees). Uses quran_transcript
  `PhoneticSearch`, `quran_phonetizer`, `explain_error` directly. Skips the hamzat-al-wasl false alarm.
- Gotchas found by testing: `quran-muaalem` 0.3.0 needs **transformers < 4.58** (5.x removed an
  import); its own `app.serve` breaks with current FastAPI (`Form(enum=…)`), so we don't import it.
- Hosting: Hugging Face Docker/Gradio Spaces are now **paid** → use **Google Colab** (free):
  `server/tilawa_colab.ipynb` installs, writes app.py, starts uvicorn and a free Cloudflare quick
  tunnel, prints a `https://….trycloudflare.com` address. User uploads the notebook to Colab →
  Run all → pastes the address in app Settings → Test → ticks the check. The address changes each
  session; sessions end when the tab closes. GPU often unavailable — CPU works (~2–5 s per phrase).
  When regenerating the notebook, re-embed the current `server/app.py` into the `%%writefile` cell.
- Client side (`app.js`): when the check is on, a second mic capture (ScriptProcessor, 16 kHz,
  energy VAD) cuts phrases at pauses (1.5–13 s), sends WAV + ayah hint, maps server words to the
  app's words, and keeps only harakat / tajweed / wrong-letter errors on words recited in that
  phrase (drops "all-missing" words and missing-letter noise). Shown as purple/blue underlines,
  "Harakat / Tajweed / Letter" items, not counted in the score. A "Harakat check log" panel shows
  each phrase: what the AI heard vs the correct phonemes.
- Status: tested here with synthetic espeak audio (catches deliberate الحمدَ / العالِمين). **The user
  reported it still doesn't flag their real harakat mistakes**; I asked for a screenshot of the
  Harakat check log to diagnose (not received yet). Possible causes to check: Android Chrome may not
  share the mic between SpeechRecognition and getUserMedia; Colab URL changed; phrase filtering.

## Accuracy decisions (don't undo without reason)
- Mistakes are judged only on FINAL speech results; interim results may only turn clearly-matching
  words green (`softFeed`). Earlier "commit interim words" caused false mistakes.
- A mismatched last word waits for the next word (`pending`) before being judged.
- Fuzzy word match: diacritics stripped, alef/ya/ta-marbuta normalized, "skeleton" without ا و ي,
  Levenshtein tolerance by strictness. Whole-Quran self-test: 77,429 words, 0 false mistakes.

## Data & credits
- `data/quran.json`: Uthmani text (quranenc.com) + Saheeh International, from npm `quran-json`
  (CC BY-SA 4.0, licence in `data/`).
- `data/meta.json`: page starts (`pages`, 605 incl. sentinel), juz starts (`juz`), hizb quarter starts
  (`hizbQ`, 241 incl. sentinel) — 1-based global ayah numbers, from npm `quran-meta` (MIT).
- Audio: EveryAyah.com (`https://everyayah.com/data/<Reciter>/<SSS><AAA>.mp3`, CORS allowed).

## Conventions & gotchas
- Bump cache-busting together on every front-end change: `?v=N` on style.css/app.js in index.html
  and `CACHE = "tilawa-vN"` in sw.js (current: v19). Without it users get old JS with new HTML.
- Service worker is network-first and ignores cross-origin requests.
- Tests are ad-hoc Playwright scripts (Chromium preinstalled) that mock `SpeechRecognition` and call
  `feed()`, `jumpTo()`, `applyServerResult()` etc. via `page.evaluate`; serve with
  `python3 -m http.server`. Always re-run the whole-Quran self-test after changing matching.
- Cloud environment "Tarteel-clone-" (personal) allows: huggingface.co + its CDNs
  (cdn-lfs*, us.aws.cdn.hf.co, cas-server/cas-bridge/transfer.xethub.hf.co), cdn.jsdelivr.net,
  everyayah.com. Colab and trycloudflare are not reachable from here.
- Don't commit `__pycache__` (in .gitignore). Commit trailer lines are required by the harness.

## Open items / ideas
- Diagnose the harakat check with the user's real recitation (needs their log screenshot).
- Possibly: sync highlighted word to audio (word timings), offline audio caching, Brave accuracy.
