import { apiGet, apiPost } from "/shared/js/api.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// Timestamps may come back without a zone ("2026-10-20 11:04:00"); treat those as UTC.
function parseDate(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d) ? null : d;
}

function timeAgo(date) {
  if (!date) return "";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function initials(c) {
  return `${(c.first_name || "?")[0]}${(c.last_name || "")[0] || ""}`.toUpperCase();
}

export function initConcerns({ listEl, filterBtns, countBadge, refreshBtn }) {
  let currentStatus = "open";

  function setCount(status, n) {
    filterBtns.forEach((btn) => {
      const el = btn.querySelector(`[data-count="${status}"]`);
      if (el) el.textContent = n;
    });
    if (status === "open") {
      countBadge.hidden = n === 0;
      countBadge.textContent = n;
    }
  }

  async function load() {
    listEl.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const other = currentStatus === "open" ? "resolved" : "open";
      const [data, otherData] = await Promise.all([
        apiGet(`/api/admin/concerns?status=${currentStatus}`, "admin"),
        apiGet(`/api/admin/concerns?status=${other}`, "admin").catch(() => null),
      ]);
      setCount(currentStatus, data.concerns.length);
      if (otherData) setCount(other, otherData.concerns.length);
      renderList(data.concerns);
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">${esc(e.message || "Couldn't load concerns")}</div>`;
    }
  }

  function renderEmpty() {
    const open = currentStatus === "open";
    listEl.innerHTML = `
      <div class="concern-empty card">
        <span class="concern-empty-icon">
          <svg class="icon" viewBox="0 0 24 24">${open ? '<path d="M20 6 9 17l-5-5"></path>' : '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'}</svg>
        </span>
        <h3>${open ? "All caught up" : "No resolved concerns yet"}</h3>
        <p>${open
          ? "Nothing needs staff attention right now. New escalations from the Finder assistant will appear here."
          : "Concerns you mark as resolved will be kept here for reference."}</p>
      </div>`;
  }

  function renderList(concerns) {
    if (concerns.length === 0) return renderEmpty();
    listEl.innerHTML = "";
    concerns.forEach((c) => listEl.appendChild(renderItem(c)));
  }

  function renderItem(c) {
    const open = c.status === "open";
    const created = parseDate(c.created_at);
    const resolved = parseDate(c.resolved_at);
    const item = document.createElement("article");
    item.className = `card concern-item ${open ? "is-open" : "is-resolved"}`;
    item.innerHTML = `
      <div class="concern-top">
        <span class="concern-avatar mono">${esc(initials(c))}</span>
        <div class="concern-who">
          <div class="concern-student">${esc(c.first_name)} ${esc(c.last_name)}</div>
          <div class="concern-meta mono">${esc(c.student_number)} · <time title="${esc(created ? created.toLocaleString() : "")}">${esc(timeAgo(created))}</time></div>
        </div>
        <span class="pill pill-${open ? "open" : "resolved"}">${open ? "open" : "resolved"}</span>
      </div>
      <p class="concern-summary">${esc(c.summary)}</p>
      ${!open && (c.admin_notes || resolved) ? `
        <div class="concern-note">
          <span class="mono">Resolved${resolved ? ` ${esc(timeAgo(resolved))}` : ""}</span>
          ${c.admin_notes ? `<p>${esc(c.admin_notes)}</p>` : ""}
        </div>` : ""}
      <div class="concern-thread" hidden></div>
      <div class="concern-actions">
        ${c.conversation_id ? '<button class="btn-ghost btn-sm thread-btn">View conversation</button>' : ""}
        ${open ? '<button class="btn btn-sm resolve-btn">Mark resolved</button>' : ""}
      </div>
      ${open ? `
        <form class="resolve-form" hidden>
          <label class="mono" for="note-${c.id}">Note for the record (optional)</label>
          <textarea id="note-${c.id}" rows="2" placeholder="e.g. Advised to enlist IT 301 next term; adviser approved overload."></textarea>
          <div class="concern-actions">
            <button type="submit" class="btn btn-sm">Confirm resolve</button>
            <button type="button" class="btn-ghost btn-sm cancel-btn">Cancel</button>
          </div>
          <p class="resolve-hint">The student's chat gets a message that staff resolved it, and the conversation closes.</p>
        </form>` : ""}
    `;

    const threadBtn = item.querySelector(".thread-btn");
    const thread = item.querySelector(".concern-thread");
    if (threadBtn) {
      let loaded = false;
      threadBtn.addEventListener("click", async () => {
        if (!thread.hidden) {
          thread.hidden = true;
          threadBtn.textContent = "View conversation";
          return;
        }
        thread.hidden = false;
        threadBtn.textContent = "Hide conversation";
        if (loaded) return;
        thread.innerHTML = '<p class="thread-empty">Loading conversation…</p>';
        try {
          const data = await apiGet(`/api/ai/conversations/${c.conversation_id}`, "admin");
          loaded = true;
          thread.innerHTML = data.messages.length
            ? data.messages
                .map((m) => `<div class="thread-msg from-${m.sender === "student" ? "student" : "ai"}"><span class="mono">${m.sender === "student" ? "Student" : "Finder"}</span><p>${esc(m.content)}</p></div>`)
                .join("")
            : '<p class="thread-empty">No messages in this conversation.</p>';
        } catch (e) {
          thread.innerHTML = `<p class="thread-empty">${esc(e.message || "Couldn't load the conversation")}</p>`;
        }
      });
    }

    if (open) {
      const resolveBtn = item.querySelector(".resolve-btn");
      const form = item.querySelector(".resolve-form");
      const textarea = form.querySelector("textarea");
      resolveBtn.addEventListener("click", () => {
        form.hidden = false;
        resolveBtn.hidden = true;
        textarea.focus();
      });
      form.querySelector(".cancel-btn").addEventListener("click", () => {
        form.hidden = true;
        resolveBtn.hidden = false;
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = "Resolving…";
        try {
          await apiPost(`/api/admin/concerns/${c.id}/resolve`, { notes: textarea.value.trim() }, "admin", { noQueue: true });
          load();
        } catch (err) {
          submit.disabled = false;
          submit.textContent = "Confirm resolve";
        }
      });
    }
    return item;
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-pressed", b === btn);
      });
      currentStatus = btn.dataset.status;
      load();
    });
  });
  if (refreshBtn) refreshBtn.addEventListener("click", load);

  load();
  return { reload: load };
}
