"use strict";
/* Tilawa Checker — free Quran recitation checker.
   Flow: load Quran text + mushaf page layout -> build one list of every word in the Quran ->
   render the current page spread -> browser speech recognition (Arabic) -> each recognised word
   is aligned with the expected word -> mark correct / mistake / skipped. */

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ---------- Arabic normalisation & fuzzy matching ---------- */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function key(s) {
  return s.replace(/ٰ/g, "ا")            // dagger alef -> alef (الرحمٰن -> الرحمان)
    .replace(DIACRITICS, "")
    .replace(/[ٱأإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "")
    .replace(/[^ء-ي]/g, "");
}
// "Skeleton": drop long vowels so Uthmani spellings (الصلوة / الصلاة, العلمين / العالمين) compare equal.
const skel = k => k.replace(/[اوي]/g, "");
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const c = [i];
    for (let j = 1; j <= b.length; j++)
      c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[b.length];
}
function same(expKey, heardKey) {
  if (!expKey || !heardKey) return false;
  if (expKey === heardKey) return true;
  // The on-device model is less exact than Google's engine, so "Normal" is a bit more forgiving there.
  const strict = settings.strict === 1 && useLocal() ? 0 : settings.strict;
  const a = skel(expKey), b = skel(heardKey);
  if (!a || !b) return a === b && lev(expKey, heardKey) <= (strict === 2 ? 0 : 2); // words made only of ا/و/ي
  if (a === b) return strict < 2 || expKey.length <= 3;
  if (strict === 2) return false;
  const tol = strict === 0 ? (a.length >= 7 ? 2 : a.length >= 4 ? 1 : 0) : (a.length >= 8 ? 2 : a.length >= 5 ? 1 : 0);
  return tol > 0 && lev(a, b) <= tol;
}

/* ---------- Settings ---------- */
const settings = Object.assign({ trans: false, sound: true, vibrate: true, reveal: true, font: 26, strict: 1, memo: false, theme: "", engine: "auto" },
  store.get("settings", {}));
function saveSettings() { store.set("settings", settings); applySettings(); }
function applySettings() {
  const root = document.documentElement;
  root.style.setProperty("--qfont", settings.font + "px");
  if (settings.theme) root.dataset.theme = settings.theme; else delete root.dataset.theme;
  $("book").classList.toggle("memo", settings.memo);
  $("memoBtn").classList.toggle("active", settings.memo);
  $("transPanel").style.display = settings.trans ? "" : "none";
  $("optTrans").checked = settings.trans; $("optSound").checked = settings.sound;
  $("optVibrate").checked = settings.vibrate; $("optReveal").checked = settings.reveal;
  $("optFont").value = settings.font; $("optStrict").value = settings.strict; $("optTheme").value = settings.theme; $("optEngine").value = settings.engine;
  showTranslation();
}

/* ---------- Quran model ---------- */
let QURAN = null, META = null;
const ayahs = [];        // {s, a, w0, w1}   (global ayah index)
const words = [];        // {text, key, s, a, g, muq, first, state, el}
let pageOfAyah = [];     // global ayah index -> page number (1..604)
const MUQATTAAT = new Set(["الم","المص","الر","المر","كهيعص","طه","طسم","طس","يس","ص","حم","عسق","ق","ن"].map(key));
const OPENING = new Set(["اعوذ","بالله","من","الشيطان","الرجيم","بسم","الله","الرحمن","الرحمان","الرحيم","صدق","العظيم"].map(k => skel(key(k))));

