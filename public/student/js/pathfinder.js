const svgNS = "http://www.w3.org/2000/svg";

function buildLayout(subjects) {
  const colKeys = [];
  subjects.forEach((s) => {
    const key = `${s.year_level}-${s.sem}`;
    if (!colKeys.includes(key)) colKeys.push(key);
  });
  const colGroups = {};
  subjects.forEach((s) => {
    const key = `${s.year_level}-${s.sem}`;
    if (!colGroups[key]) colGroups[key] = [];
    colGroups[key].push(s.id);
  });
  const colW = 900 / Math.max(colKeys.length, 1);
  const pos = {};
  colKeys.forEach((key, ci) => {
    const ids = colGroups[key];
    const x = colW * ci + colW / 2;
    ids.forEach((id, ri) => {
      const rowH = 420 / Math.max(ids.length, 1);
      const y = 60 + rowH * ri + rowH / 2;
      pos[id] = { x, y };
    });
  });
  return { colKeys, pos, colW };
}

export function renderConstellation(svg, subjects, prereqMap, onToggle) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const byId = {};
  subjects.forEach((s) => (byId[s.id] = s));
  const { colKeys, pos, colW } = buildLayout(subjects);

  colKeys.forEach((key, ci) => {
    const parts = key.split("-");
    const x = colW * ci + colW / 2;
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", x);
    t.setAttribute("y", 30);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "col-label");
    t.textContent = `Y${parts[0]} · S${parts[1]}`;
    svg.appendChild(t);
  });

  subjects.forEach((s) => {
    (prereqMap[s.id] || []).forEach((prereqId) => {
      const a = pos[prereqId], b = pos[s.id];
      if (!a || !b) return;
      const path = document.createElementNS(svgNS, "path");
      const mx = (a.x + b.x) / 2;
      path.setAttribute("d", `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`);
      const prereqSubj = byId[prereqId];
      const active = prereqSubj && prereqSubj.status === "completed" && (s.status === "completed" || s.status === "eligible");
      path.setAttribute("class", "edge-path" + (active ? " edge-active" : ""));
      svg.appendChild(path);
    });
  });

  subjects.forEach((s) => {
    const p = pos[s.id];
    if (!p) return;
    const g = document.createElementNS(svgNS, "g");
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", p.x);
    c.setAttribute("cy", p.y);
    c.setAttribute("r", s.status === "completed" ? 9 : 7.5);
    c.setAttribute("class", "node-circle" + (s.status === "eligible" ? " node-pulse" : ""));
    if (s.status === "completed") {
      c.setAttribute("fill", "var(--accent)");
      c.setAttribute("stroke", "var(--accent)");
    } else if (s.status === "failed") {
      c.setAttribute("fill", "var(--danger)");
      c.setAttribute("stroke", "var(--danger)");
    } else if (s.status === "eligible") {
      c.setAttribute("fill", "var(--bg)");
      c.setAttribute("stroke", "var(--accent)");
      c.setAttribute("stroke-width", "2");
    } else {
      c.setAttribute("fill", "var(--node-locked-fill)");
      c.setAttribute("stroke", "var(--node-locked)");
    }
    c.addEventListener("click", () => onToggle(s.id));
    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${s.code} — ${s.name}`;
    c.appendChild(title);
    g.appendChild(c);

    const lbl = document.createElementNS(svgNS, "text");
    lbl.setAttribute("x", p.x);
    lbl.setAttribute("y", p.y + 18);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("class", "node-label");
    lbl.textContent = s.code;
    g.appendChild(lbl);

    svg.appendChild(g);
  });
}

export function renderSubjectGrid(container, subjects, onToggle) {
  container.innerHTML = "";
  subjects.forEach((s) => {
    const card = document.createElement("div");
    card.className = "subject-card" + (s.status === "completed" ? " is-completed" : s.status === "failed" ? " is-failed" : "");
    card.innerHTML = `
      <div class="code mono">${s.code} · Y${s.year_level}S${s.sem} · ${s.units} units</div>
      <div class="name">${s.name}</div>
      <div class="meta"><span class="pill pill-${s.status}">${s.status}</span></div>
    `;
    card.addEventListener("click", () => onToggle(s.id));
    container.appendChild(card);
  });
}
