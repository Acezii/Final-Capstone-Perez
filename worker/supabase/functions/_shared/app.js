import { hashPassword, verifyPassword, signToken, requireAuth, generateQrToken } from "./auth.js";
import { kahnOrder, greedySchedule, eligibleSubjects, termBuilderEligibleSubjects } from "./scheduling.js";
import { askAssistant } from "./ai.js";
import { SupabaseDb } from "./supabase-db.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function getDb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return new SupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

async function loadCurriculum(db) {
  const subjects = (await db.prepare("SELECT * FROM subjects ORDER BY year_level, sem, code").all()).results;
  const prereqRows = (await db.prepare("SELECT * FROM prerequisites").all()).results;
  const prereqMap = {};
  prereqRows.forEach((r) => {
    if (!prereqMap[r.subject_id]) prereqMap[r.subject_id] = [];
    prereqMap[r.subject_id].push(r.prerequisite_id);
  });
  return { subjects, prereqMap };
}

async function studentProgress(db, studentId) {
  const { subjects, prereqMap } = await loadCurriculum(db);
  const subjectRecords = (
    await db.prepare("SELECT subject_id, status FROM student_subjects WHERE student_id = ?").bind(studentId).all()
  ).results;
  const completedRows = subjectRecords.filter((record) => record.status === "completed");
  const completedIds = completedRows.map((r) => r.subject_id);
  const completedSet = new Set(completedIds);
  const statusById = new Map(subjectRecords.map((record) => [record.subject_id, record.status]));
  const termBuilderEligible = new Set(
    termBuilderEligibleSubjects(subjects, prereqMap, subjectRecords).map((subject) => subject.id)
  );
  const totalUnits = subjects.reduce((a, s) => a + s.units, 0);
  const completedUnits = subjects.filter((s) => completedSet.has(s.id)).reduce((a, s) => a + s.units, 0);
  const remainingUnits = totalUnits - completedUnits;
  const order = kahnOrder(subjects, prereqMap);
  const withStatus = order.map((id) => {
    const s = subjects.find((x) => x.id === id);
    let status = "locked";
    if (completedSet.has(id)) status = "completed";
    else if (statusById.get(id) === "failed") status = "failed";
    else if (termBuilderEligible.has(id)) status = "eligible";
    return { ...s, status };
  });
  const estSemesters = Math.max(0, Math.ceil(remainingUnits / 18));
  return {
    subjects: withStatus,
    termBuilderSubjectIds: [...termBuilderEligible],
    prereqMap,
    completedIds,
    totalUnits,
    completedUnits,
    remainingUnits,
    percentComplete: totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0,
    estSemesters,
  };
}

async function buildEvaluationSnapshot(db, student) {
  const progress = await studentProgress(db, student.id);
  return {
    student: {
      studentNumber: student.student_number,
      name: `${student.last_name}, ${student.first_name}`,
      program: student.program,
      yearLevel: student.year_level,
      isIrregular: !!student.is_irregular,
      isShifter: !!student.is_shifter,
    },
    generatedAt: new Date().toISOString(),
    totalUnits: progress.totalUnits,
    completedUnits: progress.completedUnits,
    remainingUnits: progress.remainingUnits,
    percentComplete: progress.percentComplete,
    estSemesters: progress.estSemesters,
    subjects: progress.subjects,
  };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] !== undefined ? cells[i] : ""));
    return row;
  });
  return { headers, rows };
}

async function handleImportStudents(db, text, adminId) {
  const { rows } = parseCsv(text);
  let ok = 0, failed = 0;
  for (const row of rows) {
    try {
      const studentNumber = row.student_number || row.studentNumber;
      const firstName = row.first_name || row.firstName;
      const lastName = row.last_name || row.lastName;
      if (!studentNumber || !firstName || !lastName) throw new Error("missing required field");
      const defaultPassword = row.password || studentNumber;
      const { hash, salt } = await hashPassword(defaultPassword);
      const qrToken = generateQrToken();
      await db
        .prepare(
          `INSERT INTO students (student_number, first_name, last_name, email, program, year_level, is_irregular, is_shifter, password_hash, password_salt, qr_token)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(student_number) DO UPDATE SET first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, program=excluded.program, year_level=excluded.year_level, is_irregular=excluded.is_irregular, is_shifter=excluded.is_shifter, updated_at=datetime('now')`
        )
        .bind(
          studentNumber,
          firstName,
          lastName,
          row.email || null,
          row.program || "BSIT",
          Number(row.year_level || row.yearLevel || 1),
          row.is_irregular === "1" || row.is_irregular === "true" ? 1 : 0,
          row.is_shifter === "1" || row.is_shifter === "true" ? 1 : 0,
          hash,
          salt,
          qrToken
        )
        .run();
      ok++;
    } catch (e) {
      failed++;
    }
  }
  await db.prepare("INSERT INTO import_logs (kind, rows_ok, rows_failed, admin_id) VALUES ('students', ?, ?, ?)").bind(ok, failed, adminId).run();
  return { ok, failed };
}