function buildModel() {
  QURAN.forEach((s, si) => s.v.forEach(([ar], ai) => {
    const g = ayahs.length, w0 = words.length;
    let last = null, n = 0;
    for (const tok of ar.split(/\s+/).filter(Boolean)) {
      const k = key(tok);
      if (!k) { if (last) last.text += " " + tok; continue; }   // waqf sign: attach to previous word
      last = { text: tok, key: k, s: si, a: ai, g, state: "", el: null,
        first: ai === 0 && n === 0, muq: ai <= 1 && n === 0 && MUQATTAAT.has(k) };
      words.push(last); n++;
    }
    ayahs.push({ s: si, a: ai, w0, w1: words.length });
  }));
  const starts = META.pages;                    // 1-based global ayah number where each page starts (+ sentinel)
  pageOfAyah = new Array(ayahs.length);
  for (let p = 0; p < starts.length - 1; p++)
    for (let g = starts[p] - 1; g < starts[p + 1] - 1; g++) pageOfAyah[g] = p + 1;
}
const ayahIndex = (s, a) => QURAN.slice(0, s).reduce((n, x) => n + x.v.length, 0) + a;
const juzOf = g => { let j = 0; while (j + 1 < META.juz.length - 1 && META.juz[j + 1] - 1 <= g) j++; return j + 1; };
const arNum = n => n.toLocaleString("ar-EG");

/* ---------- Mushaf rendering (two-page spread on wide screens) ---------- */
let shownPages = [], rendered = [], curEl = null;
const isWide = () => window.innerWidth >= 900;
const spreadFor = p => isWide() ? (p % 2 ? [p, p + 1] : [p - 1, p]).filter(x => x >= 1 && x <= 604) : [p];

