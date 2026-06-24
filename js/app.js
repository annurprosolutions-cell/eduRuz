/* ===================================================
   EduRuz v2 — App Engine
   =================================================== */

const state = {
  lang: "ms",
  userName: "",
  userPhoto: null, // data URL
  ageGroup: null,
  categoryKey: null,
  levelKey: null,
  questions: [],
  currentIndex: 0,
  score: 0,
  correctCount: 0,
  wrongCount: 0,
  answered: false,
  timerInterval: null,
  timeLeft: 15,
  soundOn: true,
  progress: {}, // progress[ageGroup][categoryKey][levelKey] = { passed: bool, pct: number }
};

const TIMER_SECONDS = 15;
const TIMER_RADIUS = 23;
const TIMER_CIRC = 2 * Math.PI * TIMER_RADIUS;
const STORAGE_KEY = "eduruz_progress_v2";

// ---------- Utility ----------
function t(key) { return I18N[state.lang][key] || key; }
function $(id) { return document.getElementById(id); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function answerLetterToIndex(letter) {
  return { A: 0, B: 1, C: 2, D: 3 }[letter] ?? 0;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.progress = raw ? JSON.parse(raw) : {};
  } catch (e) { state.progress = {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); } catch (e) {}
}
function getLevelProgress(age, cat, level) {
  return (state.progress[age] && state.progress[age][cat] && state.progress[age][cat][level]) || null;
}
function setLevelProgress(age, cat, level, data) {
  if (!state.progress[age]) state.progress[age] = {};
  if (!state.progress[age][cat]) state.progress[age][cat] = {};
  state.progress[age][cat][level] = data;
  saveProgress();
}
function isLevelUnlocked(age, cat, levelIdx) {
  if (levelIdx === 0) return true;
  const prevLevel = LEVELS[levelIdx - 1];
  const prog = getLevelProgress(age, cat, prevLevel.key);
  return !!(prog && prog.passed);
}

// ---------- Screen navigation ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0, 0);
}

// ---------- Sound effects ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freqs, durMs, type = "sine") {
  if (!state.soundOn) return;
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + durMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + durMs / 1000 + 0.05);
    });
  } catch (e) {}
}
function soundCorrect() { playTone([523.25, 659.25, 783.99], 0.4, "sine"); }
function soundWrong() { playTone([311.13, 261.63], 0.35, "sine"); }
function soundClick() { playTone([440], 0.08, "sine"); }
function soundTimeUp() { playTone([392, 329.63, 261.63], 0.5, "triangle"); }
function soundComplete() { playTone([523.25, 659.25, 783.99, 1046.5], 0.6, "sine"); }

