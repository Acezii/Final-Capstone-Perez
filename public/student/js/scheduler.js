const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function renderChips(container, eligibleSubjects, selected, unitCap, onToggle) {
  container.innerHTML = "";
  if (eligibleSubjects.length === 0) {
    container.innerHTML = '<span class="chip-empty">No eligible subjects right now — complete more prerequisites first.</span>';
    return;
  }
  eligibleSubjects.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selected.has(s.id) ? " selected" : "");
    chip.innerHTML = `<span class="chip-code mono">${s.code}</span><span>${s.name}</span><span class="mono">${s.units}u</span>`;
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
  labelEl.textContent = `${total} / ${cap} units`;
}

export function renderSchedule(gridEl, logEl, result, byId) {
  if (!result) {
    gridEl.innerHTML = '<div class="empty-state">Select subjects above, then run the scheduler to see your weekly grid.</div>';
    logEl.innerHTML = '<h3>Resolution log</h3><div class="log-empty">Nothing scheduled yet.</div>';
    return;
  }
  const hours = [];
  for (let h = 7; h < 15; h++) hours.push(h);

  const table = document.createElement("table");
  table.className = "sched-table";
  const thead = document.createElement("tr");
  thead.innerHTML = "<th>Time</th>" + DAYS.map((d) => `<th>${d}</th>`).join("");
  table.appendChild(thead);

  hours.forEach((h) => {
    const tr = document.createElement("tr");
    const label = (h < 10 ? "0" : "") + h + ":00";
    tr.innerHTML = `<td class="hour-cell">${label}</td>`;
    DAYS.forEach((day) => {
      const td = document.createElement("td");
      const hit = result.accepted.find(
        (a) => a.section.day === day && timeToMin(a.section.start_time) <= h * 60 && h * 60 < timeToMin(a.section.end_time)
      );
      const starting = result.accepted.find(
        (a) => a.section.day === day && Math.floor(timeToMin(a.section.start_time) / 60) === h
      );
      if (starting) {
        const span = Math.max(1, Math.round((timeToMin(starting.section.end_time) - timeToMin(starting.section.start_time)) / 60));
        td.rowSpan = span;
        const s = byId[starting.subjectId];
        td.innerHTML = `<div class="block"><span class="b-name">${s ? s.code : starting.subjectId}</span>${starting.section.start_time}&ndash;${starting.section.end_time}</div>`;
      } else if (hit) {
        return;
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  gridEl.innerHTML = "";
  gridEl.appendChild(table);

  let items = "";
  result.accepted.forEach((a) => {
    const s = byId[a.subjectId];
    items += `<div class="log-item is-ok">${s ? s.code : a.subjectId} placed ${a.section.day} ${a.section.start_time}&ndash;${a.section.end_time}</div>`;
  });
  result.unresolved.forEach((id) => {
    const s = byId[id];
    items += `<div class="log-item is-conflict">${s ? s.code : id} could not be placed — every candidate section clashes with your other picks.</div>`;
  });
  logEl.innerHTML = "<h3>Resolution log</h3>" + (items || '<div class="log-empty">Nothing scheduled yet.</div>');
}
