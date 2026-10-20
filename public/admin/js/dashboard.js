import { apiGet, apiPost, getToken, clearToken, isOnline } from "/shared/js/api.js";
import { initScanner } from "/admin/js/qr-scanner.js";
import { renderEvaluation } from "/admin/js/evaluation.js";
import { initExcelImport } from "/admin/js/csv-import.js";
import { initConcerns } from "/admin/js/concerns.js";

if (!getToken("admin")) {
  window.location.href = "/admin/";
}

const profile = JSON.parse(localStorage.getItem("pf_admin_profile") || "{}");
document.getElementById("adminMeta").textContent = profile.fullName ? `${profile.fullName} · ${profile.role}` : "College of Computing Studies";

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearToken("admin");
  localStorage.removeItem("pf_admin_profile");
  window.location.href = "/";
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "roster") loadRoster();
  });
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
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

let currentSnapshot = null;

async function lookupToken(qrToken) {
  document.getElementById("scanStatus").textContent = "Looking up student…";
  try {
    const data = await apiPost("/api/admin/scan", { qrToken }, "admin", { noQueue: true });
    currentSnapshot = data.student;
    document.getElementById("evalEmpty").hidden = true;
    document.getElementById("evalContent").hidden = false;
    renderEvaluation(document.getElementById("evalPrintArea"), currentSnapshot);
    document.getElementById("scanStatus").textContent = "";
    showToast(`Loaded ${currentSnapshot.student.name}`);
  } catch (e) {
    document.getElementById("scanStatus").textContent = e.message || "No student matched that code";
  }
}

initScanner(
  {
    video: document.getElementById("scanVideo"),
    canvas: document.getElementById("scanCanvas"),
    startBtn: document.getElementById("startScanBtn"),
    stopBtn: document.getElementById("stopScanBtn"),
    cameraSelect: document.getElementById("cameraSelect"),
    statusEl: document.getElementById("scanStatus"),
    manualInput: document.getElementById("manualToken"),
    manualBtn: document.getElementById("manualLookupBtn"),
  },
  lookupToken
);

document.getElementById("printEvalBtn").addEventListener("click", () => {
  window.print();
});

document.getElementById("newScanBtn").addEventListener("click", () => {
  currentSnapshot = null;
  document.getElementById("evalEmpty").hidden = false;
  document.getElementById("evalContent").hidden = true;
  document.getElementById("manualToken").value = "";
});

const rosterSearch = document.getElementById("rosterSearch");
const rosterCount = document.getElementById("rosterCount");

function filterRoster() {
  const terms = rosterSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = document.querySelectorAll("#rosterBody tr[data-search]");
  let shown = 0;
  rows.forEach((row) => {
    const hit = terms.every((t) => row.dataset.search.includes(t));
    row.hidden = !hit;
    if (hit) shown++;
  });
  document.getElementById("rosterNoMatch")?.toggleAttribute("hidden", shown > 0 || rows.length === 0);
  rosterCount.textContent = rows.length ? (terms.length ? `${shown} of ${rows.length}` : `${rows.length} students`) : "";
}

rosterSearch.addEventListener("input", filterRoster);
rosterSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    rosterSearch.value = "";
    filterRoster();
  }
});

async function loadRoster() {
  const tbody = document.getElementById("rosterBody");
  try {
    const data = await apiGet("/api/admin/students", "admin");
    if (data.students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No students yet — import a roster above.</td></tr>';
      rosterCount.textContent = "";
      return;
    }
    tbody.innerHTML =
      data.students
        .map((s) => {
          const standing = [s.is_irregular ? "Irregular" : "Regular", s.is_shifter ? "Shifter" : ""].filter(Boolean);
          return `
      <tr data-search="${`${s.student_number} ${s.first_name} ${s.last_name} ${s.program}`.toLowerCase()}">
        <td class="mono col-num">${s.student_number}</td>
        <td><b>${s.last_name}</b>, ${s.first_name}</td>
        <td class="mono col-center">Y${s.year_level}</td>
        <td>${s.program}</td>
        <td>${standing.map((t) => `<span class="standing-tag${t === "Regular" ? "" : " is-flag"}">${t}</span>`).join("")}</td>
        <td><span class="pill pill-${s.status === "active" ? "completed" : "locked"}">${s.status}</span></td>
      </tr>`;
        })
        .join("") +
      '<tr id="rosterNoMatch" hidden><td colspan="6" class="empty-state">No students match your search.</td></tr>';
    filterRoster();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${e.message || "Couldn't load roster"}</td></tr>`;
  }
}

initExcelImport(
  {
    studentDrop: document.getElementById("studentDrop"),
    studentFile: document.getElementById("studentFile"),
    studentBrowseBtn: document.getElementById("studentBrowseBtn"),
    studentResult: document.getElementById("studentImportResult"),
    subjectDrop: document.getElementById("subjectDrop"),
    subjectFile: document.getElementById("subjectFile"),
    subjectBrowseBtn: document.getElementById("subjectBrowseBtn"),
    subjectResult: document.getElementById("subjectImportResult"),
    gradesDrop: document.getElementById("gradesDrop"),
    gradesFile: document.getElementById("gradesFile"),
    gradesBrowseBtn: document.getElementById("gradesBrowseBtn"),
    gradesResult: document.getElementById("gradesImportResult"),
  },
  loadRoster
);

const concernFilterBtns = Array.from(document.querySelectorAll(".concern-filter"));
initConcerns({
  listEl: document.getElementById("concernList"),
  filterBtns: concernFilterBtns,
  countBadge: document.getElementById("concernCount"),
  refreshBtn: document.getElementById("concernRefresh"),
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

loadRoster();