async function handleImportSubjects(db, text, adminId) {
  const { rows } = parseCsv(text);
  let ok = 0, failed = 0;
  for (const row of rows) {
    try {
      const code = row.code;
      if (!code) throw new Error("missing code");
      await db
        .prepare(
          `INSERT INTO subjects (id, code, name, units, year_level, sem) VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, units=excluded.units, year_level=excluded.year_level, sem=excluded.sem`
        )
        .bind(code, code, row.name, Number(row.units || 3), Number(row.year_level || row.yearLevel || 1), Number(row.sem || 1))
        .run();
      if (row.prerequisites) {
        const prereqs = row.prerequisites.split(";").map((p) => p.trim()).filter(Boolean);
        await db.prepare("DELETE FROM prerequisites WHERE subject_id = ?").bind(code).run();
        for (const p of prereqs) {
          await db.prepare("INSERT OR IGNORE INTO prerequisites (subject_id, prerequisite_id) VALUES (?,?)").bind(code, p).run();
        }
      }
      ok++;
    } catch (e) {
      failed++;
    }
  }
  await db.prepare("INSERT INTO import_logs (kind, rows_ok, rows_failed, admin_id) VALUES ('subjects', ?, ?, ?)").bind(ok, failed, adminId).run();
  return { ok, failed };
}

