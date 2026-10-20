import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index.js";
import { SupabaseDb } from "./supabase-db.js";

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