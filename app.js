"use strict";
/* Tilawa Checker — free Quran recitation checker.
   Flow: load Quran text -> render chosen surah as word spans -> browser speech recognition (Arabic)
   -> each recognised word is aligned against the expected word -> mark correct / mistake / skipped. */

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
  const strict = settings.strict;
  const a = skel(expKey), b = skel(heardKey);
  if (!a || !b) return a === b && lev(expKey, heardKey) <= (strict === 2 ? 0 : 2); // words made only of ا/و/ي
  if (a === b) return strict < 2 || expKey.length <= 3;
  if (strict === 2) return false;
  const tol = strict === 0 ? (a.length >= 7 ? 2 : a.length >= 4 ? 1 : 0) : (a.length >= 8 ? 2 : a.length >= 5 ? 1 : 0);
  return tol > 0 && lev(a, b) <= tol;
}

/* ---------- Settings ---------- */
const settings = Object.assign({ trans: false, sound: true, vibrate: true, reveal: true, font: 30, strict: 1, memo: false },
  store.get("settings", {}));
function saveSettings() { store.set("settings", settings); applySettings(); }
function applySettings() {
  document.documentElement.style.setProperty("--qfont", settings.font + "px");
  $("mushaf").classList.toggle("hide-trans", !settings.trans);
  $("mushaf").classList.toggle("memo", settings.memo);
  $("memoBtn").textContent = settings.memo ? "🙈" : "👁";
  $("optTrans").checked = settings.trans; $("optSound").checked = settings.sound;
  $("optVibrate").checked = settings.vibrate; $("optReveal").checked = settings.reveal;
  $("optFont").value = settings.font; $("optStrict").value = settings.strict;
}

/* ---------- State ---------- */
let QURAN = null;
let words = [];          // {text, key, ayah, el, state}
let ptr = 0, startPtr = 0;
let stats, mistakes, freeHeard;
const MUQATTAAT = new Set(["الم","المص","الر","المر","كهيعص","طه","طسم","طس","يس","ص","حم","عسق","ق","ن"].map(key));
const OPENING = new Set(["اعوذ","بالله","من","الشيطان","الرجيم","بسم","الله","الرحمن","الرحمان","الرحيم"].map(k => skel(key(k))));

function resetStats() { stats = { ok: 0, bad: 0, skip: 0 }; mistakes = []; freeHeard = 0; }

/* ---------- Rendering ---------- */
function fillSurahSelect() {
  $("surah").innerHTML = QURAN.map((s, i) =>
    `<option value="${i}">${i + 1}. ${s.t} — ${s.n} (${s.v.length})</option>`).join("");
}
function fillAyahSelect() {
  const s = QURAN[+$("surah").value];
  $("fromAyah").innerHTML = s.v.map((_, i) => `<option value="${i}">${i + 1}</option>`).join("");
}
const arNum = n => n.toLocaleString("ar-EG");

function renderSurah() {
  const si = +$("surah").value, s = QURAN[si];
  $("surahTitle").textContent = `سورة ${s.n} · ${s.t}`;
  $("bismillah").style.display = (si === 0 || si === 8) ? "none" : "block";
  const box = $("mushaf"); box.innerHTML = ""; words = [];
  const frag = document.createDocumentFragment();
  s.v.forEach(([ar, en], ai) => {
    let last = null;
    for (const tok of ar.split(/\s+/).filter(Boolean)) {
      const k = key(tok);
      if (!k) {                                   // waqf sign / hizb mark: attach to previous word
        if (last) last.el.textContent += " " + tok; else frag.append(tok + " ");
        continue;
      }
      const el = document.createElement("span");
      el.className = "w"; el.textContent = tok; el.dataset.i = words.length;
      const w = { text: tok, key: k, ayah: ai, el, state: "" };
      w.muq = ai === 0 && words.length < 2 && MUQATTAAT.has(k);
      words.push(w); frag.append(el, " "); last = w;
    }
    const m = document.createElement("span"); m.className = "mark"; m.textContent = "﴿" + arNum(ai + 1) + "﴾";
    frag.append(m, " ");
    const t = document.createElement("span"); t.className = "trans"; t.textContent = `${ai + 1}. ${en}`;
    frag.append(t);
  });
  box.append(frag);
  setStart(words.findIndex(w => w.ayah === +$("fromAyah").value));
}

function setStart(i) {
  resetStats();
  words.forEach(w => { w.state = ""; w.el.className = "w"; });
  ptr = startPtr = Math.max(0, i);
  $("mistakeList").innerHTML = ""; $("heard").textContent = "…"; msg("");
  paint(true);
}

