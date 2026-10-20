const svgNS = "http://www.w3.org/2000/svg";

const COL_W = 150;
const NODE_W = 104;
const NODE_H = 30;
const ROW_H = 46;
const HEAD_H = 74;
const PAD_B = 18;

function el(name, attrs = {}, text) {
  const node = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function mean(values, fallback) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
}

// Columns are curriculum terms; within a column, subjects are ordered by the
// average row of their prerequisites (and then dependents) to cut down on edge crossings.
function buildLayout(subjects, prereqMap) {
  const columns = [];
  sortByTerm(subjects).forEach((s) => {
    const key = `${s.year_level}-${s.sem}`;
    let col = columns[columns.length - 1];
    if (!col || col.key !== key) columns.push((col = { key, year: Number(s.year_level), sem: Number(s.sem), ids: [] }));
    col.ids.push(s.id);
  });

  const dependents = {};
  Object.entries(prereqMap).forEach(([id, prereqs]) =>
    prereqs.forEach((p) => (dependents[p] ||= []).push(id))
  );

  const row = {};
  const colOf = {};
  const index = () => columns.forEach((c, ci) => c.ids.forEach((id, ri) => ((row[id] = ri), (colOf[id] = ci))));
  const reorder = (c, neighbours) => {
    const score = {};
    c.ids.forEach((id, ri) => {
      const linked = (neighbours[id] || []).filter((n) => n in row && colOf[n] !== colOf[id]).map((n) => row[n]);
      score[id] = mean(linked, ri);
    });
    c.ids.sort((a, b) => score[a] - score[b]);
    c.ids.forEach((id, ri) => (row[id] = ri));
  };
  index();
  for (let pass = 0; pass < 2; pass++) {
    columns.slice(1).forEach((c) => reorder(c, prereqMap));
    columns.slice(0, -1).reverse().forEach((c) => reorder(c, dependents));
  }
  columns.slice(1).forEach((c) => reorder(c, prereqMap));

  const maxRows = Math.max(1, ...columns.map((c) => c.ids.length));
  const width = Math.max(columns.length, 1) * COL_W;
  const height = HEAD_H + maxRows * ROW_H + PAD_B;
  const pos = {};
  columns.forEach((c, ci) => {
    const x = COL_W * ci + COL_W / 2;
    c.ids.forEach((id, ri) => (pos[id] = { x, y: HEAD_H + ROW_H * ri + ROW_H / 2 }));
  });
  return { columns, pos, width, height, dependents };
}

function collect(start, graph) {
  const seen = new Set();
  const stack = [...(graph[start] || [])];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(graph[id] || []));
  }
  return seen;
}

export function renderConstellation(svg, subjects, prereqMap, onToggle) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const byId = {};
  subjects.forEach((s) => (byId[s.id] = s));
  const { columns, pos, width, height, dependents } = buildLayout(subjects, prereqMap);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.minWidth = `${Math.round(width * 0.62)}px`;

  // Year bands and term headers
  const bands = el("g", { class: "cg-bands" });
  let start = 0;
  columns.forEach((c, ci) => {
    const last = ci === columns.length - 1 || columns[ci + 1].year !== c.year;
    if (!last) return;
    const x = start * COL_W;
    const w = (ci - start + 1) * COL_W;
    bands.appendChild(el("rect", { x: x + 4, y: 4, width: w - 8, height: height - 8, rx: 12, class: `cg-band${c.year % 2 ? "" : " cg-band-alt"}` }));
    bands.appendChild(el("text", { x: x + w / 2, y: 28, "text-anchor": "middle", class: "cg-year" }, `Year ${c.year}`));
    start = ci + 1;
  });
  columns.forEach((c, ci) => {
    const x = COL_W * ci + COL_W / 2;
    const done = c.ids.filter((id) => byId[id].status === "completed").length;
    bands.appendChild(el("text", { x, y: 48, "text-anchor": "middle", class: "cg-term" }, semesterLabel(c.sem).replace("Semester", "Sem")));
    bands.appendChild(el("text", { x, y: 62, "text-anchor": "middle", class: "cg-term-count" }, `${done}/${c.ids.length}`));
  });
  svg.appendChild(bands);

  // Prerequisite edges: from the right side of the prerequisite chip to the left side of the subject chip
  const edges = el("g", { class: "cg-edges" });
  const edgeEls = [];
  subjects.forEach((s) => {
    (prereqMap[s.id] || []).forEach((prereqId) => {
      const a = pos[prereqId], b = pos[s.id];
      if (!a || !b) return;
      const prereq = byId[prereqId];
      let d;
      if (a.x < b.x) {
        const x1 = a.x + NODE_W / 2, x2 = b.x - NODE_W / 2 - 3;
        const mx = (x1 + x2) / 2;
        d = `M ${x1} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${x2} ${b.y}`;
      } else {
        const x = a.x + NODE_W / 2;
        d = `M ${x} ${a.y} C ${x + 26} ${a.y}, ${x + 26} ${b.y}, ${x + 3} ${b.y}`;
      }
      const state = prereq?.status === "completed"
        ? (s.status === "completed" ? "edge-done" : "edge-ready")
        : "edge-locked";
      const path = el("path", { d, class: `edge-path ${state}`, "marker-end": `url(#cg-arrow-${state})` });
      path.dataset.from = prereqId;
      path.dataset.to = s.id;
      edges.appendChild(path);
      edgeEls.push(path);
    });
  });
  const defs = el("defs");
  ["edge-done", "edge-ready", "edge-locked"].forEach((state) => {
    const marker = el("marker", { id: `cg-arrow-${state}`, viewBox: "0 0 6 6", refX: 5, refY: 3, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.appendChild(el("path", { d: "M0,0 L6,3 L0,6 z", class: `cg-arrow ${state}` }));
    defs.appendChild(marker);
  });
  svg.appendChild(defs);
  svg.appendChild(edges);

  // Subject chips
  const nodes = el("g", { class: "cg-nodes" });
  const nodeEls = {};
  subjects.forEach((s) => {
    const p = pos[s.id];
    if (!p) return;
    const g = el("g", {
      class: `cg-node node-${s.status}`,
      transform: `translate(${p.x - NODE_W / 2} ${p.y - NODE_H / 2})`,
      tabindex: 0,
      role: "button",
      "aria-label": `${s.code} ${s.name}, ${s.status}`,
    });
    if (s.status === "eligible") g.appendChild(el("rect", { class: "cg-halo", x: -3, y: -3, width: NODE_W + 6, height: NODE_H + 6, rx: 10 }));
    g.appendChild(el("rect", { class: "cg-chip", width: NODE_W, height: NODE_H, rx: 8 }));
    g.appendChild(el("text", { class: "cg-code", x: NODE_W / 2, y: NODE_H / 2 + 0.5, "text-anchor": "middle", "dominant-baseline": "middle" }, s.code));
    g.appendChild(el("title", {}, `${s.code} — ${s.name}\n${s.units} units · ${s.status}`));

    const ancestors = collect(s.id, prereqMap);
    const descendants = collect(s.id, dependents);
    const focus = () => {
      svg.classList.add("is-tracing");
      const chain = new Set([s.id, ...ancestors, ...descendants]);
      Object.entries(nodeEls).forEach(([id, n]) => n.classList.toggle("is-lit", chain.has(id)));
      edgeEls.forEach((e) => e.classList.toggle("is-lit", chain.has(e.dataset.from) && chain.has(e.dataset.to)));
    };
    const blur = () => {
      svg.classList.remove("is-tracing");
      Object.values(nodeEls).forEach((n) => n.classList.remove("is-lit"));
      edgeEls.forEach((e) => e.classList.remove("is-lit"));
    };
    g.addEventListener("mouseenter", focus);
    g.addEventListener("mouseleave", blur);
    g.addEventListener("focus", focus);
    g.addEventListener("blur", blur);
    g.addEventListener("click", () => onToggle(s.id));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle(s.id);
      }
    });
    nodeEls[s.id] = g;
    nodes.appendChild(g);
  });
  svg.appendChild(nodes);
}

