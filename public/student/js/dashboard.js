import { apiGet, apiPost, getToken, clearToken, isOnline, flushOutbox } from "/shared/js/api.js";
import { renderConstellation, renderSubjectGrid, renderStatusBar, renderRoadmap, yearLabel, countByStatus, applySubjectFilter } from "/student/js/pathfinder.js";
import { renderChips, currentUnits, renderUnitMeter, renderSchedule } from "/student/js/scheduler.js";
import { renderQr } from "/student/js/qr-card.js";
import { initChat } from "/student/js/ai-chat.js";

if (!getToken("student")) {
  window.location.href = "/student/";
}

const profile = JSON.parse(localStorage.getItem("pf_student_profile") || "{}");
document.getElementById("studentMeta").textContent = profile.firstName
  ? `${profile.firstName} ${profile.lastName} · ${profile.studentNumber}`
  : "Universidad de Manila — College of Computing Studies";

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearToken("student");
  localStorage.removeItem("pf_student_profile");
  window.location.href = "/";
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "qr") loadQr();
    closeDrawer();
  });
});

const tabbar = document.getElementById("tabbar");
const drawerOverlay = document.getElementById("drawerOverlay");
function openDrawer() {
  tabbar.classList.add("open");
  drawerOverlay.classList.add("open");
}
function closeDrawer() {
  tabbar.classList.remove("open");
  drawerOverlay.classList.remove("open");
}
document.getElementById("hamburgerBtn").addEventListener("click", openDrawer);
document.getElementById("drawerCloseBtn").addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

const finderFab = document.getElementById("finderFab");
const finderPanel = document.getElementById("finderPanel");
finderFab.addEventListener("click", () => {
  finderPanel.hidden = !finderPanel.hidden;
});
document.getElementById("finderCloseBtn").addEventListener("click", () => {
  finderPanel.hidden = true;
});

const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
function setTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  themeIcon.innerHTML =
    mode === "dark"
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'
      : '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  localStorage.setItem("pf_theme", mode);
}
themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  setTheme(cur === "dark" ? "light" : "dark");
});
setTheme(localStorage.getItem("pf_theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

const offlineBanner = document.getElementById("offlineBanner");
function updateOfflineBanner() {
  offlineBanner.classList.toggle("show", !isOnline());
}
window.addEventListener("online", () => {
  updateOfflineBanner();
  flushOutbox().then((r) => {
    if (r.flushed > 0) {
      showToast(`Synced ${r.flushed} update${r.flushed === 1 ? "" : "s"} saved while offline`);
      loadProgress();
    }
  });
});
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

let subjectsById = {};
let termBuilderIds = new Set();
let unitCap = 21;
const selectedTerm = new Set();
let lastResult = null;

function termBuilderSubjects(subjects) {
  return subjects.filter((subject) => termBuilderIds.has(subject.id) && subject.status !== "failed");
}

async function loadProgress() {
  try {
    const data = await apiGet(`/api/students/${profile.id}/progress`, "student");
    const subjects = data.progress.subjects;
    termBuilderIds = new Set(data.progress.termBuilderSubjectIds || []);
    subjectsById = {};
    subjects.forEach((s) => (subjectsById[s.id] = s));

    const prereqMap = data.progress.prereqMap || {};

    const svg = document.getElementById("constellation");
    renderConstellation(svg, subjects, prereqMap, toggleCompleted);
    renderSubjectGrid(document.getElementById("subjectGrid"), subjects, toggleCompleted);
    updateFilterCounts(subjects);
    runFilter();

    document.getElementById("statCompletedUnits").textContent = data.progress.completedUnits;
    document.getElementById("statRemainingUnits").textContent = data.progress.remainingUnits;
    document.getElementById("statTotalUnits").textContent = data.progress.totalUnits;
    document.getElementById("statSemesters").textContent = data.progress.estSemesters;
    document.getElementById("ringPct").textContent = data.progress.percentComplete + "%";
    const r = 72, c = 2 * Math.PI * r;
    const ring = document.getElementById("ringFill");
    ring.setAttribute("stroke-dasharray", c);
    ring.setAttribute("stroke-dashoffset", c - (data.progress.percentComplete / 100) * c);

    const p = data.progress;
    document.getElementById("progressHeadline").textContent = `${p.completedUnits} of ${p.totalUnits} units earned`;
    document.getElementById("progressSub").textContent = p.remainingUnits
      ? `≈ ${p.estSemesters} semester${p.estSemesters === 1 ? "" : "s"} to go at 18 units/term`
      : "All program units completed";
    renderStatusBar(document.getElementById("statusBar"), document.getElementById("statusLegend"), subjects);
    renderRoadmap(document.getElementById("roadmap"), subjects);

    renderChips(
      document.getElementById("eligibleChips"),
      termBuilderSubjects(subjects),
      selectedTerm,
      unitCap,
      onChipToggle
    );
    renderUnitMeter(document.getElementById("unitFill"), document.getElementById("unitLabel"), currentUnits(selectedTerm, subjectsById), unitCap);

    if (data.__offline) showToast("Showing your last saved progress (offline)");
  } catch (e) {
    showToast(e.message || "Couldn't load your progress");
  }
}

const searchInput = document.getElementById("subjectSearch");
const statusFilter = document.getElementById("statusFilter");
let filterStatus = "all";

function updateFilterCounts(subjects) {
  const counts = countByStatus(subjects);
  statusFilter.querySelectorAll("[data-count]").forEach((n) => (n.textContent = counts[n.dataset.count]));
}

function runFilter() {
  const total = Object.keys(subjectsById).length;
  const shown = applySubjectFilter(
    document.getElementById("subjectGrid"),
    document.getElementById("constellation"),
    searchInput.value,
    filterStatus
  );
  const active = searchInput.value.trim() || filterStatus !== "all";
  document.getElementById("filterResult").textContent = active ? `${shown} of ${total} subjects` : "";
  document.getElementById("filterEmpty").hidden = !(active && shown === 0);
}

function setFilterStatus(status) {
  filterStatus = status;
  statusFilter.querySelectorAll(".filter-chip").forEach((chip) => {
    const on = chip.dataset.status === status;
    chip.classList.toggle("selected", on);
    chip.setAttribute("aria-pressed", on);
  });
  runFilter();
}

searchInput.addEventListener("input", runFilter);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchInput.value = "";
    runFilter();
  }
});
statusFilter.addEventListener("click", (e) => {
  const chip = e.target.closest(".filter-chip");
  if (chip) setFilterStatus(chip.dataset.status);
});
document.getElementById("filterClear").addEventListener("click", () => {
  searchInput.value = "";
  setFilterStatus("all");
  searchInput.focus();
});
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && document.getElementById("tab-eligibility").classList.contains("active")) {
    e.preventDefault();
    searchInput.focus();
  }
});