function renderPage(p, side) {
  const page = document.createElement("article");
  page.className = "page " + side;
  const g0 = META.pages[p - 1] - 1, g1 = META.pages[p] - 1;
  const firstSurah = QURAN[ayahs[g0].s];
  page.innerHTML = `<div class="frame"><div class="page-head"><span>سورة ${firstSurah.n}</span><span>الجزء ${arNum(juzOf(g0))}</span></div>
    <div class="page-body"></div><div class="page-foot"><span>${arNum(p)}</span></div></div>`;
  const body = page.querySelector(".page-body");
  for (let g = g0; g < g1; g++) {
    const ay = ayahs[g];
    if (ay.a === 0) {
      const b = document.createElement("div"); b.className = "surah-banner"; b.textContent = "سورة " + QURAN[ay.s].n;
      body.append(b);
      if (ay.s !== 0 && ay.s !== 8) { const bs = document.createElement("span"); bs.className = "bismillah"; bs.textContent = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ"; body.append(bs); }
    }
    for (let i = ay.w0; i < ay.w1; i++) {
      const w = words[i], el = document.createElement("span");
      el.className = "w" + (w.state ? " " + w.state : ""); el.textContent = w.text; el.dataset.i = i;
      w.el = el; decorate(w); rendered.push(i); body.append(el, " ");
    }
    const end = document.createElement("span"); end.className = "aya-end"; end.textContent = arNum(ay.a + 1);
    ay.endEl = end; ayahBadge(g); body.append(end, " ");
  }
  return page;
}

function showPage(p) {
  p = Math.min(604, Math.max(1, p));
  const pages = spreadFor(p);
  if (pages.join() === shownPages.join()) return;
  rendered.forEach(i => { words[i].el = null; ayahs[words[i].g].endEl = null; }); rendered = []; curEl = null;
  const book = $("book"); book.innerHTML = "";
  pages.forEach((pg, k) => book.append(renderPage(pg, pages.length === 1 ? "single" : k === 0 ? "right" : "left")));
  shownPages = pages;
  $("pgPrev").disabled = pages[0] <= 1; $("pgNext").disabled = pages[pages.length - 1] >= 604;
  highlightCurrent(false);
}
const turn = dir => showPage(dir > 0 ? shownPages[shownPages.length - 1] + 1 : shownPages[0] - 1);

/* ---------- Session state ---------- */
let ptr = 0, startPtr = 0, stats, mistakes, freeHeard = 0, pending = [], touched = new Set();
function resetStats() { stats = { ok: 0, bad: 0, skip: 0 }; mistakes = []; freeHeard = 0; pending = []; }

function setStart(i) {
  const gs = new Set();
  touched.forEach(j => { const w = words[j]; w.state = ""; w.heard = ""; decorate(w); gs.add(w.g); });
  touched.clear(); resetStats(); gs.forEach(ayahBadge); renderMistakes();
  ptr = startPtr = Math.max(0, Math.min(i, words.length - 1));
  $("heard").textContent = "";
  store.set("last", ptr);
  paint(true);
}

function highlightCurrent(scroll) {
  if (curEl) curEl.classList.remove("cur");
  curEl = words[ptr] && words[ptr].el;
  if (curEl) {
    curEl.classList.add("cur");
    if (scroll) {
      const r = curEl.getBoundingClientRect();
      if (r.top < 140 || r.bottom > innerHeight - 110) curEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

function syncSelects() {
  const w = words[Math.min(ptr, words.length - 1)];
  if (+$("surah").value !== w.s) { $("surah").value = w.s; fillAyahSelect(); }
  $("fromAyah").value = w.a;
}

function paint(scroll) {
  if (words[ptr]) { showPage(pageOfAyah[words[ptr].g]); syncSelects(); }
  highlightCurrent(scroll);
  $("sOk").textContent = stats.ok; $("sBad").textContent = stats.bad; $("sSkip").textContent = stats.skip;
  const tot = stats.ok + stats.bad + stats.skip;
  $("sPct").textContent = tot ? Math.round(100 * stats.ok / tot) + "%" : "–";
  $("noMistakes").style.display = mistakes.length ? "none" : "block";
  showTranslation();
}

function showTranslation() {
  if (!settings.trans || !QURAN || !words[ptr]) return;
  const w = words[Math.min(ptr, words.length - 1)];
  $("transRef").textContent = `· ${QURAN[w.s].t} ${w.s + 1}:${w.a + 1}`;
  $("transText").textContent = QURAN[w.s].v[w.a][1];
}
function msg(t, warn) { $("msg").textContent = t; $("msg").className = "msg" + (warn ? " warn" : ""); }

/* ---------- Feedback ---------- */
let audioCtx;
function beep() {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 330; g.gain.setValueAtTime(0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.25);
  } catch {}
}

// Word appearance: colour by state, tooltip saying what went wrong.
function decorate(w, pop) {
  const el = w.el; if (!el) return;
  el.className = "w" + (w.state ? " " + w.state : "") + (w.state && w.state !== "ok" && settings.reveal ? " reveal" : "") + (pop ? " pop" : "");
  el.title = w.state === "bad" ? `Mistake — heard: ${w.heard}` : w.state === "skip" ? "Skipped" : "";
}
// Ayah-end marker turns red and shows how many mistakes that ayah has.
function ayahBadge(g) {
  const ay = ayahs[g]; if (!ay.endEl) return;
  let n = 0; for (let i = ay.w0; i < ay.w1; i++) if (words[i].state === "bad" || words[i].state === "skip") n++;
  ay.endEl.classList.toggle("err", n > 0);
  if (n) ay.endEl.dataset.n = n; else delete ay.endEl.dataset.n;
}

function mark(i, state, heard) {
  const w = words[i], prev = w.state;
  touched.add(i);
  if (state === "ok") {
    if (!prev) stats.ok++;            // re-reciting an earlier word is never counted twice
    w.state = "ok"; decorate(w);
    if (prev === "bad" || prev === "skip") { ayahBadge(w.g); renderMistakes(); }   // corrected on repeat
    return;
  }
  if (prev === "ok" && state === "skip") return;   // passing over words already recited correctly
  w.state = state; w.heard = heard || ""; stats[state]++;
  mistakes.push({ type: state, i, word: w.text, key: w.key, heard: w.heard, s: w.s + 1, ayah: w.a + 1 });
  decorate(w, true); ayahBadge(w.g); renderMistakes();
  if (state === "bad") { beep(); if (settings.vibrate && navigator.vibrate) navigator.vibrate(120); }
}

// Mistakes panel, grouped by ayah. Click an item to see the word on the page.
function renderMistakes() {
  const groups = new Map();
  for (const m of mistakes) {
    const k = m.s + ":" + m.ayah;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  $("mistakeList").innerHTML = [...groups].reverse().map(([k, list]) => {
    const [sn, an] = k.split(":");
    return `<li class="mgroup"><div class="mhead"><b>${QURAN[sn - 1].t} ${k}</b><span class="badge">${list.length}</span></div>
      ${list.map(m => {
        const fixed = words[m.i].state === "ok";
        return `<button class="mitem ${m.type}${fixed ? " fixed" : ""}" data-i="${m.i}">
          <span class="tag">${m.type === "bad" ? "Mistake" : "Skipped"}</span>
          <span class="ar">${m.word}</span>${m.type === "bad" ? `<span class="heard-as">heard <span class="ar">${m.heard}</span></span>` : ""}
          ${fixed ? `<span class="fixed-tag">✓ corrected</span>` : ""}</button>`;
      }).join("")}</li>`;
  }).join("");
  $("noMistakes").style.display = mistakes.length ? "none" : "block";
  $("mistakeCount").textContent = mistakes.length ? `(${mistakes.length})` : "";
}
function revealWord(i) {
  showPage(pageOfAyah[words[i].g]);
  const el = words[i].el; if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

/* ---------- Alignment of heard words against expected words ---------- */
function backMatch(hk, nextK) {
  // Reciter went back to an earlier place: find the nearest earlier spot where this word
  // (and, if available, the next word too) matches.
  for (let j = ptr - 1; j >= Math.max(0, ptr - 800); j--)
    if (same(words[j].key, hk) && (!nextK || (words[j + 1] && same(words[j + 1].key, nextK)))) return j;
  return -1;
}

function feed(text, flush) {
  const heard = pending.concat(text.split(/\s+/).map(t => ({ raw: t, k: key(t) })).filter(h => h.k));
  pending = [];
  for (let h = 0; h < heard.length; h++) {
    if (ptr >= words.length) break;
    const hk = heard[h].k, nextK = heard[h + 1] && heard[h + 1].k;
    const exp = words[ptr];

    // A. isti'adha / basmala / "sadaq Allah" at the start or between surahs — ignore
    const atStart = (ptr === startPtr && stats.ok === 0) || exp.first;
    if (atStart && OPENING.has(skel(hk)) && !same(exp.key, hk)) continue;
    // B. disconnected letters (الم، يس…) are read as letter names: accept them freely
    if (exp.muq) {
      if (exp.key === hk) { mark(ptr++, "ok"); freeHeard = 0; continue; }
      if (words[ptr + 1] && same(words[ptr + 1].key, hk)) { mark(ptr++, "ok"); mark(ptr++, "ok"); freeHeard = 0; continue; }
      if (++freeHeard > 8) { mark(ptr++, "ok"); freeHeard = 0; }
      continue;
    }
    // C. direct match
    if (same(exp.key, hk)) { mark(ptr++, "ok"); continue; }
    // D. engine split one Quran word into two (يا ايها -> يٰٓأيها)
    if (nextK && same(exp.key, hk + nextK)) { mark(ptr++, "ok"); h++; continue; }
    // E. engine merged two Quran words into one
    if (words[ptr + 1] && same(exp.key + words[ptr + 1].key, hk)) { mark(ptr++, "ok"); mark(ptr++, "ok"); continue; }
    // F. repeated the previous word or two — not a mistake
    if ((ptr > 0 && same(words[ptr - 1].key, hk)) || (ptr > 1 && same(words[ptr - 2].key, hk))) continue;

    // G. skipped ahead a few words
    let fwd = -1;
    for (let k = 1; k <= 4 && ptr + k < words.length; k++) if (same(words[ptr + k].key, hk)) { fwd = k; break; }
    const fwdConfirmed = fwd > 0 && (!nextK || (words[ptr + fwd + 1] && same(words[ptr + fwd + 1].key, nextK)));
    if (fwdConfirmed) { for (let k = 0; k < fwd; k++) mark(ptr++, "skip"); mark(ptr++, "ok"); continue; }

    // H. went back to re-recite earlier ayat — move there, no mistake
    if (!nextK && !flush && backMatch(hk, null) >= 0) { pending = heard.slice(h); break; }  // wait for next word to confirm
    const back = nextK ? backMatch(hk, nextK) : -1;
    if (back >= 0) {
      ptr = back; mark(ptr++, "ok"); mark(ptr++, "ok"); h++;
      msg("↩ Going back — repeating is fine.");
      continue;
    }
    if (fwd > 0) { for (let k = 0; k < fwd; k++) mark(ptr++, "skip"); mark(ptr++, "ok"); continue; }

    // I. wrong word
    mark(ptr++, "bad", heard[h].raw);
  }
  paint(true);
  if (ptr >= words.length) { msg("✅ You completed the Quran. ما شاء الله"); stopListening(true); }
}

/* ---------- Speech recognition ---------- */
const BROWSER_MSG = "Recitation checking does not work in this browser. Please open this page in Google Chrome (Android, Windows, Mac) or Microsoft Edge, or Safari on iPhone.";
function fatal(t) { msg(t, true); alert(t); }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, committed = {}, trail = [], idleTimer = null;
function diag(ev) {
  if (trail[trail.length - 1] === ev) return;
  trail.push(ev); if (trail.length > 8) trail.shift();
  $("diag").textContent = "Status: " + trail.join(" → ");
}

// Which speech engine: the browser's (Google, fast, needs Chrome/Edge/Safari) or the on-device Quran AI model.
const useLocal = () => settings.engine === "local" || (settings.engine !== "browser" && (!SR || !!navigator.brave));

function startListening() {
  if (ptr >= words.length) setStart(startPtr);
  if (useLocal()) { startLocal(); return; }
  if (!SR) { fatal(BROWSER_MSG); return; }
  rec = new SR();
  rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  committed = {};
  rec.onresult = e => {
    let shown = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], ws = r[0].transcript.trim().split(/\s+/).filter(Boolean);
      shown += " " + ws.join(" ");
      // Check words as soon as they are stable (all but the last 2 while still speaking),
      // so mistakes show up during continuous recitation, not only after a pause.
      const done = committed[i] || 0, upto = r.isFinal ? ws.length : ws.length - 1;
      if (upto > done) { feed(ws.slice(done, upto).join(" ")); committed[i] = upto; }
      // If the last word stays the same for a moment, it is final enough: check it too.
      if (!r.isFinal) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const d = committed[i] || 0;
          if (listening && ws.length > d) { feed(ws.slice(d).join(" ")); committed[i] = ws.length; }
        }, 650);
      } else clearTimeout(idleTimer);
    }
    $("heard").textContent = shown.trim();
    diag("result");
  };
  rec.onerror = e => {
    diag("error:" + e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopListening(); fatal("Microphone permission was denied. Allow the microphone for this site and try again."); }
    else if (e.error === "network") { stopListening(); fatal("This browser's speech service is not available (network error). Switching to the on-device Quran speech model — press the microphone again.\n\n(You can change this in Settings → Speech engine.)"); settings.engine = "local"; saveSettings(); }
    else if (e.error === "audio-capture") { stopListening(); fatal("No microphone was found. Check that a microphone is connected and not used by another app."); }
  };
  rec.onstart = () => diag("start");
  rec.onaudiostart = () => { diag("mic-on"); msg("🎤 Listening — start reciting."); };
  rec.onspeechstart = () => { diag("speech"); msg("👂 Hearing you…"); };
  rec.onend = () => { diag("end"); if (listening) { committed = {}; try { rec.start(); } catch { diag("restart-failed"); } } };
  trail = []; diag("starting");
  try { rec.start(); } catch (err) { diag("start-failed:" + err.message); }
  listening = true;
  setMicUI(true);
  msg("Starting microphone…");
}

