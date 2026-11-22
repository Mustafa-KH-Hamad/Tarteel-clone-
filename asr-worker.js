// On-device Quran speech recognition, used when the browser has no built-in speech service (Brave, Firefox…).
// Runs a Whisper model fine-tuned on Quran recitation (tarteel-ai/whisper-base-ar-quran, Apache-2.0),
// converted to ONNX, fully inside the browser. The model is downloaded once and then cached by the browser.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
const MODEL = "aaqibhabib/whisper-base-ar-quran-onnx";
let asr = null;
// Stop the model from looping on noise ("…المسلم المسلم المسلم…") and from running past its limit.
const GEN = { max_new_tokens: 96, no_repeat_ngram_size: 3, num_beams: 1 };

async function load() {
  const progress = p => {
    if (p.status === "progress" && p.total) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  };
  // Use the graphics card (WebGPU) only if one is really available; otherwise the CPU (WebAssembly).
  let gpu = false;
  try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch {}
  const devices = gpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastErr;
  for (const device of devices) {
    try {
      asr = await pipeline("automatic-speech-recognition", MODEL, {
        device, dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q8" } : "q8",
        progress_callback: progress
      });
      // Warm up so the first real chunk is fast.
      await asr(new Float32Array(16000));
      postMessage({ type: "ready", device });
      return;
    } catch (e) { lastErr = e; asr = null; }
  }
  postMessage({ type: "error", message: String(lastErr && lastErr.message || lastErr) });
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === "load") { if (!asr) await load(); else postMessage({ type: "ready" }); return; }
  if (m.type === "transcribe" && asr) {
    const t0 = performance.now();
    try {
      const out = await asr(m.audio, GEN);
      postMessage({ type: "text", id: m.id, text: (out.text || "").trim(), ms: Math.round(performance.now() - t0) });
    } catch (err) { postMessage({ type: "text", id: m.id, text: "", error: String(err.message || err) }); }
  }
};
