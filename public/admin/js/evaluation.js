export function renderEvaluation(container, snapshot) {
  const s = snapshot.student;
  const tags = [];
  if (s.isIrregular) tags.push('<span class="pill pill-eligible">Irregular</span>');
  if (s.isShifter) tags.push('<span class="pill pill-eligible">Shifter</span>');

  const rows = snapshot.subjects
    .map(
      (sub) => `
      <tr>
        <td class="mono">${sub.code}</td>
        <td>${sub.name}</td>
        <td>Y${sub.year_level}S${sub.sem}</td>
        <td>${sub.units}</td>
        <td><span class="pill pill-${sub.status}">${sub.status}</span></td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="eval-id-header">
      <div>
        <h3>${s.name}</h3>
        <div class="sub mono">${s.studentNumber} · ${s.program} · Year ${s.yearLevel}</div>
        <div class="eval-tags">${tags.join("")}</div>
      </div>
      <div class="sub mono" style="text-align:right;">Generated<br>${new Date(snapshot.generatedAt).toLocaleString()}</div>
    </div>
    <div class="eval-stat-row">
      <div class="eval-stat"><div class="n mono">${snapshot.completedUnits}</div><div class="l">Units completed</div></div>
      <div class="eval-stat"><div class="n mono">${snapshot.remainingUnits}</div><div class="l">Units remaining</div></div>
      <div class="eval-stat"><div class="n mono">${snapshot.percentComplete}%</div><div class="l">Complete</div></div>
      <div class="eval-stat"><div class="n mono">${snapshot.estSemesters}</div><div class="l">Est. semesters left</div></div>
    </div>
    <table class="eval-table">
      <thead><tr><th>Code</th><th>Subject</th><th>Term</th><th>Units</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
