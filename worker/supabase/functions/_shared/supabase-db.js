function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeSql(sql, params) {
  let index = 0;
  let normalized = sql
    .replace(/datetime\('now',\s*'-12 hours'\)/gi, "(now() - interval '12 hours')")
    .replace(/datetime\('now'\)/gi, "now()")
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");

  normalized = normalized.replace(/\?/g, () => sqlLiteral(params[index++]));
  if (/^INSERT\s/i.test(normalized) && !/\sRETURNING\s/i.test(normalized)) {
    normalized += " RETURNING *";
  }
  return normalized;
}

export class SupabaseDb {
  constructor(url, serviceRoleKey) {
    this.url = url.replace(/\/+$/, "");
    this.serviceRoleKey = serviceRoleKey;
  }

  prepare(sql) {
    return new SupabaseStatement(this, sql);
  }

  async execute(sql, params) {
    const response = await fetch(`${this.url}/rest/v1/rpc/execute_sql`, {
      method: "POST",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: normalizeSql(sql, params) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.message || body?.hint || `Supabase request failed (${response.status})`);
    }
    return Array.isArray(body) ? body : [];
  }
}

class SupabaseStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    return { results: await this.db.execute(this.sql, this.params) };
  }

  async first() {
    const rows = await this.db.execute(this.sql, this.params);
    return rows[0] || null;
  }

  async run() {
    const rows = await this.db.execute(this.sql, this.params);
    return { meta: { last_row_id: rows[0]?.id || null } };
  }
}