// ---------- TTS ----------
let voicesCache = [];
function loadVoices() { voicesCache = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}
function speakText(text) {
  if (!state.soundOn || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const cleanText = text.replace(/\?/g, "").replace(/…/g, "");
  const utter = new SpeechSynthesisUtterance(cleanText);
  utter.lang = state.lang === "ms" ? "ms-MY" : "en-US";
  utter.rate = 0.92;
  utter.pitch = 1.15;
  const preferred = voicesCache.find(v =>
    (state.lang === "ms" && /ms|malay|id/i.test(v.lang)) ||
    (state.lang === "en" && /female|woman/i.test(v.name) && /en/i.test(v.lang))
  );
  const fallback = voicesCache.find(v => v.lang.toLowerCase().startsWith(state.lang === "ms" ? "ms" : "en"));
  if (preferred) utter.voice = preferred;
  else if (fallback) utter.voice = fallback;
  window.speechSynthesis.speak(utter);
}
function speakCurrentQuestion() {
  const q = state.questions[state.currentIndex];
  if (q) speakText(q[state.lang].text);
}

// ---------- Language ----------
function setLang(lang) {
  state.lang = lang;
  document.querySelectorAll(".lang-toggle button").forEach(b => b.classList.toggle("active", b.dataset.lang === lang));
  applyI18nStatic();
}
function applyI18nStatic() {
  $("heroTitle").textContent = t("heroTitle");
  $("heroSub").textContent = t("heroSub");
  $("nameLabel").textContent = t("nameLabel");
  $("nameInput").placeholder = t("namePlaceholder");
  $("photoLabel").textContent = t("photoLabel");
  $("photoUploadBtnText").textContent = t("photoUploadBtn");
  $("startBtnText").textContent = t("startBtn");
  $("chooseAgeTitle").textContent = t("chooseAge");
  $("chooseAgeSub").textContent = t("chooseAgeSub");
  renderAgeGroups();
}

// ---------- Photo upload ----------
function initPhotoUpload() {
  const circle = $("photoCircle");
  const fileInput = $("photoFileInput");
  circle.onclick = () => fileInput.click();
  $("photoUploadBtn").onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.userPhoto = ev.target.result;
      renderPhotoPreview();
    };
    reader.readAsDataURL(file);
  };
}
function renderPhotoPreview() {
  const circle = $("photoCircle");
  if (state.userPhoto) {
    circle.innerHTML = `<img src="${state.userPhoto}" alt="profile">`;
  } else {
    circle.innerHTML = `<svg class="placeholder-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="#FF8C42" stroke-width="2"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" stroke="#FF8C42" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
}

// ---------- Age groups ----------
function renderAgeGroups() {
  const wrap = $("ageGrid");
  wrap.innerHTML = "";
  AGE_GROUPS.forEach(ag => {
    const div = document.createElement("div");
    div.className = "age-card";
    div.innerHTML = `<div class="age-icon">${ag.icon}</div><div><h3>${ag.label[state.lang]}</h3><p>${ag.sub[state.lang]}</p></div>`;
    div.onclick = () => { soundClick(); state.ageGroup = ag.key; goToCategoryScreen(); };
    wrap.appendChild(div);
  });
}
function backToAge() { showScreen("screen-age"); }

// ---------- Categories ----------
function goToCategoryScreen() {
  $("categoryTitle").textContent = t("chooseCategory");
  const wrap = $("categoryGrid");
  wrap.innerHTML = "";
  const catKeys = CATEGORY_ORDER[state.ageGroup] || [];
  catKeys.forEach(catKey => {
    const hasData = !!(QUESTION_BANK[state.ageGroup] && QUESTION_BANK[state.ageGroup][catKey]);
    const label = CATEGORY_LABELS[catKey][state.lang];
    const icon = ICONS_UI[catKey] || "";
    const div = document.createElement("div");
    div.className = "category-card";
    div.style.opacity = hasData ? "1" : "0.4";

    let dotsHtml = "";
    if (hasData) {
      dotsHtml = `<div class="progress-dots">` + LEVELS.map(lvl => {
        const prog = getLevelProgress(state.ageGroup, catKey, lvl.key);
        return `<span class="dot${prog && prog.passed ? ' done' : ''}"></span>`;
      }).join("") + `</div>`;
    }

    div.innerHTML = `${icon}<span>${label}</span>${dotsHtml}${hasData ? "" : `<span style="font-size:0.62rem;color:#E8650F;">Soon</span>`}`;
    div.onclick = () => {
      if (!hasData) { soundWrong(); return; }
      soundClick();
      state.categoryKey = catKey;
      goToLevelScreen();
    };
    wrap.appendChild(div);
  });
  showScreen("screen-category");
}
function backToCategory() { goToCategoryScreen(); }

// ---------- Level select ----------
function goToLevelScreen() {
  $("levelTitle").textContent = t("chooseLevel");
  const wrap = $("levelGrid");
  wrap.innerHTML = "";
  LEVELS.forEach((lvl, idx) => {
    const unlocked = isLevelUnlocked(state.ageGroup, state.categoryKey, idx);
    const prog = getLevelProgress(state.ageGroup, state.categoryKey, lvl.key);
    const div = document.createElement("div");
    div.className = `level-card ${lvl.key}` + (unlocked ? "" : " locked");
    const badgeNum = idx + 1;
    let lockIcon = "";
    if (!unlocked) {
      lockIcon = `<svg class="lock-icon" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" fill="#9A7355"/><path d="M8 11V8a4 4 0 018 0v3" stroke="#9A7355" stroke-width="2"/></svg>`;
    } else if (prog && prog.passed) {
      lockIcon = `<svg class="lock-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#4CAF50"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    }
    div.innerHTML = `
      <div class="level-badge">${badgeNum}</div>
      <div class="level-info">
        <h3>${lvl.label[state.lang]}</h3>
        <p>${lvl.count} ${t("questionsLabel")}</p>
      </div>
      ${lockIcon}`;
    div.onclick = () => {
      if (!unlocked) { soundWrong(); return; }
      soundClick();
      state.levelKey = lvl.key;
      startGame();
    };
    wrap.appendChild(div);
  });
  showScreen("screen-level");
}
function backToLevel() { goToLevelScreen(); }

// ---------- Game logic ----------
function startGame() {
  const catData = QUESTION_BANK[state.ageGroup][state.categoryKey];
  const levelDef = LEVELS.find(l => l.key === state.levelKey);
  const pool = shuffle(catData.questions);
  state.questions = pool.slice(0, Math.min(levelDef.count, pool.length));
  state.currentIndex = 0;
  state.score = 0;
  state.correctCount = 0;
  state.wrongCount = 0;
  renderQuestion();
  showScreen("screen-game");
}

function renderQuestion() {
  state.answered = false;
  const q = state.questions[state.currentIndex];
  const qLang = q[state.lang]; // { text, options }
  const total = state.questions.length;

  $("gameProgressPill").textContent = `${state.currentIndex + 1} / ${total}`;
  $("gameProgressBarFill").style.width = `${(state.currentIndex / total) * 100}%`;
  $("feedbackBanner").classList.remove("show", "correct", "wrong");
  $("feedbackBanner").innerHTML = "";

  $("questionText").textContent = qLang.text;

  const visualWrap = $("questionVisual");
  visualWrap.innerHTML = renderVisual(q);

  const optionIndices = qLang.options.map((_, i) => i);
  const shuffled = shuffle(optionIndices);
  state.currentOptionOrder = shuffled;

  const list = $("optionsList");
  list.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  shuffled.forEach((origIdx, displayIdx) => {
    const opt = qLang.options[origIdx];
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.innerHTML = `<span class="opt-letter">${letters[displayIdx]}</span><span>${opt}</span>`;
    btn.onclick = () => handleAnswer(origIdx, btn);
    list.appendChild(btn);
  });

  $("nextBtnWrap").style.display = "none";
  startTimer();
  setTimeout(() => speakCurrentQuestion(), 350);
}

function renderVisual(q) {
  if (q.visualType === "jawi") {
    return `<div style="font-size:4.5rem;color:#5A3825;font-weight:700;">${q.visualValue}</div>`;
  }
  if (q.visualType === "number") {
    return `<div style="font-size:4.5rem;color:#FF8C42;font-weight:800;font-family:'Baloo 2',sans-serif;">${q.visualValue}</div>`;
  }
  // photo / fallback -> big emoji
  return `<div style="font-size:5rem;line-height:1;">${q.visualEmoji}</div>`;
}

function startTimer() {
  clearInterval(state.timerInterval);
  state.timeLeft = TIMER_SECONDS;
  updateTimerRing();
  state.timerInterval = setInterval(() => {
    state.timeLeft -= 1;
    updateTimerRing();
    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      if (!state.answered) handleTimeUp();
    }
  }, 1000);
}
function updateTimerRing() {
  const ring = $("timerRingProgress");
  const offset = TIMER_CIRC * (1 - state.timeLeft / TIMER_SECONDS);
  ring.style.strokeDashoffset = offset;
  $("timerNum").textContent = state.timeLeft;
  $("timerRingWrap").classList.toggle("urgent", state.timeLeft <= 4);
}

function handleTimeUp() {
  state.answered = true;
  state.wrongCount += 1;
  soundTimeUp();
  const q = state.questions[state.currentIndex];
  revealAnswer(null, q);
  showFeedback(false, q, true);
}

function handleAnswer(selectedOrigIdx, btnEl) {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.timerInterval);
  const q = state.questions[state.currentIndex];
  const isCorrect = selectedOrigIdx === q.correctIndex;

  if (isCorrect) {
    state.score += Math.max(10, state.timeLeft * 10);
    state.correctCount += 1;
    soundCorrect();
  } else {
    state.wrongCount += 1;
    soundWrong();
  }
  revealAnswer(selectedOrigIdx, q);
  showFeedback(isCorrect, q, false);
}

function revealAnswer(selectedOrigIdx, q) {
  const buttons = $("optionsList").querySelectorAll(".option-btn");
  state.currentOptionOrder.forEach((origIdx, displayIdx) => {
    const btn = buttons[displayIdx];
    btn.classList.add("disabled-option");
    if (origIdx === q.correctIndex) btn.classList.add("correct");
    else if (origIdx === selectedOrigIdx) btn.classList.add("wrong");
  });
}

function showFeedback(isCorrect, q, timedOut) {
  const banner = $("feedbackBanner");
  banner.classList.remove("correct", "wrong");
  if (isCorrect) {
    banner.classList.add("correct", "show");
    banner.innerHTML = `✅ ${t("correct")}`;
  } else {
    banner.classList.add("wrong", "show");
    const label = timedOut ? t("timeUp") : t("wrong");
    const letters = ["A", "B", "C", "D"];
    const correctLetter = letters[state.currentOptionOrder.indexOf(q.correctIndex)];
    banner.innerHTML = `❌ ${label}<span class="scheme-note">${t("schemeLabel")} ${correctLetter}. ${q[state.lang].options[q.correctIndex]}</span>`;
  }
  $("nextBtnWrap").style.display = "block";
  const isLast = state.currentIndex >= state.questions.length - 1;
  $("nextBtnLabel").textContent = isLast ? t("finish") : t("next");
}

function goNextQuestion() {
  soundClick();
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
  } else {
    finishGame();
  }
}

function finishGame() {
  clearInterval(state.timerInterval);
  const total = state.questions.length;
  const pct = Math.round((state.correctCount / total) * 100);
  const levelDef = LEVELS.find(l => l.key === state.levelKey);
  const passed = pct >= levelDef.passPct;

  setLevelProgress(state.ageGroup, state.categoryKey, state.levelKey, { passed: passed || levelDef.passPct === 0, pct, score: state.score });
  // Easy level always "passes" to unlock next, since passPct is 0
  if (levelDef.passPct === 0) {
    setLevelProgress(state.ageGroup, state.categoryKey, state.levelKey, { passed: true, pct, score: state.score });
  }

  $("gameProgressBarFill").style.width = "100%";

  let titleKey = "resultTitleTry";
  if (pct >= 80) titleKey = "resultTitleGreat";
  else if (pct >= 50) titleKey = "resultTitleGood";

  $("resultTitle").textContent = t(titleKey);
  $("resultPct").textContent = pct + "%";
  $("resultScoreLbl").textContent = t("resultScoreLabel");
  $("resultCorrectNum").textContent = state.correctCount;
  $("resultCorrectLbl").textContent = t("resultCorrectLabel");
  $("resultWrongNum").textContent = state.wrongCount;
  $("resultWrongLbl").textContent = t("resultWrongLabel");
  $("playAgainBtn").textContent = t("playAgain");
  $("backToCategoriesBtn").textContent = t("backToCategories");
  $("viewCertificateBtn").textContent = t("viewCertificate");

  const nextLevelIdx = LEVELS.findIndex(l => l.key === state.levelKey) + 1;
  const nextBtnWrap = $("nextLevelBtnWrap");
  if (nextLevelIdx < LEVELS.length) {
    $("nextLevelBtn").textContent = t("nextLevel");
    nextBtnWrap.style.display = "block";
  } else {
    nextBtnWrap.style.display = "none";
  }

  const circumference = 2 * Math.PI * 70;
  const offset = circumference * (1 - pct / 100);
  $("resultRingProgress").style.strokeDasharray = circumference;
  $("resultRingProgress").style.strokeDashoffset = circumference;

  showScreen("screen-result");
  soundComplete();
  if (pct >= 50) launchConfetti();

  setTimeout(() => {
    $("resultRingProgress").style.transition = "stroke-dashoffset 1s ease";
    $("resultRingProgress").style.strokeDashoffset = offset;
  }, 100);
}

function launchConfetti() {
  const colors = ["#FF8C42", "#FFD9B3", "#FFD166", "#4CAF50", "#FFF6E9"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const size = 6 + Math.random() * 6;
    piece.style.width = size + "px";
    piece.style.height = size * 0.6 + "px";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2.5 + Math.random() * 2) + "s";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

function playAgain() { soundClick(); goToLevelScreen(); }
function goToNextLevel() {
  soundClick();
  const idx = LEVELS.findIndex(l => l.key === state.levelKey);
  if (idx + 1 < LEVELS.length) {
    state.levelKey = LEVELS[idx + 1].key;
    startGame();
  }
}
function backToCategoriesFromResult() { soundClick(); goToCategoryScreen(); }
function backToHomeFromResult() { soundClick(); showScreen("screen-hero"); }

// ---------- Certificate ----------
function showCertificate() {
  soundClick();
  $("certUserName").textContent = state.userName;
  $("certCategoryLevel").textContent = `${CATEGORY_LABELS[state.categoryKey][state.lang]} — ${LEVELS.find(l=>l.key===state.levelKey).label[state.lang]}`;
  $("certScoreText").textContent = `${t("certScore")} ${state.score} (${state.correctCount}/${state.questions.length})`;
  $("certTitleText").textContent = t("certTitle");
  $("certSubText").textContent = t("certSub");
  $("certCompletedText").textContent = t("certCompleted");
  $("downloadCertBtn").textContent = t("downloadCert");
  if (state.userPhoto) {
    $("certPhotoWrap").innerHTML = `<img src="${state.userPhoto}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;">`;
  } else {
    $("certPhotoWrap").innerHTML = "";
  }
  showScreen("screen-certificate");
}
function closeCertificate() { soundClick(); showScreen("screen-result"); }
function downloadCertificate() {
  soundClick();
  const certEl = $("certificateCard");
  if (window.html2canvas) {
    html2canvas(certEl, { scale: 2, backgroundColor: "#FFFFFF" }).then(canvas => {
      const link = document.createElement("a");
      link.download = `Sijil-EduRuz-${state.userName}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  }
}

