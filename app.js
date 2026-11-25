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
const settings = Object.assign({ trans: false, sound: true, vibrate: true, reveal: true, font: 28, strict: 1, memo: false, theme: "", engine: "auto", harakat: false, server: "", lang: "", transLang: "", tafsir: true, tafsirEd: "", vol: 100 },
  store.get("settings", {}));

/* ---------- Languages (English / Arabic / Kurdish Sorani) ---------- */
const I18N = {
  en: {},
  ar: { appName: "تلاوة", appSub: "المصحح", tabQuran: "المصحف", tabHistory: "السجل", tabSettings: "الإعدادات",
    translation: "الترجمة", tafsir: "التفسير", controls: "أدوات التلاوة والاستماع", listen: "استماع", pause: "إيقاف مؤقت",
    reciter: "القارئ", volume: "مستوى الصوت", repeatAyah: "تكرار الآية", speed: "السرعة", stopAt: "التوقف عند نهاية",
    uAyah: "الآية", uPage: "الصفحة", uQuarter: "الربع", uHizb: "الحزب", uSurah: "السورة", uJuz: "الجزء", uNone: "بدون توقف",
    loop: "التكرار", once: "مرة واحدة", forever: "تكرار دائم ∞", surah: "السورة", ayah: "الآية", juz: "الجزء", hizb: "الحزب", page: "الصفحة",
    correct: "صحيح", mistakes: "أخطاء", skipped: "متروك", accuracy: "الدقة", mistakesSession: "أخطاء هذه الجلسة", noMistakes: "لا أخطاء حتى الآن.",
    start: "ابدأ", stop: "توقف", weakWords: "الكلمات التي تخطئ فيها كثيرًا", pastSessions: "الجلسات السابقة", clearHistory: "مسح السجل",
    language: "لغة الواجهة", transLang: "لغة الترجمة", optTrans: "إظهار ترجمة الآية الحالية", optTafsir: "إظهار تفسير الآية الحالية (يُحمَّل لكل سورة عند فتحها)",
    optSound: "صوت تنبيه عند الخطأ", optVibrate: "اهتزاز عند الخطأ", optReveal: "في وضع الحفظ، أظهر الكلمات التي أخطئ فيها",
    textSize: "حجم الخط", strictness: "درجة الدقة", lenient: "متساهل", normal: "عادي", strict: "صارم (كلمات مطابقة)",
    engine: "محرك التعرف على الصوت", theme: "المظهر", auto: "تلقائي", light: "فاتح", dark: "داكن",
    ready: "اختر سورة واضغط على الميكروفون للبدء.", loadingTafsir: "جارٍ تحميل التفسير…", tafsirFail: "تعذّر تحميل التفسير. تحقق من الاتصال بالإنترنت.",
    noTafsir: "لا يوجد تفسير لهذه الآية في هذا الكتاب.", loading: "جارٍ التحميل…" },
  ckb: { appName: "تیلاوە", appSub: "ڕاستکەرەوە", tabQuran: "قورئان", tabHistory: "مێژوو", tabSettings: "ڕێکخستنەکان",
    translation: "وەرگێڕان", tafsir: "تەفسیر", controls: "کۆنترۆڵی خوێندنەوە و گوێگرتن", listen: "گوێگرتن", pause: "وەستان",
    reciter: "قورئانخوێن", volume: "بەرزی دەنگ", repeatAyah: "دووبارەکردنەوەی ئایەت", speed: "خێرایی", stopAt: "وەستان لە کۆتایی",
    uAyah: "ئایەت", uPage: "لاپەڕە", uQuarter: "چارەک", uHizb: "حیزب", uSurah: "سوورەت", uJuz: "جوزء", uNone: "بێ وەستان",
    loop: "دووبارەبوونەوە", once: "یەک جار", forever: "بەردەوام ∞", surah: "سوورەت", ayah: "ئایەت", juz: "جوزء", hizb: "حیزب", page: "لاپەڕە",
    correct: "ڕاست", mistakes: "هەڵە", skipped: "بازدراو", accuracy: "وردی", mistakesSession: "هەڵەکانی ئەم دانیشتنە", noMistakes: "هێشتا هیچ هەڵەیەک نییە.",
    start: "دەستپێکردن", stop: "وەستان", weakWords: "ئەو وشانەی زۆرتر تێیاندا هەڵە دەکەیت", pastSessions: "دانیشتنە پێشووەکان", clearHistory: "سڕینەوەی مێژوو",
    language: "زمانی ڕووکار", transLang: "زمانی وەرگێڕان", optTrans: "پیشاندانی وەرگێڕانی ئایەتی ئێستا", optTafsir: "پیشاندانی تەفسیری ئایەتی ئێستا (بۆ هەر سوورەتێک کاتی کردنەوەی دادەبەزێت)",
    optSound: "دەنگی ئاگادارکردنەوە لە کاتی هەڵە", optVibrate: "لەرینەوە لە کاتی هەڵە", optReveal: "لە دۆخی لەبەرکردندا، ئەو وشانەی هەڵەم تێدا کردوون پیشان بدە",
    textSize: "قەبارەی نووسین", strictness: "ئاستی وردی", lenient: "نەرم", normal: "ئاسایی", strict: "توند (وشەی تەواو)",
    engine: "بزوێنەری ناسینەوەی دەنگ", theme: "ڕووکار", auto: "خۆکار", light: "ڕووناک", dark: "تاریک",
    ready: "سوورەتێک هەڵبژێرە و دوگمەی مایکرۆفۆن دابگرە بۆ دەستپێکردن.", loadingTafsir: "تەفسیر دادەبەزێت…", tafsirFail: "نەتوانرا تەفسیر داببەزێنرێت. پەیوەندی ئینتەرنێت بپشکنە.",
    noTafsir: "بۆ ئەم ئایەتە لەم تەفسیرەدا هیچ نییە.", loading: "باردەکرێت…" },
};
const EN = {};
document.querySelectorAll("[data-t]").forEach(el => EN[el.dataset.t] = el.textContent);
Object.assign(EN, { pause: "Pause", stop: "Stop", ready: "Choose a surah and press the microphone to begin.", loadingTafsir: "Loading tafsir…",
  tafsirFail: "Could not load the tafsir. Check your internet connection.", noTafsir: "This tafsir has no entry for this ayah.", loading: "Loading…" });
