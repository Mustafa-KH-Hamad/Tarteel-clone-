---
title: Tilawa Muaalem
emoji: 📖
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# Tilawa Checker — recitation correction server

**Free way to run it:** open `tilawa_colab.ipynb` in Google Colab (free GPU) and press *Run all*; it prints a
`https://….trycloudflare.com` address to paste into the app (Settings → Harakat & tajweed check).
The Dockerfile is for Hugging Face Docker Spaces (now a paid feature) or any Docker host.

Backend for the free Tilawa Checker web app. It runs the open
[Quran Muaalem](https://github.com/obadx/quran-muaalem) model
([obadx/muaalem-model-v3_2](https://huggingface.co/obadx/muaalem-model-v3_2)) to detect
harakat (tashkeel), tajweed and letter mistakes in a recitation.

- `GET /health` — check the server is running
- `POST /check` — form field `file` (WAV, 16 kHz mono, max 15 s). Returns the recited Quran span and a list of errors.

> **AI notice:** this is an AI model and may make mistakes. It is an aid only and is not a
> substitute for a proficient, authorised Quran teacher; the Quran is received through
> oral transmission (mushafahah).

Licences: model MIT; `quran-muaalem` package under the Quran Muaalem License (QML 1.0),
which requires this notice, no advertisements, and free access.