async function handleImportGrades(db, text, adminId) {
  const { rows } = parseCsv(text);
  let ok = 0, failed = 0;
  for (const row of rows) {
    try {
      const studentNumber = String(row.student_number || row.studentNumber || "").trim();
      const subjectCode = String(row.subject_code || row.subjectCode || row.code || "").trim();
      const grade = String(row.grade || "").trim();
      if (!studentNumber || !subjectCode || !grade) throw new Error("student_number, subject_code, and grade are required");
      const numericGrade = Number(grade);
      if (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > 5) throw new Error("grade must be between 0.00 and 5.00");
      const student = await db.prepare("SELECT id FROM students WHERE student_number = ?").bind(studentNumber).first();
      if (!student) throw new Error("student not found");
      const subject = await db.prepare("SELECT id FROM subjects WHERE code = ?").bind(subjectCode).first();
      if (!subject) throw new Error("subject not found");
      const status = numericGrade === 0 ? "failed" : "completed";
      await db
        .prepare(
          `INSERT INTO student_subjects (student_id, subject_id, status, term, grade) VALUES (?,?,?,?,?)
           ON CONFLICT(student_id, subject_id) DO UPDATE SET status=excluded.status, term=excluded.term, grade=excluded.grade, updated_at=datetime('now')`
        )
        .bind(student.id, subject.id, status, row.term || null, grade)
        .run();
      ok++;
    } catch (e) {
      failed++;
    }
  }
  await db.prepare("INSERT INTO import_logs (kind, rows_ok, rows_failed, admin_id) VALUES ('grades', ?, ?, ?)").bind(ok, failed, adminId).run();
  return { ok, failed };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Edge Functions may see the full /functions/v1 prefix; routes are matched from /api.
    const path = url.pathname.replace(/^\/functions\/v1(?=\/api\/)/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const db = getDb(env);
      if (path === "/api/auth/student/login" && request.method === "POST") {
        const { studentNumber, password } = await request.json();
        const student = await db.prepare("SELECT * FROM students WHERE student_number = ?").bind(studentNumber).first();
        if (!student) return err("Invalid credentials", 401);
        const valid = await verifyPassword(password, student.password_salt, student.password_hash);
        if (!valid) return err("Invalid credentials", 401);
        const token = await signToken({ sub: student.id, role: "student" }, env.APP_SECRET);
        return json({ token, student: { id: student.id, studentNumber: student.student_number, firstName: student.first_name, lastName: student.last_name, yearLevel: student.year_level, isIrregular: !!student.is_irregular, isShifter: !!student.is_shifter } });
      }

      if (path === "/api/auth/admin/login" && request.method === "POST") {
        const { username, password } = await request.json();
        const admin = await db.prepare("SELECT * FROM admins WHERE username = ?").bind(username).first();
        if (!admin) return err("Invalid credentials", 401);
        const valid = await verifyPassword(password, admin.password_salt, admin.password_hash);
        if (!valid) return err("Invalid credentials", 401);
        const token = await signToken({ sub: admin.id, role: "admin" }, env.APP_SECRET);
        return json({ token, admin: { id: admin.id, username: admin.username, fullName: admin.full_name, role: admin.role } });
      }

      if (path === "/api/superadmin/students" && request.method === "POST") {
        if (env.LOCAL_ACCOUNT_CREATOR !== "1") {
          const auth = await requireAuth(request, env, "admin");
          if (!auth) return err("Unauthorized", 401);
        }
        const body = await request.json();
        const studentNumber = String(body.studentNumber || "").trim();
        const firstName = String(body.firstName || "").trim();
        const lastName = String(body.lastName || "").trim();
        const password = String(body.password || "");
        if (!studentNumber || !firstName || !lastName || !password) {
          return err("studentNumber, firstName, lastName, and password are required");
        }
        const existing = await db.prepare("SELECT id FROM students WHERE student_number = ?").bind(studentNumber).first();
        if (existing) return err("A student with that number already exists", 409);
        const { hash, salt } = await hashPassword(password);
        const qrToken = generateQrToken();
        const result = await db
          .prepare(
            `INSERT INTO students (student_number, first_name, last_name, email, program, year_level, is_irregular, is_shifter, password_hash, password_salt, qr_token)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            studentNumber,
            firstName,
            lastName,
            body.email || null,
            body.program || "BSIT",
            Number(body.yearLevel || 1),
            body.isIrregular ? 1 : 0,
            body.isShifter ? 1 : 0,
            hash,
            salt,
            qrToken
          )
          .run();
        return json({ ok: true, studentId: result.meta.last_row_id, studentNumber });
      }

      if (path === "/api/superadmin/admins" && request.method === "POST") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const fullName = String(body.fullName || "").trim();
        const password = String(body.password || "");
        if (!username || !fullName || !password) return err("username, fullName, and password are required");
        const existing = await db.prepare("SELECT id FROM admins WHERE username = ?").bind(username).first();
        if (existing) return err("An admin with that username already exists", 409);
        const { hash, salt } = await hashPassword(password);
        const result = await db
          .prepare("INSERT INTO admins (username, full_name, role, password_hash, password_salt) VALUES (?,?,?,?,?)")
          .bind(username, fullName, "staff", hash, salt)
          .run();
        return json({ ok: true, adminId: result.meta.last_row_id, username });
      }

      if (path.match(/^\/api\/students\/\d+$/) && request.method === "PUT") {
        if (env.LOCAL_ACCOUNT_CREATOR !== "1") {
          const auth = await requireAuth(request, env, "admin");
          if (!auth) return err("Unauthorized", 401);
        }
        const studentId = Number(path.split("/")[3]);
        const body = await request.json().catch(() => ({}));
        const updates = [];
        const bind = [];

        if (Object.prototype.hasOwnProperty.call(body, "firstName")) {
          const firstName = String(body.firstName || "").trim();
          if (!firstName) return err("firstName is required");
          updates.push("first_name = ?");
          bind.push(firstName);
        }
        if (Object.prototype.hasOwnProperty.call(body, "lastName")) {
          const lastName = String(body.lastName || "").trim();
          if (!lastName) return err("lastName is required");
          updates.push("last_name = ?");
          bind.push(lastName);
        }
        if (Object.prototype.hasOwnProperty.call(body, "email")) {
          updates.push("email = ?");
          bind.push(body.email ? String(body.email).trim() : null);
        }
        if (Object.prototype.hasOwnProperty.call(body, "program")) {
          const program = String(body.program || "").trim();
          if (!program) return err("program is required");
          updates.push("program = ?");
          bind.push(program);
        }
        if (Object.prototype.hasOwnProperty.call(body, "yearLevel")) {
          const yearLevel = Number(body.yearLevel);
          if (!Number.isFinite(yearLevel) || yearLevel < 1 || yearLevel > 8) return err("yearLevel must be between 1 and 8");
          updates.push("year_level = ?");
          bind.push(yearLevel);
        }
        if (Object.prototype.hasOwnProperty.call(body, "isIrregular")) {
          updates.push("is_irregular = ?");
          bind.push(body.isIrregular ? 1 : 0);
        }
        if (Object.prototype.hasOwnProperty.call(body, "isShifter")) {
          updates.push("is_shifter = ?");
          bind.push(body.isShifter ? 1 : 0);
        }
        if (Object.prototype.hasOwnProperty.call(body, "status")) {
          const status = String(body.status || "").trim();
          updates.push("status = ?");
          bind.push(status || "active");
        }

        if (updates.length === 0) return err("No student fields to update");
        bind.push(studentId);
        await db.prepare(`UPDATE students SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...bind).run();
        const student = await db.prepare("SELECT * FROM students WHERE id = ?").bind(studentId).first();
        return json({ ok: true, student: { id: student.id, studentNumber: student.student_number, firstName: student.first_name, lastName: student.last_name, yearLevel: student.year_level, program: student.program, email: student.email, status: student.status } });
      }

      if (path === "/api/subjects" && request.method === "GET") {
        const { subjects, prereqMap } = await loadCurriculum(db);
        return json({ subjects, prereqMap });
      }

      if (path.match(/^\/api\/students\/\d+\/progress$/) && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const studentId = Number(path.split("/")[3]);
        if (auth.role === "student" && auth.sub !== studentId) return err("Forbidden", 403);
        const student = await db.prepare("SELECT * FROM students WHERE id = ?").bind(studentId).first();
        if (!student) return err("Student not found", 404);
        const progress = await studentProgress(db, studentId);
        return json({ progress });
      }

      if (path.match(/^\/api\/students\/\d+\/subjects\/[\w-]+$/) && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const parts = path.split("/");
        const studentId = Number(parts[3]);
        const subjectId = parts[5];
        if (auth.role === "student" && auth.sub !== studentId) return err("Forbidden", 403);
        const body = await request.json().catch(() => ({}));
        const status = body.status || "completed";
        if (status === "not_taken") {
          await db.prepare("DELETE FROM student_subjects WHERE student_id = ? AND subject_id = ?").bind(studentId, subjectId).run();
        } else {
          await db
            .prepare(
              `INSERT INTO student_subjects (student_id, subject_id, status, term) VALUES (?,?,?,?)
               ON CONFLICT(student_id, subject_id) DO UPDATE SET status=excluded.status, term=excluded.term, updated_at=datetime('now')`
            )
            .bind(studentId, subjectId, status, body.term || null)
            .run();
        }
        const progress = await studentProgress(db, studentId);
        return json({ progress });
      }

      if (path === "/api/schedule/generate" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const { subjectIds, term } = await request.json();
        if (!Array.isArray(subjectIds) || subjectIds.length === 0) return err("subjectIds required");
        const placeholders = subjectIds.map(() => "?").join(",");
        const sectionRows = (
          await db.prepare(`SELECT * FROM sections WHERE subject_id IN (${placeholders})`).bind(...subjectIds).all()
        ).results;
        const sectionsBySubject = {};
        sectionRows.forEach((sec) => {
          if (!sectionsBySubject[sec.subject_id]) sectionsBySubject[sec.subject_id] = [];
          sectionsBySubject[sec.subject_id].push(sec);
        });
        const result = greedySchedule(subjectIds, sectionsBySubject);
        if (auth.role === "student") {
          const totalUnits = subjectIds.length
            ? (await db.prepare(`SELECT COALESCE(SUM(units),0) as u FROM subjects WHERE id IN (${placeholders})`).bind(...subjectIds).first()).u
            : 0;
          await db
            .prepare("INSERT INTO study_plans (student_id, term, plan_json, total_units, status) VALUES (?,?,?,?,?)")
            .bind(auth.sub, term || "upcoming", JSON.stringify(result), totalUnits, "draft")
            .run();
        }
        return json({ result });
      }

      if (path === "/api/students/me/qr" && request.method === "GET") {
        const auth = await requireAuth(request, env, "student");
        if (!auth) return err("Unauthorized", 401);
        const student = await db.prepare("SELECT qr_token, student_number FROM students WHERE id = ?").bind(auth.sub).first();
        return json({ qrToken: student.qr_token, studentNumber: student.student_number });
      }

      if (path === "/api/admin/scan" && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const { qrToken } = await request.json();
        const student = await db.prepare("SELECT * FROM students WHERE qr_token = ?").bind(qrToken).first();
        if (!student) return err("No student matches this QR code", 404);
        await db.prepare("INSERT INTO qr_scans (student_id, admin_id) VALUES (?,?)").bind(student.id, auth.sub).run();
        const snapshot = await buildEvaluationSnapshot(db, student);
        return json({ student: snapshot });
      }

      if (path.match(/^\/api\/students\/\d+\/evaluation$/) && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const studentId = Number(path.split("/")[3]);
        if (auth.role === "student" && auth.sub !== studentId) return err("Forbidden", 403);
        const student = await db.prepare("SELECT * FROM students WHERE id = ?").bind(studentId).first();
        if (!student) return err("Student not found", 404);
        const snapshot = await buildEvaluationSnapshot(db, student);
        return json({ evaluation: snapshot });
      }

      if (path.match(/^\/api\/students\/\d+\/evaluation\/save$/) && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const studentId = Number(path.split("/")[3]);
        const student = await db.prepare("SELECT * FROM students WHERE id = ?").bind(studentId).first();
        if (!student) return err("Student not found", 404);
        const snapshot = await buildEvaluationSnapshot(db, student);
        await db
          .prepare("INSERT INTO evaluations (student_id, generated_by, snapshot_json, printed_at) VALUES (?,?,?,datetime('now'))")
          .bind(studentId, auth.sub, JSON.stringify(snapshot))
          .run();
        return json({ evaluation: snapshot });
      }

      if (path === "/api/import/students" && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const text = await request.text();
        const result = await handleImportStudents(db, text, auth.sub);
        return json({ result });
      }

      if (path === "/api/import/subjects" && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const text = await request.text();
        const result = await handleImportSubjects(db, text, auth.sub);
        return json({ result });
      }

      if (path === "/api/import/grades" && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const text = await request.text();
        const result = await handleImportGrades(db, text, auth.sub);
        return json({ result });
      }

      if (path === "/api/ai/chat" && request.method === "POST") {
        const auth = await requireAuth(request, env, "student");
        if (!auth) return err("Unauthorized", 401);
        const { conversationId, message } = await request.json();
        if (!message || !message.trim()) return err("message required");

        let convId = conversationId;
        if (!convId) {
          const res = await db.prepare("INSERT INTO ai_conversations (student_id, status) VALUES (?, 'open')").bind(auth.sub).run();
          convId = res.meta.last_row_id;
        } else {
          const conv = await db.prepare("SELECT * FROM ai_conversations WHERE id = ? AND student_id = ?").bind(convId, auth.sub).first();
          if (!conv) return err("Conversation not found", 404);
          if (conv.status === "closed") {
            const res = await db.prepare("INSERT INTO ai_conversations (student_id, status) VALUES (?, 'open')").bind(auth.sub).run();
            convId = res.meta.last_row_id;
          }
        }

        const history = (
          await db.prepare("SELECT sender, content FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC").bind(convId).all()
        ).results;

        await db.prepare("INSERT INTO ai_messages (conversation_id, sender, content) VALUES (?,'student',?)").bind(convId, message).run();

        const student = await db.prepare("SELECT * FROM students WHERE id = ?").bind(auth.sub).first();
        const progress = await studentProgress(db, auth.sub);
        const context = {
          name: `${student.first_name} ${student.last_name}`,
          yearLevel: student.year_level,
          isIrregular: !!student.is_irregular,
          isShifter: !!student.is_shifter,
          completedUnits: progress.completedUnits,
          totalUnits: progress.totalUnits,
          eligibleSubjects: progress.subjects.filter((s) => s.status === "eligible").map((s) => s.code),
        };

        let aiResult;
        try {
          aiResult = await askAssistant(env, context, history, message);
        } catch (e) {
          console.error("AI assistant error:", e.message);
          aiResult = { reply: "I'm having trouble reaching the assistant service right now. Please try again shortly, or your question will be forwarded to CCS staff.", escalate: false, summary: null };
        }

        await db.prepare("INSERT INTO ai_messages (conversation_id, sender, content) VALUES (?,'ai',?)").bind(convId, aiResult.reply).run();

        if (aiResult.escalate) {
          await db.prepare("UPDATE ai_conversations SET escalated = 1 WHERE id = ?").bind(convId).run();
          await db
            .prepare("INSERT INTO concerns (conversation_id, student_id, summary, status) VALUES (?,?,?, 'open')")
            .bind(convId, auth.sub, aiResult.summary || message)
            .run();
        }

        return json({ conversationId: convId, reply: aiResult.reply, escalated: aiResult.escalate });
      }

      if (path === "/api/ai/close" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const { conversationId, reason } = await request.json();
        const conv = await db.prepare("SELECT * FROM ai_conversations WHERE id = ?").bind(conversationId).first();
        if (!conv) return err("Conversation not found", 404);
        if (auth.role === "student" && conv.student_id !== auth.sub) return err("Forbidden", 403);
        await db
          .prepare("UPDATE ai_conversations SET status = 'closed', closed_at = datetime('now'), closed_reason = ? WHERE id = ?")
          .bind(reason || "resolved", conversationId)
          .run();
        return json({ ok: true });
      }

      if (path.match(/^\/api\/ai\/conversations\/\d+$/) && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth) return err("Unauthorized", 401);
        const convId = Number(path.split("/")[4]);
        const conv = await db.prepare("SELECT * FROM ai_conversations WHERE id = ?").bind(convId).first();
        if (!conv) return err("Not found", 404);
        if (auth.role === "student" && conv.student_id !== auth.sub) return err("Forbidden", 403);
        const messages = (await db.prepare("SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC").bind(convId).all()).results;
        return json({ conversation: conv, messages });
      }

      if (path === "/api/admin/concerns" && request.method === "GET") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const status = url.searchParams.get("status") || "open";
        const concerns = (
          await db
            .prepare(
              `SELECT concerns.*, students.student_number, students.first_name, students.last_name
               FROM concerns JOIN students ON students.id = concerns.student_id
               WHERE concerns.status = ? ORDER BY concerns.created_at DESC`
            )
            .bind(status)
            .all()
        ).results;
        return json({ concerns });
      }

      if (path.match(/^\/api\/admin\/concerns\/\d+\/resolve$/) && request.method === "POST") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const concernId = Number(path.split("/")[4]);
        const { notes } = await request.json().catch(() => ({}));
        await db
          .prepare("UPDATE concerns SET status = 'resolved', admin_id = ?, admin_notes = ?, resolved_at = datetime('now') WHERE id = ?")
          .bind(auth.sub, notes || null, concernId)
          .run();
        const concern = await db.prepare("SELECT conversation_id FROM concerns WHERE id = ?").bind(concernId).first();
        if (concern && concern.conversation_id) {
          await db
            .prepare("UPDATE ai_conversations SET status = 'closed', closed_at = datetime('now'), closed_reason = 'resolved_by_staff' WHERE id = ?")
            .bind(concern.conversation_id)
            .run();
          await db
            .prepare("INSERT INTO ai_messages (conversation_id, sender, content) VALUES (?,'ai', 'A CCS staff member has resolved your concern. This conversation is now closed. Feel free to start a new one anytime.')")
            .bind(concern.conversation_id)
            .run();
        }
        return json({ ok: true });
      }

      if (path === "/api/admin/students" && request.method === "GET") {
        const auth = await requireAuth(request, env, "admin");
        if (!auth) return err("Unauthorized", 401);
        const students = (await db.prepare("SELECT id, student_number, first_name, last_name, program, year_level, is_irregular, is_shifter, status FROM students ORDER BY last_name").all()).results;
        return json({ students });
      }

      return err("Not found", 404);
    } catch (e) {
      return err(e.message || "Server error", 500);
    }
  },

};
