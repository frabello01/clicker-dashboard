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
    return optional("SUPABASE_SERVICE_ROLE_KEY");
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
};

/**
 * Public env — usable from client components. Server-only secrets are excluded.
 */
export const publicEnv = {
  get supabaseUrl() {
    return env.supabaseUrl;
  },
  get supabaseAnonKey() {
    return env.supabaseAnonKey;
  },
};
