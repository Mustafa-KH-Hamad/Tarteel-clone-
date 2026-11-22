# Tilawa Checker — free Quran recitation checker

A free web app: choose a surah, press **Start**, and recite. Each word turns
**green** when correct, **red** when wrong, and **orange** when skipped. Mistakes
are counted through the session and saved to your history.

![screenshot](screenshot.png)

## Features
- All 114 surahs (Uthmani script) with optional English translation
- Start from any ayah, or tap any word to start from there
- Live mistake detection with beep and vibration, plus a mistake list for each session
- Memorization mode (hides the text and reveals it as you recite)
- History: past sessions, accuracy, and the words you miss most often
- Handles isti'adha/basmala before reciting, repeated words, and disconnected letters (الم، يس…)
- Installable on your phone's home screen; the Quran text works offline

## Limits
- Uses the browser's built-in speech recognition (best in **Google Chrome**), which needs internet.
- It checks **words**, not tajweed or small vowel (haraka) mistakes, and can sometimes mishear a word.
  If you get false alarms, set *Strictness* to *Lenient* in Settings.

## Run it
It is a static site; there is no build step. Host it with GitHub Pages
(Settings → Pages → choose this branch and `/ (root)`), or run it locally with
`python3 -m http.server` and open http://localhost:8000.

## Credits
Quran text: The Noble Qur'an Encyclopedia (quranenc.com); translation: Saheeh International,
via the open [quran-json](https://github.com/risan/quran-json) dataset (CC BY-SA 4.0, see `data/LICENSE-quran-json.txt`).
