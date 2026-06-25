/**
 * /api/jobs — list (GET) + create (POST).
 *
 * Auth: user-session via the cookie-based Supabase client. RLS policy
 * "auth full" lets any authenticated user manage rows.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  WARMUP_KIND,
  isWarmupPayload,
  newWarmupState,
} from "@/lib/workflows/warmup";

export const dynamic = "force-dynamic";

/** GET /api/jobs?limit=50&status=pending,running */
export async function GET(req: Request) {
  const supabase = await createClient();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const statusFilter = url.searchParams.get("status")?.split(",").filter(Boolean);

  let query = supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusFilter && statusFilter.length > 0) {
    query = query.in("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobs: data });
}

/** POST /api/jobs — create a new job. Body: { kind, device_id, account_id?, payload }. */
export async function POST(req: Request) {
  const supabase = await createClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { kind, device_id, account_id, payload } = (body ?? {}) as {
    kind?: unknown;
    device_id?: unknown;
    account_id?: unknown;
    payload?: unknown;
  };

  if (kind !== WARMUP_KIND) {
    return NextResponse.json(
      { error: `unsupported kind: ${String(kind)}` },
      { status: 400 }
    );
  }
  if (typeof device_id !== "string" || device_id.trim().length === 0) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }
  if (!isWarmupPayload(payload)) {
    return NextResponse.json(
      {
        error:
          "invalid warmup payload — required: duration_minutes, pause_seconds_min, pause_seconds_max, like_chance, comment_chance (all numbers)",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      kind: WARMUP_KIND,
      device_id: device_id.trim(),
      account_id:
        typeof account_id === "string" && account_id.trim() ? account_id.trim() : null,
      payload,
      state: newWarmupState(),
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ job: data }, { status: 201 });
}
