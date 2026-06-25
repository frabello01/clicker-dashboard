/**
 * Server-only Supabase client using the service_role key — bypasses RLS.
 *
 * Use this in contexts where no user session exists (cron handlers, server-
 * side webhooks, scheduled tasks). NEVER import from client components.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

let _client: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function adminClient() {
  if (_client) return _client;
  _client = createSupabaseClient<Database>(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return _client;
}
