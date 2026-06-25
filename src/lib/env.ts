/**
 * Runtime environment access. Values are read lazily so `next build` doesn't
 * fail on environments without env vars (e.g. preview builds, type-checking).
 * Errors surface at the first actual use of a missing variable.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Supabase
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Nomix
  get nomixApiUrl() {
    return optional("NOMIX_API_URL", "https://panel.nomixclicker.com/clicker/v1");
  },
  get nomixApiKey() {
    return optional("NOMIX_API_KEY");
  },
  get nomixUseMock() {
    return optional("NOMIX_USE_MOCK", "false") === "true";
  },

  // Cron
  get cronSecret() {
    return required("CRON_SECRET");
  },
};

/**
 * Public env — usable from client components. Server-only secrets are excluded.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the client bundle only when
 * accessed with literal dot notation. Bracket notation (process.env[name]) is
 * not statically analyzable and yields undefined on the client.
 */
export const publicEnv = {
  get supabaseUrl() {
    const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!v) throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_URL");
    return v;
  },
  get supabaseAnonKey() {
    const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!v) throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return v;
  },
};