const YEAR_NAMES = ["", "First", "Second", "Third", "Fourth", "Fifth"];

export function semesterLabel(sem) {
  return { 1: "1st Semester", 2: "2nd Semester", 3: "Summer" }[sem] || `Semester ${sem}`;
}

export function yearLabel(year) {
  return YEAR_NAMES[year] ? `${YEAR_NAMES[year]} Year` : `Year ${year}`;
}

export function sortByTerm(subjects) {
  return [...subjects].sort(
    (a, b) =>
      Number(a.year_level) - Number(b.year_level) ||
      Number(a.sem) - Number(b.sem) ||
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
  );
}

// Returns [{ year, terms: [{ sem, subjects }] }] in curriculum order.
export function groupByTerm(subjects) {
  const years = [];
  sortByTerm(subjects).forEach((s) => {
    const year = Number(s.year_level);
    const sem = Number(s.sem);
    let y = years[years.length - 1];
    if (!y || y.year !== year) years.push((y = { year, terms: [] }));
    let t = y.terms[y.terms.length - 1];
    if (!t || t.sem !== sem) y.terms.push((t = { sem, subjects: [] }));
    t.subjects.push(s);
  });
  return years;
}

export function renderSubjectGrid(container, subjects, onToggle) {
  container.innerHTML = "";
  groupByTerm(subjects).forEach(({ year, terms }) => {
    const section = document.createElement("section");
    section.className = "year-block";
    section.innerHTML = `<h3 class="year-title">${yearLabel(year)}</h3>`;

    terms.forEach(({ sem, subjects: termSubjects }) => {
      const totalUnits = termSubjects.reduce((sum, s) => sum + Number(s.units || 0), 0);
      const done = termSubjects.filter((s) => s.status === "completed").length;
      const table = document.createElement("table");
      table.className = "term-table";
      table.innerHTML = `
        <caption>
          <span>Y${year}S${sem} · ${semesterLabel(sem)}</span>
          <span class="term-meta mono">${done}/${termSubjects.length} done · ${totalUnits} units</span>
        </caption>
        <thead><tr><th class="col-code">Code</th><th>Subject</th><th class="col-units">Units</th><th class="col-status">Status</th></tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      termSubjects.forEach((s) => {
        const row = document.createElement("tr");
        row.className = s.status === "completed" ? "is-completed" : s.status === "failed" ? "is-failed" : "";
        row.tabIndex = 0;
        row.title = "Click to toggle completed";
        row.innerHTML = `
          <td class="col-code mono">${s.code}</td>
          <td>${s.name}</td>
          <td class="col-units mono">${s.units}</td>
          <td class="col-status"><span class="pill pill-${s.status}">${s.status}</span></td>
        `;
        row.addEventListener("click", () => onToggle(s.id));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(s.id);
          }
        });
        tbody.appendChild(row);
      });
      section.appendChild(table);
    });
    container.appendChild(section);
  });
}
