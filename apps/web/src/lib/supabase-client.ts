import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@caldearte/shared-types";

let client: SupabaseClient<Database> | undefined;

function assertAnonRole(jwt: string): void {
  const payload = jwt.split(".")[1];
  if (!payload) return; // not a JWT-shaped value — let Supabase itself reject it

  let role: unknown;
  try {
    role = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role;
  } catch {
    return; // can't decode — don't block on a parsing edge case, only on a confirmed service_role key
  }

  if (role === "service_role") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY holds a service_role key. This value is bundled into every " +
        "browser response — using the service-role key here would leak it to every visitor. Use the anon key.",
    );
  }
}

// Lazy singleton, same shape as apps/curator/src/lib/supabase-client.ts, but
// inverted: only ever reads the NEXT_PUBLIC_ (browser-exposed) anon key —
// this file must never reference SUPABASE_SERVICE_ROLE_KEY.
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set — the frontend always " +
        "talks to Supabase with the anon key, gated by RLS, never the service role key.",
    );
  }

  assertAnonRole(supabaseAnonKey);

  client = createClient<Database>(supabaseUrl, supabaseAnonKey);
  return client;
}