async function toggleCompleted(subjectId) {
  const s = subjectsById[subjectId];
  if (!s) return;
  const nextStatus = s.status === "completed" ? "not_taken" : s.status === "eligible" ? "completed" : null;
  if (!nextStatus) {
    showToast(`${s.code} needs its prerequisites first`);
    return;
  }
  try {
    const data = await apiPost(`/api/students/${profile.id}/subjects/${subjectId}`, { status: nextStatus }, "student");
    if (data.__queued) {
      showToast(`${s.code} update saved — will sync when you're back online`);
      s.status = nextStatus === "not_taken" ? "locked" : "completed";
      renderSubjectGrid(document.getElementById("subjectGrid"), Object.values(subjectsById), toggleCompleted);
      updateFilterCounts(Object.values(subjectsById));
      runFilter();
      return;
    }
    showToast(nextStatus === "completed" ? `${s.code} marked complete` : `${s.code} marked incomplete`);
    await loadProgress();
  } catch (e) {
    showToast(e.message || "Couldn't update that subject");
  }
}

function onChipToggle(subject) {
  if (selectedTerm.has(subject.id)) {
    selectedTerm.delete(subject.id);
  } else {
    const total = currentUnits(selectedTerm, subjectsById);
    if (total + subject.units > unitCap) {
      showToast(`Adding ${subject.code} would exceed your ${unitCap}-unit cap`);
      return;
    }
    selectedTerm.add(subject.id);
  }
  renderChips(
    document.getElementById("eligibleChips"),
    termBuilderSubjects(Object.values(subjectsById)),
    selectedTerm,
    unitCap,
    onChipToggle
  );
  renderUnitMeter(document.getElementById("unitFill"), document.getElementById("unitLabel"), currentUnits(selectedTerm, subjectsById), unitCap);
}

document.getElementById("unitCap").addEventListener("input", (e) => {
  const v = parseInt(e.target.value, 10);
  unitCap = isNaN(v) ? 21 : Math.max(3, Math.min(27, v));
  renderUnitMeter(document.getElementById("unitFill"), document.getElementById("unitLabel"), currentUnits(selectedTerm, subjectsById), unitCap);
});

document.getElementById("generateBtn").addEventListener("click", async () => {
  if (selectedTerm.size === 0) {
    showToast("Select at least one subject first");
    return;
  }
  try {
    const data = await apiPost("/api/schedule/generate", { subjectIds: Array.from(selectedTerm), term: "upcoming" }, "student", { noQueue: true });
    lastResult = data.result;
    renderSchedule(document.getElementById("scheduleGrid"), document.getElementById("conflictLog"), lastResult, subjectsById);
    showToast(`Scheduler placed ${lastResult.accepted.length} of ${selectedTerm.size} subjects`);
  } catch (e) {
    showToast(e.message || "Scheduler is unavailable right now — try again once you're online");
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  selectedTerm.clear();
  lastResult = null;
  renderChips(document.getElementById("eligibleChips"), termBuilderSubjects(Object.values(subjectsById)), selectedTerm, unitCap, onChipToggle);
  renderUnitMeter(document.getElementById("unitFill"), document.getElementById("unitLabel"), 0, unitCap);
  renderSchedule(document.getElementById("scheduleGrid"), document.getElementById("conflictLog"), null, subjectsById);
});

let qrLoaded = false;
async function loadQr() {
  if (qrLoaded) return;
  try {
    const data = await apiGet("/api/students/me/qr", "student");
    document.getElementById("qrName").textContent = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    document.getElementById("qrNumber").textContent = data.studentNumber;
    document.getElementById("qrYear").textContent = yearLabel(Number(profile.yearLevel) || 1);
    document.getElementById("qrStanding").textContent =
      [profile.isIrregular ? "Irregular" : "Regular", profile.isShifter ? "Shifter" : ""].filter(Boolean).join(" · ");
    renderQr(document.getElementById("qrBox"), data.qrToken);
    qrLoaded = true;
  } catch (e) {
    document.getElementById("qrBox").innerHTML = '<div class="empty-state">QR code needs an internet connection the first time it loads.</div>';
  }
}

initChat({
  form: document.getElementById("chatForm"),
  input: document.getElementById("chatInput"),
  sendBtn: document.getElementById("chatSendBtn"),
  logEl: document.getElementById("chatLog"),
  statusEl: document.getElementById("chatStatus"),
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

loadProgress();
if (isOnline()) flushOutbox();