// ---------- Sound toggle ----------
function toggleSound() {
  state.soundOn = !state.soundOn;
  $("soundToggleIcon").textContent = state.soundOn ? "🔊" : "🔇";
  if (!state.soundOn && window.speechSynthesis) window.speechSynthesis.cancel();
}

// ---------- Start flow ----------
function attemptStart() {
  const name = $("nameInput").value.trim();
  if (!name) {
    $("nameInput").focus();
    $("nameInput").style.borderColor = "#E74C3C";
    setTimeout(() => { $("nameInput").style.borderColor = ""; }, 1200);
    return;
  }
  state.userName = name;
  soundClick();
  renderAgeGroups();
  $("userBadgeName").textContent = name;
  if (state.userPhoto) {
    $("userBadgeAvatar").innerHTML = `<img src="${state.userPhoto}">`;
  } else {
    $("userBadgeAvatar").innerHTML = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="#FF8C42"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" stroke="#FF8C42" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  $("greetingNameText").textContent = `${t("greetingPrefix")} ${name}!`;
  $("greetingSubText").textContent = t("greetingSub");
  showScreen("screen-age");
}

// ---------- Init ----------
function initApp() {
  loadProgress();
  document.querySelectorAll(".lang-toggle button").forEach(b => {
    b.onclick = () => { soundClick(); setLang(b.dataset.lang); };
  });
  setLang("ms");
  initPhotoUpload();
  renderPhotoPreview();

  $("startBtn").onclick = attemptStart;
  $("backToAgeBtn").onclick = () => { soundClick(); backToAge(); };
  $("backToCategoryBtn").onclick = () => { soundClick(); backToCategory(); };
  $("backToLevelBtn").onclick = () => { soundClick(); backToLevel(); };
  $("nextBtn").onclick = goNextQuestion;
  $("speakBtn").onclick = () => { soundClick(); speakCurrentQuestion(); };
  $("playAgainBtn").onclick = playAgain;
  $("nextLevelBtn").onclick = goToNextLevel;
  $("backToCategoriesBtn").onclick = backToCategoriesFromResult;
  $("backToHomeBtn").onclick = backToHomeFromResult;
  $("viewCertificateBtn").onclick = showCertificate;
  $("closeCertificateBtn").onclick = closeCertificate;
  $("downloadCertBtn").onclick = downloadCertificate;
  $("soundToggleFab").onclick = toggleSound;
  showScreen("screen-hero");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", initApp);
