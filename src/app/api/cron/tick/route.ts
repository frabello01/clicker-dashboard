/**
 * Cron orchestrator endpoint — invoked by Vercel Cron every minute.
 *
 * Validates the bearer token Vercel injects (CRON_SECRET), claims one
 * runnable job, advances it for up to ~50s, persists, returns.
 *
 * For local manual testing: GET this route with header
 *   Authorization: Bearer $CRON_SECRET
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { claimNextJob } from "@/lib/workflows/queue";
import { runJobTick } from "@/lib/workflows";

// Cap at 60s (Vercel Pro limit). Use 55s of it; the 5s buffer covers DB
// persist + JSON encode after tickWarmup returns.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TICK_BUDGET_MS = 55_000;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await claimNextJob();
  if (!job) {
    return NextResponse.json({ ok: true, claimed: false });
  }

  const deadlineMs = Date.now() + TICK_BUDGET_MS;
  const result = await runJobTick(job, deadlineMs);

  return NextResponse.json({
    ok: true,
    claimed: true,
    job: {
      id: job.id,
      kind: job.kind,
      device_id: job.device_id,
      attempts: job.attempts,
    },
    result,
  });
}

// Allow POST too — Vercel cron uses GET, but some manual runners prefer POST.
export const POST = GET;
