import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";

let client: SupabaseClient<Database> | undefined;

// Lazy singleton: throws only when actually used, not at import time, so
// modules that don't need Supabase (e.g. pricing) stay importable without
// env vars set.
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — the curator always talks to Supabase with the service role key, never the anon key.",
    );
  }

  client = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);
  return client;
}
