// Supabase Edge Function that serves the whole Path-Finder API.
// Requests to https://<project>.supabase.co/functions/v1/api/... reach the shared app as /api/...
import app from "../_shared/app.js";

const env = {
  APP_SECRET: Deno.env.get("APP_SECRET"),
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
};

Deno.serve((request) => app.fetch(request, env));
