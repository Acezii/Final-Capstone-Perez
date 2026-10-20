import { webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index.js";
import { SupabaseDb } from "./supabase-db.js";

// Node 18 does not expose Web Crypto as a global; Workers (and Node 19+) do.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const root = join(fileURLToPath(new URL("../..", import.meta.url)), "public");
const port = Number(process.env.PORT || 3000);

try {
  const varsPath = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  const vars = await readFile(varsPath, "utf8");
  for (const line of vars.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // Environment variables may be supplied by the shell instead.
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
  }[extname(path).toLowerCase()] || "application/octet-stream";
}

async function serveStatic(request, response) {
  const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = requested === "/"
    ? "/index.html"
    : requested.endsWith("/")
      ? `${requested}index.html`
      : requested;
  let filePath = normalize(join(root, relative));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    let body;
    try {
      body = await readFile(filePath);
    } catch (error) {
      if (extname(filePath)) throw error;
      filePath += ".html";
      body = await readFile(filePath);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

// Workers AI only exists inside Cloudflare, so locally we call the same models over its REST API.
const localAi = process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
  ? {
      async run(model, input) {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }
        );
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          throw new Error(body?.errors?.[0]?.message || `Workers AI request failed (${res.status})`);
        }
        return body.result;
      },
    }
  : undefined;

if (!localAi) {
  console.warn("Finder AI is disabled locally: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in worker/.dev.vars");
}

async function handleApi(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else if (value) headers.set(name, value);
  }
  const webRequest = new Request(`http://${request.headers.host || `localhost:${port}`}${request.url}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : body,
  });
  const env = {
    APP_SECRET: process.env.APP_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LOCAL_ACCOUNT_CREATOR: "1",
    DB: new SupabaseDb(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
    AI: localAi,
  };
  const result = await app.fetch(webRequest, env);
  const output = Buffer.from(await result.arrayBuffer());
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(output);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.APP_SECRET) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and APP_SECRET are required");
}

createServer((request, response) => {
  const work = request.url?.startsWith("/api/")
    ? handleApi(request, response)
    : serveStatic(request, response);
  work.catch((error) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Server error" }));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Pathfinder local server running at http://localhost:${port}`);
});