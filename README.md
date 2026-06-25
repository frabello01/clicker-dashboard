# Clicker Dashboard

Control panel for the NomixClicker phone fleet. Built on Next.js 15 +
Supabase + TypeScript + Tailwind, deployed on Vercel.

## What's in here (phase 0 — foundation)

- **Typed Nomix REST client** (`src/lib/nomix/`) — wraps every endpoint
  from `https://panel.nomixclicker.com/clicker/v1`. Mirrors the official
  Python `Clicker`/`Screen`/`Agent` classes.
- **Mock client** — set `NOMIX_USE_MOCK=true` to develop without a dongle.
- **Supabase schema** (`supabase/migrations/001_initial_schema.sql`) —
  devices, accounts, media, posts, warmup_runs, jobs.
- **Auth** — Supabase email/password; single-user.
- **Devices page** — list, inline-edit alias, restart, online status.

Other tabs (Accounts, Media, Warmup, Posts, Jobs) are placeholders for
the upcoming phases.

## Setup

### 1. Supabase

1. Create a new project at `https://supabase.com`.
2. Open the SQL editor and paste the contents of
   `supabase/migrations/001_initial_schema.sql`. Run it.
3. Project settings → API: copy the **Project URL**, the
   **anon public** key, and the **service_role** key.
4. Authentication → Users: add yourself as a user (email + password).
   You can disable signups in Authentication → Providers → Email if you
   want to lock it down.

### 2. Environment

Copy `.env.example` to `.env.local` (for local dev) and to your Vercel
project settings (for production):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

NOMIX_API_URL=https://panel.nomixclicker.com/clicker/v1
NOMIX_API_KEY=               # leave empty while NOMIX_USE_MOCK=true
NOMIX_USE_MOCK=true
```

### 3. Deploy

Push to a new GitHub repo and import it on Vercel. Set the env vars from
step 2 in the Vercel project settings.

## How the Nomix layer works

The client is a thin REST wrapper plus the same high-level helpers the
Python lib provides:

```ts
import { getNomixClient } from "@/lib/nomix";

const nomix = getNomixClient();

// list devices
const devices = await nomix.listDevices();

// tap at a coordinate (HID coords, 0–32767, device-independent)
await nomix.click("device-id", [16383, 16383]);

// swipe down from top-right corner (opens Control Center)
await nomix.swipe("device-id", [28813, 1000], { down: 10000 });

// parse the screen with the vision API
const screen = await nomix.screenState("device-id");
// → { app_name, description, elements: [...], latency }

// type text
await nomix.type("device-id", "hello world");
```

`getNomixClient()` returns the mock implementation if
`NOMIX_USE_MOCK=true`, so the rest of the app uses the same interface
regardless. Switch the flag off (or set it to `false`) once the dongle
is connected and you have a real API key.

## Roadmap

| Phase | Feature | Status |
| --- | --- | --- |
| 0 | Foundation + devices | ← you are here |
| 1 | Warmup | next |
| 2 | Post reels | — |
| 3 | Post carousels | — |
| 4 | Account creation | — |
