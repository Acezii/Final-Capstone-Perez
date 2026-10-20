import { idb } from "./idb.js";

const API_BASE = window.PATHFINDER_API_BASE || "";

function tokenKey(role) {
  return role === "admin" ? "pf_admin_token" : "pf_student_token";
}

export function getToken(role) {
  return localStorage.getItem(tokenKey(role));
}

export function setToken(role, token) {
  localStorage.setItem(tokenKey(role), token);
}

export function clearToken(role) {
  localStorage.removeItem(tokenKey(role));
}

export function isOnline() {
  return navigator.onLine;
}

async function rawRequest(path, options, role) {
  const token = getToken(role);
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function apiGet(path, role) {
  if (!isOnline()) {
    const cached = await idb.cacheGet(path);
    if (cached) return { ...cached, __offline: true };
    throw new Error("You're offline and no cached data is available for this yet.");
  }
  try {
    const data = await rawRequest(path, { method: "GET" }, role);
    await idb.cacheSet(path, data);
    return data;
  } catch (e) {
    const cached = await idb.cacheGet(path);
    if (cached) return { ...cached, __offline: true, __stale: true };
    throw e;
  }
}

export async function apiPost(path, body, role, options = {}) {
  if (!isOnline() && !options.noQueue) {
    await idb.outboxAdd({ path, body, role, method: "POST", createdAt: Date.now() });
    return { __queued: true };
  }
  return rawRequest(path, { method: "POST", body: JSON.stringify(body) }, role);
}

export async function apiPostRaw(path, textBody, role) {
  const token = getToken(role);
  const headers = { "Content-Type": "text/csv" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { method: "POST", headers, body: textBody });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function flushOutbox() {
  if (!isOnline()) return { flushed: 0, failed: 0 };
  const items = await idb.outboxAll();
  let flushed = 0, failed = 0;
  for (const item of items) {
    try {
      await rawRequest(item.path, { method: item.method, body: JSON.stringify(item.body) }, item.role);
      await idb.outboxRemove(item.id);
      flushed++;
    } catch (e) {
      failed++;
    }
  }
  return { flushed, failed };
}

window.addEventListener("online", () => {
  flushOutbox();
});