function stopListening(finished) {
  const was = listening;
  listening = false;
  if (rec) { try { rec.stop(); } catch {} }
  stopLocal();
  if (pending.length) feed("", true);
  setMicUI(false);
  if (was) msg("Stopped. Press the microphone to continue.");
  if (was && stats.ok + stats.bad + stats.skip > 0) saveSession(finished);
}

/* ---------- On-device speech engine (Brave, Firefox, offline) ---------- */
// Microphone audio is cut into phrases at natural pauses and transcribed by a Quran-trained
// Whisper model running in a Web Worker. Slower than Chrome's engine (a word check arrives after
// each pause) but works in any modern browser and never sends audio anywhere.
let worker = null, workerReady = false, mic = null, audioCtx2 = null, proc = null;
let buf = [], bufLen = 0, preroll = [], inSpeech = false, silenceMs = 0, noise = 0.003, busy = false, queued = null, chunkId = 0;
const RATE = 16000;

function getWorker() {
  if (worker) return worker;
  worker = new Worker("asr-worker.js?v=7", { type: "module" });
  const files = {};
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === "progress") {
      files[m.file] = m; let a = 0, t = 0;
      for (const f of Object.values(files)) { a += f.loaded; t += f.total; }
      msg(`⬇️ Downloading the Quran speech model (only the first time): ${Math.round(a / 1e6)} / ${Math.round(t / 1e6)} MB`);
    } else if (m.type === "ready") {
      workerReady = true; diag("model-ready" + (m.device ? ":" + m.device : ""));
      if (listening) msg("🎤 Listening (on-device) — recite, and pause briefly between phrases.");
      if (pendingStart) { pendingStart = false; openMic(); }
    } else if (m.type === "error") {
      diag("model-error"); listening = false; setMicUI(false);
      fatal("The speech model could not be loaded: " + m.message + "\nCheck your internet connection and try again.");
    } else if (m.type === "text") {
      busy = false; diag(`heard(${m.ms || "?"}ms)`);
      if (m.error) diag("model-failed");
      const text = cleanModelText(m.text);
      if (text && listening) { $("heard").textContent = text; feed(text); }
      if (queued) { const q = queued; queued = null; sendChunk(q); }
    }
  };
  return worker;
}
let pendingStart = false;

