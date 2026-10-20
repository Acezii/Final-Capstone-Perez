import { apiGet, apiPost } from "/shared/js/api.js";

export function initConcerns({ listEl, filterBtns, countBadge }) {
  let currentStatus = "open";

  async function load() {
    listEl.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const data = await apiGet(`/api/admin/concerns?status=${currentStatus}`, "admin");
      renderList(data.concerns);
      if (currentStatus === "open") {
        if (data.concerns.length > 0) {
          countBadge.hidden = false;
          countBadge.textContent = data.concerns.length;
        } else {
          countBadge.hidden = true;
        }
      }
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">${e.message || "Couldn't load concerns"}</div>`;
    }
  }

  function renderList(concerns) {
    if (concerns.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No ${currentStatus} concerns right now.</div>`;
      return;
    }
    listEl.innerHTML = "";
    concerns.forEach((c) => {
      const item = document.createElement("div");
      item.className = "card concern-item";
      item.innerHTML = `
        <div class="concern-top">
          <div>
            <div class="concern-student">${c.first_name} ${c.last_name} <span class="mono" style="color:var(--text-muted);font-weight:400;">· ${c.student_number}</span></div>
            <div class="concern-meta">${new Date(c.created_at).toLocaleString()}</div>
          </div>
          <span class="pill pill-${c.status === "open" ? "open" : "resolved"}">${c.status}</span>
        </div>
        <div class="concern-summary">${c.summary}</div>
        ${c.status === "open" ? '<div class="concern-actions"><button class="btn btn-sm resolve-btn">Mark resolved</button></div>' : ""}
      `;
      if (c.status === "open") {
        item.querySelector(".resolve-btn").addEventListener("click", async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Resolving…";
          try {
            await apiPost(`/api/admin/concerns/${c.id}/resolve`, {}, "admin", { noQueue: true });
            load();
          } catch (err) {
            e.target.disabled = false;
            e.target.textContent = "Mark resolved";
          }
        });
      }
      listEl.appendChild(item);
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.status;
      load();
    });
  });

  load();
  return { reload: load };
}
