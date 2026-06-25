/**
 * POST /api/jobs/[id]/cancel — mark a job as cancelled.
 *
 * Sets status='cancelled' and clears next_run_at so the cron won't claim it
 * again. An in-flight tick currently executing on the phone will finish its
 * chunk (we can't kill a serverless function mid-execution), but no further
 * ticks will run. Idempotent — cancelling a terminal job is a no-op.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "cancelled",
      next_run_at: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["pending", "running"])
    .select()
    .single();

  if (error) {
    // PGRST116 = no rows matched (job already terminal or doesn't exist)
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "job not found or already finished" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ job: data });
}