function setMicUI(on) {
  $("micLabel").textContent = on ? "Stop" : "Start";
  $("micBtn").classList.toggle("on", on); $("dot").classList.toggle("on", on);
}

function startLocal() {
  listening = true; setMicUI(true); trail = []; diag("on-device");
  getWorker();
  if (workerReady) { openMic(); return; }
  pendingStart = true;
  msg("Preparing the on-device Quran speech model…");
  worker.postMessage({ type: "load" });
}

async function openMic() {
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    listening = false; setMicUI(false);
    fatal("Microphone permission was denied or no microphone was found. Allow the microphone for this site and try again."); return;
  }
  if (!listening) { mic.getTracks().forEach(t => t.stop()); return; }
  audioCtx2 = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx2.createMediaStreamSource(mic);
  proc = audioCtx2.createScriptProcessor(4096, 1, 1);
  const ratio = audioCtx2.sampleRate / RATE;
  proc.onaudioprocess = e => {
    if (!listening) return;
    const input = e.inputBuffer.getChannelData(0);
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
    onFrame(out);
  };
  src.connect(proc); proc.connect(audioCtx2.destination);
  buf = []; bufLen = 0; preroll = []; inSpeech = false; silenceMs = 0;
  diag("mic-on");
  msg("🎤 Listening (on-device) — recite, and pause briefly between phrases.");
}