function paint(scroll) {
  words.forEach((w, i) => w.el.classList.toggle("cur", i === ptr));
  $("sOk").textContent = stats.ok; $("sBad").textContent = stats.bad; $("sSkip").textContent = stats.skip;
  const tot = stats.ok + stats.bad + stats.skip;
  $("sPct").textContent = tot ? Math.round(100 * stats.ok / tot) + "%" : "–";
  $("noMistakes").style.display = mistakes.length ? "none" : "block";
  if (scroll && words[ptr]) words[ptr].el.scrollIntoView({ block: "center", behavior: "smooth" });
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
function mark(i, state, heard) {
  const w = words[i]; w.state = state;
  w.el.className = "w " + state + (state !== "ok" && settings.memo && settings.reveal ? " reveal" : "");
  if (state === "ok") { stats.ok++; return; }
  stats[state]++;
  const s = QURAN[+$("surah").value];
  mistakes.push({ type: state, word: w.text, key: w.key, heard: heard || "", ayah: w.ayah + 1 });
  const li = document.createElement("li");
  li.innerHTML = state === "bad"
    ? `Ayah ${w.ayah + 1}: expected <span class="ar">${w.text}</span> — heard <span class="ar bad">${heard}</span>`
    : `Ayah ${w.ayah + 1}: skipped <span class="ar skip">${w.text}</span>`;
  $("mistakeList").append(li);
  if (state === "bad") { beep(); if (settings.vibrate && navigator.vibrate) navigator.vibrate(120); }
}

/* ---------- Alignment of heard words against expected words ---------- */
function feed(text) {
  const heard = text.split(/\s+/).map(t => ({ raw: t, k: key(t) })).filter(h => h.k);
  for (let h = 0; h < heard.length; h++) {
    if (ptr >= words.length) break;
    const hk = heard[h].k, nextK = heard[h + 1] && heard[h + 1].k;
    const exp = words[ptr];

    // 0. disconnected letters (الم، يس…) are read as letter names ("alif lam mim"): accept them freely
    //    and move on as soon as the next real word is heard.
    if (exp.muq) {
      if (words[ptr + 1] && same(words[ptr + 1].key, hk)) { mark(ptr++, "ok"); mark(ptr++, "ok"); freeHeard = 0; continue; }
      if (OPENING.has(skel(hk))) continue;
      if (++freeHeard > 8) { mark(ptr++, "ok"); freeHeard = 0; }
      continue;
    }
    // 1. direct match
    if (same(exp.key, hk)) { mark(ptr++, "ok"); freeHeard = 0; continue; }
    // 2. engine split one Quran word into two (يا ايها -> يٰٓأيها)
    if (nextK && same(exp.key, hk + nextK)) { mark(ptr++, "ok"); h++; continue; }
    // 3. engine merged two Quran words into one
    if (words[ptr + 1] && same(exp.key + words[ptr + 1].key, hk)) { mark(ptr++, "ok"); mark(ptr++, "ok"); continue; }
    // 4. isti'adha / basmala before starting
    if (ptr === startPtr && stats.ok === 0 && OPENING.has(skel(hk))) continue;
    // 5. reciter repeated a previous word — not a mistake
    if ((ptr > startPtr && same(words[ptr - 1].key, hk)) || (ptr > startPtr + 1 && same(words[ptr - 2].key, hk))) continue;
    // 6. skipped words: heard word matches one of the next few expected words
    let jump = -1;
    for (let k = 1; k <= 4 && ptr + k < words.length; k++) if (same(words[ptr + k].key, hk)) { jump = k; break; }
    if (jump > 0) {
      for (let k = 0; k < jump; k++) mark(ptr++, "skip");
      mark(ptr++, "ok"); continue;
    }
    // 7. wrong word
    mark(ptr++, "bad", heard[h].raw);
  }
  paint(true);
  if (ptr >= words.length) { msg("✅ You reached the end of the surah."); stopListening(true); }
}

/* ---------- Speech recognition ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, prevFinal = "";

function startListening() {
  if (!SR) { msg("Speech recognition isn't available in this browser. Please open this page in Google Chrome (Android, Windows, Mac) or Safari (iPhone).", true); return; }
  if (ptr >= words.length) setStart(startPtr);
  rec = new SR();
  rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  prevFinal = "";
  rec.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], t = r[0].transcript.trim();
      if (!r.isFinal) { interim += " " + t; continue; }
      // Some Android versions repeat earlier final text: only process the new part.
      let fresh = t;
      if (prevFinal && t.startsWith(prevFinal)) fresh = t.slice(prevFinal.length);
      else if (t === prevFinal) fresh = "";
      prevFinal = t;
      if (fresh.trim()) feed(fresh);
    }
    $("heard").textContent = interim.trim() || prevFinal || "…";
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { msg("Microphone permission was denied. Allow the microphone for this site and try again.", true); stopListening(); }
    else if (e.error === "network") msg("Speech recognition needs an internet connection.", true);
  };
  rec.onend = () => { if (listening) { prevFinal = ""; try { rec.start(); } catch {} } };
  try { rec.start(); } catch {}
  listening = true;
  $("micBtn").textContent = "⏹ Stop"; $("micBtn").classList.add("on");
  msg("Listening… start reciting.");
}

function stopListening(finished) {
  const was = listening;
  listening = false;
  if (rec) { try { rec.stop(); } catch {} }
  $("micBtn").textContent = "🎙 Start"; $("micBtn").classList.remove("on");
  if (was && stats.ok + stats.bad + stats.skip > 0) saveSession(finished);
}

/* ---------- History ---------- */
function saveSession(finished) {
  const si = +$("surah").value, s = QURAN[si];
  const fromA = words[startPtr].ayah + 1, toA = words[Math.max(startPtr, ptr - 1)].ayah + 1;
  const sess = { date: Date.now(), surah: si + 1, name: s.t, from: fromA, to: toA, ...stats, mistakes };
  const hist = store.get("history", []); hist.unshift(sess); store.set("history", hist.slice(0, 300));
  const tot = stats.ok + stats.bad + stats.skip;
  $("summaryBody").innerHTML = `
    <p><b>${s.t}</b>, ayah ${fromA}–${toA}${finished ? " (complete)" : ""}</p>
    <div class="stats"><div><b>${stats.ok}</b><span>Correct</span></div><div class="bad"><b>${stats.bad}</b><span>Mistakes</span></div>
    <div class="skip"><b>${stats.skip}</b><span>Skipped</span></div><div><b>${Math.round(100 * stats.ok / tot)}%</b><span>Accuracy</span></div></div>
    <p class="muted">${stats.bad + stats.skip === 0 ? "ما شاء الله — no mistakes!" : "Review the highlighted words, then try again."}</p>`;
  $("summary").classList.remove("hidden");
  renderHistory();
}

function renderHistory() {
  const hist = store.get("history", []);
  const t = hist.reduce((a, s) => (a.ok += s.ok, a.bad += s.bad, a.skip += s.skip, a), { ok: 0, bad: 0, skip: 0 });
  const tot = t.ok + t.bad + t.skip;
  $("totals").innerHTML = `<div><b>${hist.length}</b><span>Sessions</span></div><div><b>${t.ok}</b><span>Correct words</span></div>
    <div class="bad"><b>${t.bad + t.skip}</b><span>Mistakes</span></div><div><b>${tot ? Math.round(100 * t.ok / tot) + "%" : "–"}</b><span>Accuracy</span></div>`;
  const freq = {};
  hist.forEach(s => s.mistakes.forEach(m => {
    const id = s.surah + ":" + m.ayah + ":" + m.key;
    (freq[id] = freq[id] || { n: 0, word: m.word, surah: s.name, sn: s.surah, ayah: m.ayah }).n++;
  }));
  const weak = Object.values(freq).sort((a, b) => b.n - a.n).slice(0, 15);
  $("weakList").innerHTML = weak.length ? weak.map(w =>
    `<li><span class="ar">${w.word}</span> — ${w.surah} ${w.sn}:${w.ayah} <span class="muted">(${w.n}×)</span></li>`).join("")
    : `<p class="muted">Nothing yet — recite a few times to see your weak spots.</p>`;
  $("sessions").innerHTML = hist.length ? hist.slice(0, 50).map(s => {
    const n = s.ok + s.bad + s.skip;
    return `<div class="sess"><b>${s.surah}. ${s.name}</b> ayah ${s.from}–${s.to} · ${new Date(s.date).toLocaleString()}<br>
      <span class="ok">${s.ok} correct</span> · <span class="bad">${s.bad} mistakes</span> · <span class="skip">${s.skip} skipped</span> · ${Math.round(100 * s.ok / n)}%</div>`;
  }).join("") : `<p class="muted">No sessions yet.</p>`;
}

/* ---------- Wiring ---------- */
function bind() {
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
    if (b.dataset.view === "history") renderHistory();
  });
  $("surah").onchange = () => { stopListening(); fillAyahSelect(); renderSurah(); store.set("last", { s: +$("surah").value, a: 0 }); };
  $("fromAyah").onchange = () => { stopListening(); setStart(words.findIndex(w => w.ayah === +$("fromAyah").value)); store.set("last", { s: +$("surah").value, a: +$("fromAyah").value }); };
  $("mushaf").onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i != null && !listening) { setStart(+i); $("fromAyah").value = words[+i].ayah; } };
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
}

async function init() {
  bind(); applySettings();
  msg("Loading Quran text…");
  try {
    QURAN = await (await fetch("data/quran.json")).json();
  } catch { msg("Could not load the Quran text. Check your connection and reload.", true); return; }
  fillSurahSelect();
  const last = store.get("last", { s: 0, a: 0 });
  $("surah").value = last.s; fillAyahSelect(); $("fromAyah").value = last.a;
  renderSurah(); renderHistory(); msg("");
  if (!SR) msg("Note: this browser has no speech recognition. Use Google Chrome for best results.", true);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
