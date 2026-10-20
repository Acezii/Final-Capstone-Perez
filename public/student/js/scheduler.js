const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_PX = 56;
const PALETTE = 8;

function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmtTime(t) {
  const min = typeof t === "number" ? t : timeToMin(t);
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
}

function fmtRange(start, end) {
  const e = timeToMin(end);
  return `${fmtTime(start)}–${fmtTime(e)} ${e >= 720 ? "PM" : "AM"}`;
}

function fmtHour(h) {
  return `${((h + 11) % 12) + 1} ${h >= 12 ? "PM" : "AM"}`;
}

export function renderChips(container, eligibleSubjects, selected, unitCap, onToggle) {
  container.innerHTML = "";
  if (eligibleSubjects.length === 0) {
    container.innerHTML = '<span class="chip-empty">No eligible subjects right now — complete more prerequisites first.</span>';
    return;
  }
  const total = eligibleSubjects.filter((s) => selected.has(s.id)).reduce((a, s) => a + s.units, 0);
  eligibleSubjects.forEach((s) => {
    const isSelected = selected.has(s.id);
    const overCap = !isSelected && total + s.units > unitCap;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (isSelected ? " selected" : "") + (overCap ? " over-cap" : "");
    chip.setAttribute("aria-pressed", isSelected);
    chip.title = overCap ? `Adding ${s.code} would exceed your ${unitCap}-unit cap` : isSelected ? "Remove from term" : "Add to term";
    chip.innerHTML = `<span class="chip-mark" aria-hidden="true">${isSelected ? "✓" : "+"}</span><span class="chip-code mono">${s.code}</span><span class="chip-name">${s.name}</span><span class="chip-units mono">${s.units}u</span>`;
    chip.addEventListener("click", () => onToggle(s));
    container.appendChild(chip);
  });
}

export function currentUnits(selected, byId) {
  return Array.from(selected).reduce((a, id) => a + (byId[id] ? byId[id].units : 0), 0);
}

export function renderUnitMeter(fillEl, labelEl, total, cap) {
  const pct = Math.min(100, (total / cap) * 100);
  fillEl.style.width = pct + "%";
  fillEl.classList.toggle("is-full", total >= cap);
  const left = Math.max(0, cap - total);
  labelEl.textContent = `${total} / ${cap} units${total ? ` · ${left} left` : ""}`;
}

export function renderSchedule(gridEl, logEl, result, byId) {
  if (!result) {
    gridEl.innerHTML = '<div class="empty-state">Select subjects above, then run the scheduler to see your weekly grid.</div>';
    logEl.innerHTML = '<h3>Resolution log</h3><div class="log-empty">Nothing scheduled yet.</div>';
    return;
  }

  const accepted = [...result.accepted].sort(
    (a, b) => DAYS.indexOf(a.section.day) - DAYS.indexOf(b.section.day) || timeToMin(a.section.start_time) - timeToMin(b.section.start_time)
  );
  const colorOf = {};
  accepted.forEach((a, i) => (colorOf[a.subjectId] ??= Object.keys(colorOf).length % PALETTE));

  const starts = accepted.map((a) => timeToMin(a.section.start_time));
  const ends = accepted.map((a) => timeToMin(a.section.end_time));
  const firstHour = Math.min(7, ...starts.map((m) => Math.floor(m / 60)));
  const lastHour = Math.max(15, ...ends.map((m) => Math.ceil(m / 60)));
  const hours = [];
  for (let h = firstHour; h < lastHour; h++) hours.push(h);

  const week = document.createElement("div");
  week.className = "week";
  week.style.setProperty("--hours", hours.length);
  week.style.setProperty("--hour-px", `${HOUR_PX}px`);

  const head = document.createElement("div");
  head.className = "week-head";
  head.innerHTML = '<div class="week-corner"></div>' + DAYS.map((d) => {
    const count = accepted.filter((a) => a.section.day === d).length;
    return `<div class="week-day">${d}<span>${count ? `${count} class${count > 1 ? "es" : ""}` : "free"}</span></div>`;
  }).join("");
  week.appendChild(head);

  const body = document.createElement("div");
  body.className = "week-body";
  body.innerHTML = `<div class="week-times">${hours.map((h) => `<div class="week-time">${fmtHour(h)}</div>`).join("")}</div>`;
  DAYS.forEach((day) => {
    const col = document.createElement("div");
    col.className = "week-col";
    accepted.filter((a) => a.section.day === day).forEach((a) => {
      const s = byId[a.subjectId];
      const start = timeToMin(a.section.start_time);
      const end = timeToMin(a.section.end_time);
      const block = document.createElement("div");
      block.className = `block c${colorOf[a.subjectId]}`;
      block.style.top = `${((start - firstHour * 60) / 60) * HOUR_PX}px`;
      block.style.height = `${((end - start) / 60) * HOUR_PX - 3}px`;
      const meta = [a.section.section_code && `Sec ${a.section.section_code}`, a.section.room].filter(Boolean).join(" · ");
      block.title = `${s ? `${s.code} — ${s.name}` : a.subjectId}\n${day} ${fmtRange(a.section.start_time, a.section.end_time)}${meta ? `\n${meta}` : ""}${a.section.instructor ? `\n${a.section.instructor}` : ""}`;
      block.innerHTML = `
        <span class="b-code mono">${s ? s.code : a.subjectId}</span>
        <span class="b-name">${s ? s.name : ""}</span>
        <span class="b-time mono">${fmtRange(a.section.start_time, a.section.end_time)}</span>
        ${meta ? `<span class="b-meta">${meta}</span>` : ""}`;
      col.appendChild(block);
    });
    body.appendChild(col);
  });
  week.appendChild(body);

  gridEl.innerHTML = "";
  gridEl.appendChild(week);

  const placed = accepted.length;
  const missing = result.unresolved.length;
  let items = "";
  result.unresolved.forEach((id) => {
    const s = byId[id];
    items += `<div class="log-item is-conflict"><span class="log-icon" aria-hidden="true">!</span><div><strong>${s ? s.code : id}</strong> couldn't be placed<small>Every section clashes with your other picks. Drop a clashing subject and run again.</small></div></div>`;
  });
  accepted.forEach((a) => {
    const s = byId[a.subjectId];
    items += `<div class="log-item is-ok"><span class="log-swatch c${colorOf[a.subjectId]}" aria-hidden="true"></span><div><strong>${s ? s.code : a.subjectId}</strong><small>${a.section.day} · ${fmtRange(a.section.start_time, a.section.end_time)}</small></div></div>`;
  });
  logEl.innerHTML = `
    <h3>Resolution log</h3>
    <div class="log-summary">
      <div><span class="mono">${placed}</span>placed</div>
      <div class="${missing ? "has-conflict" : ""}"><span class="mono">${missing}</span>unresolved</div>
    </div>
    ${items || '<div class="log-empty">Nothing scheduled yet.</div>'}`;
}
