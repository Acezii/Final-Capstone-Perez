// Builds public/ into dist/ for GitHub Pages.
// Pages serves a project site from /<repo>/, so root-absolute paths ("/shared/...") are
// prefixed with BASE_PATH, and the frontend is pointed at the Supabase Edge Function via API_BASE_URL.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const SRC = "public";
const OUT = "dist";
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const API = (process.env.API_BASE_URL || "").replace(/\/+$/, "");

if (!API) {
  console.error("API_BASE_URL is not set. Set it to your Supabase functions URL, e.g. https://<project-ref>.supabase.co/functions/v1");
  process.exit(1);
}

const TEXT = new Set([".html", ".js", ".json", ".css"]);

function rewrite(source) {
  return source
    // Direct fetches that bypass shared/js/api.js still need to reach the API.
    .replace(/fetch\((["'`])\/api\//g, "fetch((window.PATHFINDER_API_BASE || " + JSON.stringify(API) + ") + $1/api/")
    // Prefix site paths, leaving API paths (joined to API_BASE at runtime) alone.
    .replace(/(["'`(])\/(?!\/|api\/)([A-Za-z][^"'`)\s]*)?(?=["'`)])/g, (_, open, rest = "") => `${open}${BASE}/${rest}`);
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") await walk(path);
    } else if (TEXT.has(extname(entry.name))) {
      await writeFile(path, rewrite(await readFile(path, "utf8")));
    }
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });
await walk(OUT);
await writeFile(join(OUT, "shared/js/config.js"), `window.PATHFINDER_API_BASE = ${JSON.stringify(API)};\n`);
await writeFile(join(OUT, ".nojekyll"), "");
await cp(join(OUT, "index.html"), join(OUT, "404.html"));
console.log(`Built ${OUT}/ with base "${BASE || "/"}" and API ${API}`);