function onFrame(f) {
  let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  const rms = Math.sqrt(sum / f.length), ms = f.length / RATE * 1000;
  const speaking = rms > Math.max(0.008, noise * 3);
  if (!inSpeech) {
    noise = noise * 0.95 + rms * 0.05;
    preroll.push(f); if (preroll.length > 2) preroll.shift();
    if (speaking) { inSpeech = true; silenceMs = 0; buf = preroll.slice(); bufLen = buf.reduce((n, x) => n + x.length, 0); preroll = []; diag("speech"); msg("👂 Hearing you…"); }
    return;
  }
  buf.push(f); bufLen += f.length;
  silenceMs = speaking ? 0 : silenceMs + ms;
  const secs = bufLen / RATE;
  // Send a phrase at a pause (or every 7 s during long continuous recitation).
  if ((silenceMs >= 450 && secs >= 0.8) || secs >= 7) flushChunk();
  else if (silenceMs >= 1500) { inSpeech = false; buf = []; bufLen = 0; }
}

function flushChunk() {
  if (!bufLen) return;
  const audio = new Float32Array(bufLen); let o = 0;
  for (const x of buf) { audio.set(x, o); o += x.length; }
  buf = []; bufLen = 0; inSpeech = silenceMs < 450;
  if (busy) {   // still working on the previous phrase: join this one onto the waiting phrase
    if (queued) { const j = new Float32Array(queued.length + audio.length); j.set(queued); j.set(audio, queued.length); queued = j; }
    else queued = audio;
    return;
  }
  sendChunk(audio);
}
// Remove runs of the same word repeated 3+ times (a known Whisper glitch on noise).
function cleanModelText(t) {
  const out = [];
  for (const w of (t || "").split(/\s+/).filter(Boolean)) {
    const n = out.length;
    if (n >= 2 && key(out[n - 1]) === key(w) && key(out[n - 2]) === key(w)) continue;
    out.push(w);
  }
  return out.join(" ");
}
function sendChunk(audio) { busy = true; diag("thinking"); worker.postMessage({ type: "transcribe", id: ++chunkId, audio }, [audio.buffer]); }