I18N.en = EN;
const T = k => (I18N[settings.lang] || EN)[k] || EN[k] || k;
function applyLang() {
  const l = I18N[settings.lang] ? settings.lang : "en", rtl = l !== "en";
  document.documentElement.lang = l; document.documentElement.dir = rtl ? "rtl" : "ltr";
  document.querySelectorAll("[data-t]").forEach(el => el.textContent = T(el.dataset.t));
  $("langSel").value = l; $("optLang").value = l;
  $("playLabel").textContent = T(playing ? "pause" : "listen");
  $("micLabel").textContent = T(listening ? "stop" : "start");
  if (QURAN && words[ptr]) syncSelects();
  if (Object.values(I18N).some(d => d.ready === $("msg").textContent)) msg(T("ready"));
}

/* ---------- Kurdish translation (downloaded per surah, on demand) ---------- */
const kuCache = new Map();
function kurdishSurah(s) {
  if (!kuCache.has(s)) {
    const p = fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/kur-burhanmuhammada/${s + 1}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => d.chapter.map(v => v.text));
    kuCache.set(s, p); p.catch(() => kuCache.delete(s));
  }
  return kuCache.get(s);
}

/* ---------- Tafsir (downloaded per surah when you open it, kept for this session) ---------- */
const TAFSIRS = [
  ["kurd-tafsir-rebar", "کوردی — تەفسیری ڕێبەر", "ckb"],
  ["kurdish-mokhtasar", "کوردی — کورتەی تەفسیر (المختصر)", "ckb"],
  ["ar-tafsir-al-mukhtasar", "العربية — المختصر في التفسير", "ar"],
  ["ar-tafseer-al-saddi", "العربية — تفسير السعدي", "ar"],
  ["ar-tafsir-ibn-kathir", "العربية — تفسير ابن كثير", "ar"],
  ["ar-tafsir-al-jalalayn", "العربية — تفسير الجلالين", "ar"],
  ["en-tafsir-al-mukhtasar", "English — Al-Mukhtasar", "en"],
  ["en-tafisr-ibn-kathir", "English — Ibn Kathir (abridged)", "en"],
  ["en-al-jalalayn", "English — Al-Jalalayn", "en"],
];
const tafCache = new Map();
function tafsirSurah(ed, s) {
  const k = ed + "/" + s;
  if (!tafCache.has(k)) {
    const p = fetch(`https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${ed}/${s + 1}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(arr => { const m = {}; for (const x of arr) m[x.ayah] = (m[x.ayah] ? m[x.ayah] + "\n\n" : "") + x.text; return m; });
    tafCache.set(k, p);
    if (tafCache.size > 12) tafCache.delete(tafCache.keys().next().value);
  }
  return tafCache.get(k);
}
const tafAyahCache = new Map();
function tafsirAyah(ed, s, a) {
  const k = `${ed}/${s + 1}/${a + 1}`;
  if (!tafAyahCache.has(k)) {
    const p = fetch(`https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${k}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => d.text);
    tafAyahCache.set(k, p); p.catch(() => tafAyahCache.delete(k));
  }
  return tafAyahCache.get(k);
}
let tafReq = 0;
function showTafsir() {
  $("tafsirPanel").style.display = settings.tafsir ? "" : "none";
  if (!settings.tafsir || !QURAN || !words[ptr]) return;
  const w = words[Math.min(ptr, words.length - 1)], ed = settings.tafsirEd, id = ++tafReq;
  const lang = (TAFSIRS.find(t => t[0] === ed) || TAFSIRS[0])[2], box = $("tafsirText");
  box.dir = lang === "en" ? "ltr" : "rtl"; box.lang = lang;
  $("tafsirRef").textContent = `· ${QURAN[w.s].t} ${w.s + 1}:${w.a + 1}`;
  box.textContent = T("loadingTafsir"); box.classList.add("muted");
  tafsirSurah(ed, w.s).then(m => {
    if (id !== tafReq) return;
    box.classList.remove("muted");
    // Some tafsirs explain several ayat in one entry: walk back to the entry that covers this ayah.
    let a = w.a + 1; while (a > 1 && !m[a]) a--;
    box.textContent = m[a] || T("noTafsir");
  }).catch(() =>      // very long surahs are too big for one file on the CDN: fetch just this ayah instead
    tafsirAyah(ed, w.s, w.a).then(t => { if (id === tafReq) { box.classList.remove("muted"); box.textContent = t || T("noTafsir"); } })
  ).catch(() => { if (id === tafReq) box.textContent = T("tafsirFail"); });
}

if (!settings.lang) settings.lang = /^ar/.test(navigator.language) ? "ar" : /^(ckb|ku)/.test(navigator.language) ? "ckb" : "en";
if (!settings.transLang) settings.transLang = settings.lang === "ckb" ? "ckb" : "en";
if (!settings.tafsirEd) settings.tafsirEd = (TAFSIRS.find(t => t[2] === settings.lang) || TAFSIRS[0])[0];
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
  $("optFont").value = settings.font; $("optStrict").value = settings.strict; $("optTheme").value = settings.theme; $("optEngine").value = settings.engine; $("optHarakat").checked = settings.harakat; $("optServer").value = settings.server || "";
  $("optTafsir").checked = settings.tafsir; $("optTransLang").value = settings.transLang; $("tafsirSel").value = settings.tafsirEd;
  $("volSel").value = settings.vol; $("volVal").textContent = settings.vol + "%"; if (gainNode) gainNode.gain.value = settings.vol / 100;
  applyLang(); showTranslation(); showTafsir();
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

