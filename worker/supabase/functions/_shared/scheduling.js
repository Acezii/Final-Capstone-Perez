export function kahnOrder(subjects, prereqMap) {
  const indeg = {};
  const dependents = {};
  subjects.forEach((s) => {
    indeg[s.id] = (prereqMap[s.id] || []).length;
    dependents[s.id] = [];
  });
  subjects.forEach((s) => {
    (prereqMap[s.id] || []).forEach((p) => {
      if (!dependents[p]) dependents[p] = [];
      dependents[p].push(s.id);
    });
  });
  const byId = {};
  subjects.forEach((s) => (byId[s.id] = s));
  let queue = subjects.filter((s) => indeg[s.id] === 0).map((s) => s.id);
  const order = [];
  const indegCopy = { ...indeg };
  while (queue.length) {
    queue.sort((a, b) => {
      const sa = byId[a], sb = byId[b];
      if (sa.year_level !== sb.year_level) return sa.year_level - sb.year_level;
      return sa.sem - sb.sem;
    });
    const cur = queue.shift();
    order.push(cur);
    (dependents[cur] || []).forEach((d) => {
      indegCopy[d] -= 1;
      if (indegCopy[d] === 0) queue.push(d);
    });
  }
  return order;
}

function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// NSTP meets on Sundays only; every other subject is held Monday to Saturday.
function isNstp(subjectId) {
  return /^NST/i.test(subjectId);
}

function allowedOnDay(subjectId, day) {
  return isNstp(subjectId) ? day === "Sun" : day !== "Sun";
}

function overlaps(a, b) {
  return a.section.day === b.section.day && toMinutes(a.section.start_time) < toMinutes(b.section.end_time) && toMinutes(b.section.start_time) < toMinutes(a.section.end_time);
}

// Lower is better: penalises uneven class counts per day, then uneven minutes per day.
function loadScore(picks) {
  const count = {};
  const minutes = {};
  picks.forEach((p) => {
    const d = p.section.day;
    count[d] = (count[d] || 0) + 1;
    minutes[d] = (minutes[d] || 0) + toMinutes(p.section.end_time) - toMinutes(p.section.start_time);
  });
  const sumSq = (o) => Object.values(o).reduce((a, v) => a + v * v, 0);
  return sumSq(count) * 10000 + sumSq(minutes);
}

export function greedySchedule(subjectIds, sectionsBySubject) {
  const options = {};
  subjectIds.forEach((id) => {
    options[id] = (sectionsBySubject[id] || [])
      .filter((sec) => allowedOnDay(id, sec.day))
      .map((sec) => ({ subjectId: id, section: sec }));
  });

  // Fewest options first, so tightly constrained subjects get placed before flexible ones.
  const order = [...subjectIds].sort((a, b) => options[a].length - options[b].length);

  let best = { picks: [], skipped: subjectIds.length + 1, score: Infinity };
  let budget = 20000;

  function search(i, picks, skipped) {
    if (budget-- <= 0 || skipped > best.skipped) return;
    if (i === order.length) {
      const score = loadScore(picks);
      if (skipped < best.skipped || score < best.score) best = { picks: [...picks], skipped, score };
      return;
    }
    const id = order[i];
    const fits = options[id].filter((p) => !picks.some((q) => overlaps(p, q)));
    fits.forEach((p) => {
      picks.push(p);
      search(i + 1, picks, skipped);
      picks.pop();
    });
    search(i + 1, picks, skipped + 1);
  }
  search(0, [], 0);

  const accepted = best.picks;
  const placed = new Set(accepted.map((p) => p.subjectId));
  const unresolved = subjectIds.filter((id) => !placed.has(id));
  return { accepted, unresolved };
}

export function eligibleSubjects(subjects, prereqMap, completedIds) {
  const completed = new Set(completedIds);
  return subjects.filter((s) => {
    if (completed.has(s.id)) return false;
    const reqs = prereqMap[s.id] || [];
    return reqs.every((r) => completed.has(r));
  });
}

function blockedByFailed(subjectId, prereqMap, statusById, visited = new Set()) {
  if (visited.has(subjectId)) return false;
  visited.add(subjectId);

  return (prereqMap[subjectId] || []).some((prerequisiteId) => {
    if (statusById.get(prerequisiteId) === "failed") return true;
    return blockedByFailed(prerequisiteId, prereqMap, statusById, visited);
  });
}

function hasFuturePrerequisite(subjectId, subjects, prereqMap, termIndex) {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const subject = byId.get(subjectId);
  if (!subject) return false;

  const subjectTermIndex = termIndex.get(`${subject.year_level}-${subject.sem}`);
  if (subjectTermIndex == null) return false;

  return (prereqMap[subjectId] || []).some((prerequisiteId) => {
    const prereq = byId.get(prerequisiteId);
    if (!prereq) return false;
    const prereqTermIndex = termIndex.get(`${prereq.year_level}-${prereq.sem}`);
    return prereqTermIndex != null && prereqTermIndex > subjectTermIndex;
  });
}

function termBuilderContext(subjects, prereqMap, records) {
  const statusById = new Map(records.map((record) => [record.subject_id, record.status]));
  const completed = new Set(
    records.filter((record) => record.status === "completed").map((record) => record.subject_id)
  );
  const terms = [...new Set(subjects.map((subject) => `${subject.year_level}-${subject.sem}`))]
    .sort((a, b) => {
      const [ay, as] = a.split("-").map(Number);
      const [by, bs] = b.split("-").map(Number);
      return ay - by || as - bs;
    });
  const termIndex = new Map(terms.map((term, index) => [term, index]));
    const recordedTermIndexes = subjects
      .filter((subject) => statusById.has(subject.id))
      .map((subject) => termIndex.get(`${subject.year_level}-${subject.sem}`))
      .filter((index) => index != null);
    const latestRecordedIndex = recordedTermIndexes.length ? Math.max(...recordedTermIndexes) : -1;
    const targetIndex = latestRecordedIndex + 1;
  return { statusById, completed, terms, termIndex, targetIndex };
}

export function termBuilderTargetTerm(subjects, prereqMap, records) {
  const { terms, targetIndex } = termBuilderContext(subjects, prereqMap, records);
  return terms[targetIndex] || null;
}

export function termBuilderEligibleSubjects(subjects, prereqMap, records) {
  const { statusById, completed, terms, termIndex, targetIndex } = termBuilderContext(subjects, prereqMap, records);

  const targetSem = Number(String(terms[targetIndex] || "").split("-")[1]);

  return subjects.filter((subject) => {
    if (completed.has(subject.id)) return false;
    if (statusById.get(subject.id) === "failed") {
      // A failed subject can only be retaken in the 1st semester of the next school year.
      if (targetSem !== 1) return false;
      return (prereqMap[subject.id] || []).every((prerequisiteId) => completed.has(prerequisiteId));
    }
    if (blockedByFailed(subject.id, prereqMap, statusById)) return false;
    if (hasFuturePrerequisite(subject.id, subjects, prereqMap, termIndex)) return false;

    const subjectTermIndex = termIndex.get(`${subject.year_level}-${subject.sem}`);
    if (subjectTermIndex !== targetIndex) return false;
    return (prereqMap[subject.id] || []).every((prerequisiteId) => completed.has(prerequisiteId));
  });
}