function stopLocal() {
  pendingStart = false;
  if (proc) { flushChunk(); proc.disconnect(); proc.onaudioprocess = null; proc = null; }
  if (audioCtx2) { audioCtx2.close().catch(() => {}); audioCtx2 = null; }
  if (mic) { mic.getTracks().forEach(t => t.stop()); mic = null; }
}

/* ---------- History ---------- */
function saveSession(finished) {
  const a = words[startPtr], b = words[Math.max(startPtr, Math.min(ptr, words.length) - 1)];
  const ref = w => `${QURAN[w.s].t} ${w.s + 1}:${w.a + 1}`;
  const sess = { date: Date.now(), from: ref(a), to: ref(b), surah: a.s + 1, name: QURAN[a.s].t, ...stats, mistakes };
  const hist = store.get("history", []); hist.unshift(sess); store.set("history", hist.slice(0, 300));
  const tot = stats.ok + stats.bad + stats.skip;
  $("summaryBody").innerHTML = `
    <p><b>${sess.from}</b> → <b>${sess.to}</b>${finished ? " (complete)" : ""}</p>
    <div class="stats"><div class="stat"><b>${stats.ok}</b><span>Correct</span></div><div class="stat bad"><b>${stats.bad}</b><span>Mistakes</span></div>
    <div class="stat skip"><b>${stats.skip}</b><span>Skipped</span></div><div class="stat"><b>${Math.round(100 * stats.ok / tot)}%</b><span>Accuracy</span></div></div>
    <p class="muted">${stats.bad + stats.skip === 0 ? "ما شاء الله — no mistakes!" : "Review the highlighted words, then try again."}</p>`;
  $("summary").classList.remove("hidden");
  renderHistory();
}

function renderHistory() {
  const hist = store.get("history", []);
  const t = hist.reduce((a, s) => (a.ok += s.ok, a.bad += s.bad, a.skip += s.skip, a), { ok: 0, bad: 0, skip: 0 });
  const tot = t.ok + t.bad + t.skip;
  $("totals").innerHTML = `<div class="stat"><b>${hist.length}</b><span>Sessions</span></div><div class="stat"><b>${t.ok}</b><span>Correct words</span></div>
    <div class="stat bad"><b>${t.bad + t.skip}</b><span>Mistakes</span></div><div class="stat"><b>${tot ? Math.round(100 * t.ok / tot) + "%" : "–"}</b><span>Accuracy</span></div>`;
  const freq = {};
  hist.forEach(s => (s.mistakes || []).forEach(m => {
    const sn = m.s || s.surah, id = sn + ":" + m.ayah + ":" + m.key;
    (freq[id] = freq[id] || { n: 0, word: m.word, ref: `${QURAN[sn - 1].t} ${sn}:${m.ayah}` }).n++;
  }));
  const weak = Object.values(freq).sort((a, b) => b.n - a.n).slice(0, 15);
  $("weakList").innerHTML = weak.length ? weak.map(w =>
    `<li><span class="ar">${w.word}</span> — ${w.ref} <span class="muted">(${w.n}×)</span></li>`).join("")
    : `<p class="muted">Nothing yet — recite a few times to see your weak spots.</p>`;
  $("sessions").innerHTML = hist.length ? hist.slice(0, 50).map(s => {
    const n = s.ok + s.bad + s.skip;
    const range = s.from && isNaN(s.from) ? `${s.from} → ${s.to}` : `${s.surah}. ${s.name} ${s.from}–${s.to}`;
    return `<div class="sess"><b>${range}</b> · <span class="muted">${new Date(s.date).toLocaleString()}</span><br>
      <span class="ok">${s.ok} correct</span> · <span class="bad">${s.bad} mistakes</span> · <span class="skip">${s.skip} skipped</span> · ${n ? Math.round(100 * s.ok / n) : 0}%</div>`;
  }).join("") : `<p class="muted">No sessions yet.</p>`;
}