/* ---------- Go to juz / hizb / page ---------- */
const hizbOf = g => { const q = META.hizbQ; let i = 0; while (i + 1 < q.length - 1 && q[i + 1] - 1 <= g) i++; return i; }; // quarter index 0..239
function fillGoto() {
  $("juzSel").innerHTML = Array.from({ length: 30 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("");
  const frac = ["", " ¼", " ½", " ¾"];
  $("hizbSel").innerHTML = Array.from({ length: 240 }, (_, i) => `<option value="${i}">${Math.floor(i / 4) + 1}${frac[i % 4]}</option>`).join("");
  $("pageSel").innerHTML = Array.from({ length: 604 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
}
function syncGoto(g) {
  $("juzSel").value = juzOf(g) - 1; $("hizbSel").value = hizbOf(g); $("pageSel").value = pageOfAyah[g];
}
function jumpToAyah(g) { stopListening(); stopPlaying(); setStart(ayahs[g].w0); }

/* ---------- Listen to a reciter (per-ayah audio from EveryAyah.com) ---------- */
const RECITERS = [
  ["Yasser_Ad-Dussary_128kbps", "Yasser Al-Dosari — ياسر الدوسري"],
  ["Husary_128kbps", "Mahmoud Khalil Al-Husary — الحصري (Murattal)"],
  ["Husary_Mujawwad_64kbps", "Al-Husary — الحصري (Mujawwad)"],
  ["Husary_Muallim_128kbps", "Al-Husary — الحصري (المعلم، للتعليم)"],
  ["Alafasy_128kbps", "Mishary Alafasy — مشاري العفاسي"],
  ["Abdul_Basit_Murattal_192kbps", "Abdul Basit — عبد الباسط (Murattal)"],
  ["Minshawy_Murattal_128kbps", "Al-Minshawi — المنشاوي (Murattal)"],
  ["Abdurrahmaan_As-Sudais_192kbps", "Abdurrahman As-Sudais — السديس"],
  ["Saood_ash-Shuraym_128kbps", "Saud Ash-Shuraim — الشريم"],
  ["Maher_AlMuaiqly_64kbps", "Maher Al-Muaiqly — ماهر المعيقلي"],
];
let playG = -1, playing = false;
const pad3 = n => String(n).padStart(3, "0");
const audioUrl = (g, bism) => {
  const r = settings.reciter || RECITERS[0][0];
  if (bism) return `https://everyayah.com/data/${r}/001001.mp3`;       // the basmala (Al-Fatihah 1:1)
  const ay = ayahs[g]; return `https://everyayah.com/data/${r}/${pad3(ay.s + 1)}${pad3(ay.a + 1)}.mp3`;
};
function setPlayG(g) {
  const old = playG; playG = g;
  for (const x of [old, g]) if (x >= 0 && ayahs[x]) for (let i = ayahs[x].w0; i < ayahs[x].w1; i++) decorate(words[i]);
}
function reachedStop(g, next) {
  const stop = $("stopSel").value, a = ayahs[g], b = ayahs[next];
  if (!b) return true;
  if (stop === "ayah") return true;
  if (stop === "page") return pageOfAyah[g] !== pageOfAyah[next];
  if (stop === "surah") return a.s !== b.s;
  if (stop === "juz") return juzOf(g) !== juzOf(next);
  if (stop === "hizb") return Math.floor(hizbOf(g) / 4) !== Math.floor(hizbOf(next) / 4);
  if (stop === "quarter") return hizbOf(g) !== hizbOf(next);
  return false;
}
// First ayah of the ayah / page / quarter / hizb / surah / juz that contains ayah g (for looping).
function unitStart(g) {
  const stop = $("stopSel").value, ay = ayahs[g], q = hizbOf(g);
  if (stop === "page") return META.pages[pageOfAyah[g] - 1] - 1;
  if (stop === "quarter") return META.hizbQ[q] - 1;
  if (stop === "hizb") return META.hizbQ[q - (q % 4)] - 1;
  if (stop === "surah") return ayahIndex(ay.s, 0);
  if (stop === "juz") return META.juz[juzOf(g) - 1] - 1;
  if (stop === "none") return 0;
  return g;
}
const repeatCount = () => $("repeatSel").value === "inf" ? Infinity : +$("repeatSel").value;
const needsBasmala = g => { const ay = ayahs[g]; return ay.a === 0 && ay.s !== 0 && ay.s !== 8; };

// The playlist, one item at a time: { g: ayah, bism: basmala before it?, rep: plays left, round: loop round }
const firstItem = (g, round = 1) => ({ g, bism: needsBasmala(g), rep: repeatCount(), round });
function nextItem(it) {
  if (it.bism) return { ...it, bism: false };
  if (it.rep > 1) return { ...it, rep: it.rep - 1 };
  const next = it.g + 1;
  if (reachedStop(it.g, next)) return $("loopSel").value === "1" ? firstItem(unitStart(it.g), it.round + 1) : null;
  return firstItem(next, it.round);
}

// Gapless playback with the Web Audio API: every ayah is downloaded and decoded while the previous
// one plays, silence at both ends is trimmed, and the next ayah is scheduled to start exactly when
// the previous one ends.
let gainNode = null;
let actx = null, playToken = 0, nextStart = 0, sources = [];
const bufCache = new Map();
function getBuf(url) {
  if (bufCache.has(url)) return bufCache.get(url);
  const pr = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(ab => actx.decodeAudioData(ab)).then(trimSilence);
  bufCache.set(url, pr); pr.catch(() => bufCache.delete(url));
  if (bufCache.size > 16) bufCache.delete(bufCache.keys().next().value);
  return pr;
}
function trimSilence(buf) {
  const d = buf.getChannelData(0), th = 0.008, sr = buf.sampleRate;
  let i = 0, j = d.length - 1;
  while (i < j && Math.abs(d[i]) < th) i++;
  while (j > i && Math.abs(d[j]) < th) j--;
  const off = Math.max(0, i / sr - 0.04), end = Math.min(buf.duration, j / sr + 0.12);
  return { buffer: buf, off, dur: Math.max(0.1, end - off) };
}
async function schedule(it, token) {
  let b;
  try { b = await getBuf(audioUrl(it.g, it.bism)); }
  catch { if (token === playToken) { msg("Could not load the recitation. Check your internet connection.", true); stopPlaying(); } return; }
  if (token !== playToken) return;
  const rate = +$("speedSel").value, src = actx.createBufferSource();
  src.buffer = b.buffer; src.playbackRate.value = rate; src.connect(gainNode);
  const when = Math.max(actx.currentTime + 0.03, nextStart);
  src.start(when, b.off, b.dur);
  nextStart = when + b.dur / rate;
  sources.push(src); if (sources.length > 4) sources.shift();
  const startsIn = Math.max(0, (when - actx.currentTime) * 1000);
  setTimeout(() => { if (token === playToken) showPlaying(it); }, startsIn);
  const nx = nextItem(it);
  if (!nx) { setTimeout(() => { if (token === playToken) { stopPlaying(); msg("✅ Finished listening."); } }, (nextStart - actx.currentTime) * 1000); return; }
  getBuf(audioUrl(nx.g, nx.bism)).catch(() => {});          // start downloading the next ayah now
  setTimeout(() => { if (token === playToken) schedule(nx, token); }, startsIn);   // queue it once this one starts
}
function showPlaying(it) {
  const g = it.g, ay = ayahs[g];
  showPage(pageOfAyah[g]); setPlayG(g);
  if (+$("surah").value !== ay.s) { $("surah").value = ay.s; fillAyahSelect(); }
  $("fromAyah").value = ay.a; syncGoto(g);
  const reps = repeatCount();
  $("playInfo").textContent = (it.bism ? "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ" : `▶ ${QURAN[ay.s].t} ${ay.s + 1}:${ay.a + 1}`)
    + (reps === Infinity ? " · repeating this ayah ∞" : reps > 1 && !it.bism ? ` · ${reps - it.rep + 1}/${reps}` : "")
    + ($("loopSel").value === "1" ? ` · loop round ${it.round}` : "");
  const el = words[ay.w0].el; if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function startPlaying(fromG) {
  stopListening();                       // don't let the microphone hear the recitation
  if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); gainNode = actx.createGain(); gainNode.gain.value = settings.vol / 100; gainNode.connect(actx.destination); }
  actx.resume();
  const g = fromG != null ? fromG : words[Math.min(ptr, words.length - 1)].g;
  playing = true; const token = ++playToken; nextStart = 0;
  $("playLabel").textContent = T("pause"); $("playBtn").classList.add("on");
  for (const b of [$("playBtn"), $("dockPlay")]) b.querySelector("svg").innerHTML = '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>';
  $("dockPlay").classList.add("on");
  $("playInfo").textContent = "Loading…";
  schedule(firstItem(g), token);
}
function stopPlaying() {
  if (!playing && playG < 0) return;
  playing = false; playToken++;
  for (const src of sources) { try { src.stop(); } catch {} }
  sources = [];
  $("playLabel").textContent = T("listen"); $("playBtn").classList.remove("on");
  for (const b of [$("playBtn"), $("dockPlay")]) b.querySelector("svg").innerHTML = '<path d="M7 4v16l13-8z"/>';
  $("dockPlay").classList.remove("on");
  const g = playG; setPlayG(-1);
  $("playInfo").textContent = "";
  if (g >= 0 && ayahs[g]) setStart(ayahs[g].w0);     // reciting continues from where the audio stopped
}
function restartPlaying() { if (playing) { const g = playG >= 0 ? playG : undefined; stopPlaying(); startPlaying(g); } }

/* ---------- Session state ---------- */
let ptr = 0, startPtr = 0, stats, mistakes, freeHeard = 0, pending = [], touched = new Set();
function resetStats() { stats = { ok: 0, bad: 0, skip: 0 }; mistakes = []; freeHeard = 0; pending = []; }

function setStart(i) {
  const gs = new Set();
  touched.forEach(j => { const w = words[j]; w.state = ""; w.heard = ""; w.hk = ""; decorate(w); gs.add(w.g); });
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
  syncGoto(w.g);
  $("whereBar").innerHTML = `<b>${w.s + 1}. ${settings.lang === "en" ? QURAN[w.s].t : QURAN[w.s].n}</b><span>${T("ayah")} ${w.a + 1}</span><span>${T("juz")} ${juzOf(w.g)}</span><span>${T("page")} ${pageOfAyah[w.g]}</span>`;
}

function paint(scroll) {
  if (words[ptr]) { showPage(pageOfAyah[words[ptr].g]); syncSelects(); }
  highlightCurrent(scroll);
  $("sOk").textContent = stats.ok; $("sBad").textContent = stats.bad; $("sSkip").textContent = stats.skip;
  const tot = stats.ok + stats.bad + stats.skip;
  $("sPct").textContent = tot ? Math.round(100 * stats.ok / tot) + "%" : "–";
  $("noMistakes").style.display = mistakes.length ? "none" : "block";
  showTranslation(); showTafsir();
}

function showTranslation() {
  if (!settings.trans || !QURAN || !words[ptr]) return;
  const w = words[Math.min(ptr, words.length - 1)];
  $("transRef").textContent = `· ${QURAN[w.s].t} ${w.s + 1}:${w.a + 1}`;
  const box = $("transText");
  if (settings.transLang === "ckb") {
    box.dir = "rtl"; box.lang = "ckb"; box.textContent = T("loading");
    kurdishSurah(w.s).then(v => { const x = words[Math.min(ptr, words.length - 1)]; if (x.s === w.s) box.textContent = v[x.a] || ""; })
      .catch(() => { box.dir = "ltr"; box.textContent = QURAN[w.s].v[w.a][1]; });
  } else { box.dir = "ltr"; box.lang = "en"; box.textContent = QURAN[w.s].v[w.a][1]; }
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
  el.className = "w" + (w.g === playG ? " playing" : "") + (w.state ? " " + w.state : "") + (w.state && w.state !== "ok" && settings.reveal ? " reveal" : "") + (pop ? " pop" : "");
  if (w.hk && w.state === "ok") el.classList.add("hk");
  el.title = w.hk && w.state === "ok" ? w.hk : w.state === "unsure" ? "Not heard clearly — not counted as a mistake" : w.state === "bad" ? `Mistake — heard: ${w.heard}` : w.state === "skip" ? "Skipped" : "";
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
  if (prev === "ok" && (state === "skip" || state === "unsure")) return;   // passing over words already recited correctly
  if (state === "unsure") { w.state = "unsure"; decorate(w); return; }
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
        const fixed = !PRO.has(m.type) && words[m.i].state === "ok";
        return `<button class="mitem ${m.type}${fixed ? " fixed" : ""}" data-i="${m.i}">
          <span class="tag">${TAGS[m.type] || m.type}</span>
          <span class="ar">${m.word}</span>${m.type === "bad" ? `<span class="heard-as">heard <span class="ar">${esc(m.heard)}</span></span>` : PRO.has(m.type) ? `<span class="heard-as">${proText(m)}</span>` : ""}
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

// Words between here and the matched word were not heard. The speech engine often drops a single
// short word even when it was recited, so (unless Strict) one missing word is shown as "unsure", not a mistake.
function skipTo(fwd) {
  const lenient = settings.strict < 2 && fwd === 1;
  for (let k = 0; k < fwd; k++) mark(ptr++, lenient ? "unsure" : "skip");
  mark(ptr++, "ok");
}

// While the speech engine is still deciding (interim results), only accept words that clearly match.
// Anything doubtful waits for the engine's final answer. Returns how many heard words were used.
function softFeed(list) {
  if (pending.length) return 0;
  let n = 0;
  for (; n < list.length && ptr < words.length; n++) {
    const hk = key(list[n]), exp = words[ptr];
    if (!hk) continue;
    if (exp.muq) break;
    if (same(exp.key, hk)) { mark(ptr++, "ok"); continue; }
    const atStart = (ptr === startPtr && stats.ok === 0) || exp.first;
    if (atStart && OPENING.has(skel(hk))) continue;
    break;
  }
  if (n) paint(true);
  return n;
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

    // F2. the speech engine added an extra word that you did not say (the next heard word is the expected one)
    if (nextK && same(exp.key, nextK)) continue;
    // F3. not sure yet — wait for the next word before judging (avoids false mistakes)
    if (!nextK && !flush) { pending = heard.slice(h); break; }

    // G. skipped ahead a few words
    let fwd = -1;
    for (let k = 1; k <= 4 && ptr + k < words.length; k++) if (same(words[ptr + k].key, hk)) { fwd = k; break; }
    const fwdConfirmed = fwd > 0 && (!nextK || (words[ptr + fwd + 1] && same(words[ptr + fwd + 1].key, nextK)));
    if (fwdConfirmed) { skipTo(fwd); continue; }

    // H. went back to re-recite earlier ayat — move there, no mistake
    const back = nextK ? backMatch(hk, nextK) : -1;
    if (back >= 0) {
      ptr = back; mark(ptr++, "ok"); mark(ptr++, "ok"); h++;
      msg("↩ Going back — repeating is fine.");
      continue;
    }
    if (fwd > 0) { skipTo(fwd); continue; }

    // I. wrong word
    mark(ptr++, "bad", heard[h].raw);
  }
  paint(true);
  if (ptr >= words.length) { msg("✅ You completed the Quran. ما شاء الله"); stopListening(true); }
}

// Google gives several guesses for each phrase; use the one that matches the expected ayat best.
function bestAlternative(r, done) {
  let best = null, bestScore = -1;
  for (let a = 0; a < r.length; a++) {
    const ws = r[a].transcript.trim().split(/\s+/).filter(Boolean);
    const window = [];
    for (let j = Math.max(0, ptr - 3); j < Math.min(words.length, ptr + ws.length + 6); j++) window.push(words[j].key);
    let score = 0;
    for (const w of ws.slice(done)) { const k = key(w); if (window.some(x => same(x, k))) score++; }
    score -= a * 0.01;                       // prefer the engine's own first choice on ties
    if (score > bestScore) { bestScore = score; best = ws; }
  }
  if (best !== null && r[0].transcript.trim().split(/\s+/).filter(Boolean).length < done) return r[0].transcript.trim().split(/\s+/).filter(Boolean);
  return best || [];
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
  rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 5;
  committed = {};
  rec.onresult = e => {
    let shown = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], done = committed[i] || 0;
      if (r.isFinal) {
        // Final answer: pick the alternative transcript that best fits the Quran text, then judge it fully.
        const ws = bestAlternative(r, done);
        shown += " " + ws.join(" ");
        if (ws.length > done) feed(ws.slice(done).join(" "));
        committed[i] = ws.length;
        clearTimeout(idleTimer);
      } else {
        // Still speaking: turn clearly-correct words green right away; never mark a mistake from a guess.
        const ws = r[0].transcript.trim().split(/\s+/).filter(Boolean);
        shown += " " + ws.join(" ");
        committed[i] = done + softFeed(ws.slice(done, ws.length - 1));
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const d = committed[i] || 0;
          if (listening && ws.length > d) committed[i] = d + softFeed(ws.slice(d));
        }, 500);
      }
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
  if (settings.harakat && serverUrl()) { startLocal("server"); hlog(0, "🎙 Harakat check is on — recording phrases for your server. Pause briefly after each ayah."); }
  else if (settings.harakat) hlog(0, `<span class="bad">Harakat check is ticked but no server address is set (Settings).</span>`);
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
  else if (was) msg("No words were recognised in this session. Speak a little louder or closer to the microphone.", true);
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
      msg(`⬇️ Downloading the Quran speech model${localMode === "harakat" ? " for the harakat check" : ""} (only the first time): ${Math.round(a / 1e6)} / ${Math.round(t / 1e6)} MB`);
    } else if (m.type === "ready") {
      workerReady = true; diag("model-ready" + (m.device ? ":" + m.device : ""));
      if (listening && localMode === "words") msg("🎤 Listening (on-device) — recite, and pause briefly between phrases.");
      if (pendingStart) { pendingStart = false; openMic(); }
    } else if (m.type === "error") {
      diag("model-error"); listening = false; setMicUI(false);
      fatal("The speech model could not be loaded: " + m.message + "\nCheck your internet connection and try again.");
    } else if (m.type === "text") {
      busy = false; diag(`heard(${m.ms || "?"}ms)`);
      if (m.error) diag("model-failed");
      const text = cleanModelText(m.text);
      if (text && listening) {
        $("heard").textContent = text; feed(text);
      }
      if (queued) { const q = queued; queued = null; sendChunk(q); }
    }
  };
  return worker;
}
let pendingStart = false;

function setMicUI(on) {
  $("micLabel").textContent = T(on ? "stop" : "start");
  $("micBtn").classList.toggle("on", on); $("dot").classList.toggle("on", on);
}

let localMode = "words";
function startLocal(mode) {
  localMode = mode || "words";
  listening = true; setMicUI(true);
  if (localMode === "words") { trail = []; diag("on-device"); }
  if (localMode === "server") { openMic(); return; }
  getWorker();
  if (workerReady) { openMic(); return; }
  pendingStart = true;
  if (localMode === "words") msg("Preparing the on-device Quran speech model…");
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
  diag(localMode === "server" ? "harakat-recording" : "mic-on");
  if (localMode === "words") msg("🎤 Listening (on-device) — recite, and pause briefly between phrases.");
}

function onFrame(f) {
  let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  const rms = Math.sqrt(sum / f.length), ms = f.length / RATE * 1000;
  const speaking = rms > Math.max(0.008, noise * 3);
  if (!inSpeech) {
    noise = noise * 0.95 + rms * 0.05;
    preroll.push(f); if (preroll.length > 2) preroll.shift();
    if (speaking) { inSpeech = true; silenceMs = 0; chunkLo = ptr; buf = preroll.slice(); bufLen = buf.reduce((n, x) => n + x.length, 0); preroll = []; diag("speech"); msg("👂 Hearing you…"); }
    return;
  }
  buf.push(f); bufLen += f.length;
  silenceMs = speaking ? 0 : silenceMs + ms;
  const secs = bufLen / RATE;
  // Send a phrase at a pause (or every 7 s during long continuous recitation).
  const minS = localMode === "server" ? 1.5 : 0.8, maxS = localMode === "server" ? 13 : 7;
  if ((silenceMs >= 450 && secs >= minS) || secs >= maxS) flushChunk();
  else if (silenceMs >= 1500) { inSpeech = false; buf = []; bufLen = 0; }
}

function flushChunk() {
  if (!bufLen) return;
  const audio = new Float32Array(bufLen); let o = 0;
  for (const x of buf) { audio.set(x, o); o += x.length; }
  buf = []; bufLen = 0; inSpeech = silenceMs < 450;
  if (localMode === "server") { sendToServer(audio, chunkLo); chunkLo = ptr; return; }
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

/* ---------- Harakat & tajweed check via your Muaalem server (beta) ---------- */
// Google's engine only gives words. When this check is on, the app also records each phrase (cut at
// your pauses, max 13 s) and sends it to YOUR free Hugging Face Space running the open Quran Muaalem
// model. That model writes down the sounds you actually made (with harakat) and compares them with
// the correct recitation, returning harakat (tashkeel), tajweed and letter errors per word.
const TAGS = { bad: "Mistake", skip: "Skipped", harakat: "Harakat", tajweed: "Tajweed", letter: "Letter" };
const PRO = new Set(["harakat", "tajweed", "letter"]);
const SERVER_TYPE = { tashkeel: "harakat", tajweed: "tajweed", normal: "letter" };
function proText(m) {
  const rule = m.rule ? `${esc(m.rule)} — ` : "";
  if (!m.heard) return `${rule}missing <span class="ar ok">${esc(m.expect)}</span>`;
  if (!m.expect) return `${rule}extra sound <span class="ar bad">${esc(m.heard)}</span>`;
  return `${rule}heard <span class="ar bad">${esc(m.heard)}</span> <span class="arrow">→</span> should be <span class="ar ok">${esc(m.expect)}</span>`;
}
let serverChain = Promise.resolve(), serverPending = 0, chunkLo = 0;
const serverUrl = () => (settings.server || "").trim().replace(/\/+$/, "");

function wavBytes(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

// On-screen log of every phrase sent to the harakat server, so problems are visible.
let hlogN = 0;
function hlog(id, html) {
  const box = $("hlog"); if (!box) return;
  $("hlogPanel").style.display = "";
  let row = document.getElementById("hl" + id);
  if (!row) { row = document.createElement("li"); row.id = "hl" + id; box.prepend(row); }
  row.innerHTML = html;
}

function sendToServer(audio, lo) {
  const url = serverUrl(); if (!url || !words[lo]) return;
  const id = ++hlogN, secs = (audio.length / RATE).toFixed(1);
  hlog(id, `<b>Phrase ${id}</b> (${secs}s) — sending…`);
  serverPending++; diag(`checking-harakat(${serverPending})`);
  // Tell the server which ayat this phrase covers (Google's word tracking knows where you are).
  const a = words[Math.max(0, lo - 1)], b = words[Math.min(words.length - 1, ptr + 2)];
  const fd = new FormData(); fd.append("file", wavBytes(audio), "phrase.wav");
  if (a.s === b.s) { fd.append("sura", a.s + 1); fd.append("aya_from", a.a + 1); fd.append("aya_to", Math.min(b.a + 1, a.a + 4)); }
  serverChain = serverChain.then(() => fetch(url + "/check", { method: "POST", body: fd })
    .then(r => r.json()).then(res => {
      const shown = applyServerResult(res, Math.max(0, lo - 2));
      diag(res.found ? `harakat-done(${res.seconds}s)` : "harakat-no-match");
      hlog(id, `<b>Phrase ${id}</b> (${secs}s, ${res.seconds}s on server) — ` + (res.found
        ? `matched <b>${res.start.sura_idx}:${res.start.aya_idx}</b>${res.from_hint ? " (by position)" : ""}; server found ${res.errors.length} issue(s), shown ${shown}.
           <div class="ph">AI heard: <span dir="rtl">${esc(res.phonemes)}</span></div><div class="ph">Correct: <span dir="rtl">${esc(res.reference)}</span></div>`
        : `<span class="bad">could not match this audio to the Quran</span>${res.error ? " — " + esc(res.error) : ""}<div class="ph">AI heard: <span dir="rtl">${esc(res.phonemes || "(nothing)")}</span></div>`));
    })
    .catch(err => { hlog(id, `<b>Phrase ${id}</b> — <span class="bad">server not reachable</span> (${esc(err.message)})`); diag("server-error"); msg("Could not reach your harakat server. It may be waking up (1–2 min) — check Settings.", true); })
    .finally(() => { serverPending--; }));
}

// Map the server's matched text onto our word list, then attach each error to its word.
function applyServerResult(res, lo = 0) {
  if (!res || !res.found || !res.errors) return 0;
  let shown = 0;
  const sw = res.uthmani_text.split(/\s+/).filter(Boolean), st = res.start;
  let best = null;
  for (const aOff of [-1, 0]) {                              // aya index may be 0- or 1-based
    const g = ayahIndex(st.sura_idx - 1, Math.max(0, st.aya_idx + aOff));
    if (!ayahs[g]) continue;
    let j = Math.max(0, ayahs[g].w0 + st.uthmani_word_idx - 2), hits = 0;
    if (res.from_hint && aOff !== -1) continue;               // hint ayah numbers are 1-based
    const map = sw.map(w => {
      const k = key(w); if (!k) return null;
      for (let x = j; x < Math.min(words.length, j + 4); x++) if (same(words[x].key, k)) { j = x + 1; hits++; return x; }
      return null;
    });
    if (!best || hits > best.hits) best = { map, hits };
  }
  if (!best || best.hits < sw.length / 2) { diag("harakat-unmapped"); return 0; }
  // Words where every reported problem is "missing" were simply not in this recording — skip them.
  // "Missing letter" alone is mostly noise (Google already checks whole words), so keep only
  // harakat, tajweed and wrong-letter reports.
  const byWord = new Map();
  for (const e of res.errors) { if (!byWord.has(e.word_offset)) byWord.set(e.word_offset, []); byWord.get(e.word_offset).push(e); }
  const keep = res.errors.filter(e => {
    if (byWord.get(e.word_offset).every(x => x.speech === "delete" || !x.heard)) return false;
    if (e.type === "normal" && (e.speech === "delete" || !e.heard)) return false;
    return true;
  });
  for (const e of keep) {
    const i = best.map[e.word_offset]; if (i == null || i < lo || i >= ptr) continue;   // only words recited in this phrase
    const type = SERVER_TYPE[e.type] || "letter", w = words[i];
    if (w.state === "bad" || w.state === "skip") continue;      // already reported as a word mistake
    const rule = e.rules && e.rules[0] ? e.rules[0].ar : "";
    if (mistakes.some(m => m.i === i && m.type === type && m.expect === e.expected)) continue;
    mistakes.push({ type, i, word: w.text, key: w.key, heard: e.heard, expect: e.expected, rule, s: w.s + 1, ayah: w.a + 1 });
    w.hk = TAGS[type] + (rule ? `: ${rule}` : "") + (e.heard || e.expected ? ` — heard ${e.heard || "nothing"}, should be ${e.expected || "nothing"}` : "");
    touched.add(i); decorate(w); shown++;
  }
  renderMistakes();
  return shown;
}

async function testServer() {
  const url = serverUrl();
  if (!url) { $("serverStatus").textContent = "Paste your Space address first."; return; }
  $("serverStatus").textContent = "Connecting… (a sleeping Space takes 1–2 minutes to wake up)";
  try {
    const r = await fetch(url + "/health"); const j = await r.json();
    $("serverStatus").textContent = j.ok ? "✅ Connected. The harakat & tajweed check will be used when you recite." : "Unexpected answer from the server.";
  } catch { $("serverStatus").textContent = "❌ Could not connect. Check the address (it ends with .hf.space) and that the Space is running."; }
}

/* ---------- History ---------- */
function currentSession() {
  const a = words[startPtr], b = words[Math.max(startPtr, Math.min(ptr, words.length) - 1)];
  const ref = w => `${QURAN[w.s].t} ${w.s + 1}:${w.a + 1}`;
  const ms = mistakes.map(m => ({ ...m, fixed: !PRO.has(m.type) && words[m.i].state === "ok" }));
  return { date: Date.now(), from: ref(a), to: ref(b), surah: a.s + 1, name: QURAN[a.s].t, ...stats, mistakes: ms };
}
function saveSession(finished) {
  const sess = currentSession(), ms = sess.mistakes;
  const hist = store.get("history", []); hist.unshift(sess); store.set("history", hist.slice(0, 300));
  const tot = stats.ok + stats.bad + stats.skip;
  $("summaryBody").innerHTML = `
    <p><b>${sess.from}</b> → <b>${sess.to}</b>${finished ? " (complete)" : ""}</p>
    <div class="stats"><div class="stat"><b>${stats.ok}</b><span>Correct</span></div><div class="stat bad"><b>${stats.bad}</b><span>Mistakes</span></div>
    <div class="stat skip"><b>${stats.skip}</b><span>Skipped</span></div><div class="stat"><b>${Math.round(100 * stats.ok / tot)}%</b><span>Accuracy</span></div></div>
    ${buildReport(ms)}`;
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
    const more = s.mistakes && s.mistakes.length ? `<button class="btn-ghost small-btn" data-report="${hist.indexOf(s)}">View mistakes report</button>` : "";
    return `<div class="sess"><b>${range}</b> · <span class="muted">${new Date(s.date).toLocaleString()}</span><br>
      <span class="ok">${s.ok} correct</span> · <span class="bad">${s.bad} mistakes</span> · <span class="skip">${s.skip} skipped</span> · ${n ? Math.round(100 * s.ok / n) : 0}%<br>${more}</div>`;
  }).join("") : `<p class="muted">No sessions yet.</p>`;
}

/* ---------- End-of-session mistakes report ---------- */
// For every ayah with a mistake: the full ayah with the wrong words highlighted, then each mistake:
// which word (position), what you said, and the correct word.
function buildReport(list) {
  if (!list.length) return `<p class="report-good">ما شاء الله — no mistakes in this session!</p>`;
  const groups = new Map();
  for (const m of list) {
    const k = m.s + ":" + m.ayah;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const html = [...groups].map(([k, ms]) => {
    const sn = +k.split(":")[0], an = +k.split(":")[1];
    const ay = ayahs[ayahIndex(sn - 1, an - 1)];
    const wrong = new Map(ms.filter(m => m.i != null).map(m => [m.i, m]));
    let text = "";
    for (let i = ay.w0; i < ay.w1; i++) {
      const m = wrong.get(i);
      text += m ? `<span class="rw ${m.type}" title="${m.type === "bad" ? "You said: " + esc(m.heard) : m.type === "skip" ? "Skipped" : esc(TAGS[m.type])}">${words[i].text}</span> ` : words[i].text + " ";
    }
    text += `<span class="aya-end">${arNum(an)}</span>`;
    const items = ms.map(m => {
      const pos = m.i != null ? m.i - ay.w0 + 1 : null;
      const where = pos ? `Word ${pos}` : "";
      const what = PRO.has(m.type) ? `<span class="said">${proText(m)}</span>` : m.type === "bad"
        ? `<span class="said">You said <span class="ar bad">${esc(m.heard) || "—"}</span></span> <span class="arrow">→</span> <span class="said">Correct: <span class="ar ok">${m.word}</span></span>`
        : `<span class="said">You skipped</span> <span class="arrow">→</span> <span class="said">Correct: <span class="ar ok">${m.word}</span></span>`;
      return `<li class="ritem ${m.type}"><span class="tag">${TAGS[m.type] || m.type}</span>
        <span class="where">${where}</span>${what}${m.fixed ? ` <span class="fixed-tag">✓ corrected later</span>` : ""}</li>`;
    }).join("");
    return `<section class="rsec"><div class="rhead"><b>${QURAN[sn - 1].t} — ayah ${an}</b> <span class="muted">(${sn}:${an})</span>
      <span class="badge">${ms.length}</span></div>
      <div class="raya" dir="rtl" lang="ar">${text}</div><ol class="rlist">${items}</ol></section>`;
  }).join("");
  return `<h3 class="rtitle">Where you made mistakes</h3>${html}`;
}
const esc = t => String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function showReport(sess) {
  const tot = sess.ok + sess.bad + sess.skip;
  $("summaryBody").innerHTML = `<p><b>${sess.from}</b> → <b>${sess.to}</b> · <span class="muted">${new Date(sess.date).toLocaleString()}</span></p>
    <div class="stats"><div class="stat"><b>${sess.ok}</b><span>Correct</span></div><div class="stat bad"><b>${sess.bad}</b><span>Mistakes</span></div>
    <div class="stat skip"><b>${sess.skip}</b><span>Skipped</span></div><div class="stat"><b>${tot ? Math.round(100 * sess.ok / tot) : 0}%</b><span>Accuracy</span></div></div>
    ${buildReport(sess.mistakes || [])}`;
  $("summary").classList.remove("hidden");
}

/* ---------- Wiring ---------- */
function fillSurahSelect() {
  $("surah").innerHTML = QURAN.map((s, i) => `<option value="${i}">${i + 1}. ${s.t} — ${s.n}</option>`).join("");
}
function fillAyahSelect() {
  const s = QURAN[+$("surah").value];
  $("fromAyah").innerHTML = s.v.map((_, i) => `<option value="${i}">${i + 1}</option>`).join("");
}
function jumpTo(s, a) { stopListening(); stopPlaying(); setStart(ayahs[ayahIndex(s, a)].w0); }

function bind() {
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
    if (b.dataset.view === "history") renderHistory();
  });
  $("surah").onchange = () => { fillAyahSelect(); jumpTo(+$("surah").value, 0); };
  $("fromAyah").onchange = () => jumpTo(+$("surah").value, +$("fromAyah").value);
  $("juzSel").onchange = () => jumpToAyah(META.juz[+$("juzSel").value] - 1);
  $("hizbSel").onchange = () => jumpToAyah(META.hizbQ[+$("hizbSel").value] - 1);
  $("pageSel").onchange = () => jumpToAyah(META.pages[+$("pageSel").value - 1] - 1);
  $("reciterSel").innerHTML = RECITERS.map(([id, n]) => `<option value="${id}">${n}</option>`).join("");
  $("reciterSel").value = settings.reciter || RECITERS[0][0];
  $("reciterSel").onchange = e => { settings.reciter = e.target.value; saveSettings(); restartPlaying(); };
  $("speedSel").onchange = restartPlaying;
  $("ctrlBtn").onclick = () => $("listenBar").scrollIntoView({ behavior: "smooth", block: "center" });
  $("playBtn").onclick = $("dockPlay").onclick = () => playing ? stopPlaying() : startPlaying();
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
  $("micBtn").onclick = () => { stopPlaying(); listening ? stopListening() : startListening(); };
  $("resetBtn").onclick = () => { stopListening(); setStart(startPtr); };
  $("memoBtn").onclick = () => { settings.memo = !settings.memo; saveSettings(); };
  $("sessions").onclick = e => { const b = e.target.closest("[data-report]"); if (b) showReport(store.get("history", [])[+b.dataset.report]); };
  $("summary").onclick = e => { if (e.target.id === "summary") $("summary").classList.add("hidden"); };
  $("summaryX").onclick = () => $("summary").classList.add("hidden");
  $("reportBtn").onclick = () => showReport(currentSession());
  $("summaryClose").onclick = () => $("summary").classList.add("hidden");
  $("clearHist").onclick = () => { if (confirm("Delete all history?")) { store.set("history", []); renderHistory(); } };
  $("tafsirSel").innerHTML = TAFSIRS.map(([id, n]) => `<option value="${id}">${n}</option>`).join("");
  $("tafsirSel").onchange = e => { settings.tafsirEd = e.target.value; saveSettings(); };
  $("optTafsir").onchange = e => { settings.tafsir = e.target.checked; saveSettings(); };
  $("optTransLang").onchange = e => { settings.transLang = e.target.value; saveSettings(); };
  const setLang = v => { settings.lang = v; settings.transLang = v === "ckb" ? "ckb" : v === "en" ? "en" : settings.transLang;
    settings.tafsirEd = (TAFSIRS.find(t => t[2] === v) || TAFSIRS[0])[0]; saveSettings(); };
  $("langSel").onchange = e => setLang(e.target.value);
  $("optLang").onchange = e => setLang(e.target.value);
  $("volSel").oninput = e => { settings.vol = +e.target.value; $("volVal").textContent = settings.vol + "%"; if (gainNode) gainNode.gain.value = settings.vol / 100; };
  $("volSel").onchange = () => saveSettings();
  $("optTrans").onchange = e => { settings.trans = e.target.checked; saveSettings(); };
  $("optSound").onchange = e => { settings.sound = e.target.checked; saveSettings(); };
  $("optVibrate").onchange = e => { settings.vibrate = e.target.checked; saveSettings(); };
  $("optReveal").onchange = e => { settings.reveal = e.target.checked; saveSettings(); };
  $("optFont").oninput = e => { settings.font = +e.target.value; saveSettings(); };
  $("optStrict").onchange = e => { settings.strict = +e.target.value; saveSettings(); };
  $("optTheme").onchange = e => { settings.theme = e.target.value; saveSettings(); };
  $("optServer").onchange = e => { settings.server = e.target.value.trim(); saveSettings(); };
  $("testServer").onclick = testServer;
  $("optHarakat").onchange = e => { stopListening(); settings.harakat = e.target.checked; saveSettings(); };
  $("optEngine").onchange = e => { stopListening(); settings.engine = e.target.value; saveSettings(); };
}

async function init() {
  bind(); applySettings(); resetStats();
  msg("Loading the Quran…");
  try {
    [QURAN, META] = await Promise.all([fetch("data/quran.json").then(r => r.json()), fetch("data/meta.json").then(r => r.json())]);
  } catch { msg("Could not load the Quran text. Check your connection and reload.", true); return; }
  buildModel(); fillSurahSelect(); fillGoto();
  const last = store.get("last", 0);
  $("surah").value = words[typeof last === "number" ? last : 0].s; fillAyahSelect();
  setStart(typeof last === "number" ? last : 0);
  renderHistory();
  if (useLocal()) msg("This browser will use the on-device Quran speech model (downloads about 100 MB the first time). Press the microphone to begin.");
  else msg(T("ready"));
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