/* ---------- Wiring ---------- */
function fillSurahSelect() {
  $("surah").innerHTML = QURAN.map((s, i) => `<option value="${i}">${i + 1}. ${s.t} — ${s.n}</option>`).join("");
}
function fillAyahSelect() {
  const s = QURAN[+$("surah").value];
  $("fromAyah").innerHTML = s.v.map((_, i) => `<option value="${i}">${i + 1}</option>`).join("");
}
function jumpTo(s, a) { stopListening(); setStart(ayahs[ayahIndex(s, a)].w0); }

function bind() {
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
    if (b.dataset.view === "history") renderHistory();
  });
  $("surah").onchange = () => { fillAyahSelect(); jumpTo(+$("surah").value, 0); };
  $("fromAyah").onchange = () => jumpTo(+$("surah").value, +$("fromAyah").value);
  $("mistakeList").onclick = e => { const b = e.target.closest(".mitem"); if (b) revealWord(+b.dataset.i); };
  $("book").onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i != null) { stopListening(); setStart(+i); } };
  $("pgNext").onclick = () => turn(1);
  $("pgPrev").onclick = () => turn(-1);
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") turn(1); else if (e.key === "ArrowRight") turn(-1);
  });
  let tx = null;
  $("book").addEventListener("touchstart", e => tx = e.touches[0].clientX, { passive: true });
  $("book").addEventListener("touchend", e => {
    if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 70) turn(dx > 0 ? 1 : -1);     // swipe right = next page (Arabic page order)
  });
  let wide = isWide();
  window.addEventListener("resize", () => { if (isWide() !== wide) { wide = isWide(); const p = shownPages[0]; shownPages = []; showPage(p); } });
  $("micBtn").onclick = () => listening ? stopListening() : startListening();
  $("resetBtn").onclick = () => { stopListening(); setStart(startPtr); };
  $("memoBtn").onclick = () => { settings.memo = !settings.memo; saveSettings(); };
  $("summaryClose").onclick = () => $("summary").classList.add("hidden");
  $("clearHist").onclick = () => { if (confirm("Delete all history?")) { store.set("history", []); renderHistory(); } };
  $("optTrans").onchange = e => { settings.trans = e.target.checked; saveSettings(); };
  $("optSound").onchange = e => { settings.sound = e.target.checked; saveSettings(); };
  $("optVibrate").onchange = e => { settings.vibrate = e.target.checked; saveSettings(); };
  $("optReveal").onchange = e => { settings.reveal = e.target.checked; saveSettings(); };
  $("optFont").oninput = e => { settings.font = +e.target.value; saveSettings(); };
  $("optStrict").onchange = e => { settings.strict = +e.target.value; saveSettings(); };
  $("optTheme").onchange = e => { settings.theme = e.target.value; saveSettings(); };
  $("optEngine").onchange = e => { stopListening(); settings.engine = e.target.value; saveSettings(); };
}

async function init() {
  bind(); applySettings(); resetStats();
  msg("Loading the Quran…");
  try {
    [QURAN, META] = await Promise.all([fetch("data/quran.json").then(r => r.json()), fetch("data/meta.json").then(r => r.json())]);
  } catch { msg("Could not load the Quran text. Check your connection and reload.", true); return; }
  buildModel(); fillSurahSelect();
  const last = store.get("last", 0);
  $("surah").value = words[typeof last === "number" ? last : 0].s; fillAyahSelect();
  setStart(typeof last === "number" ? last : 0);
  renderHistory();
  if (useLocal()) msg("This browser will use the on-device Quran speech model (downloads about 100 MB the first time). Press the microphone to begin.");
  else msg("Choose a surah and press the microphone to begin.");
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
