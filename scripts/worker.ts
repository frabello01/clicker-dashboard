/**
 * Long-running worker for the Clicker Dashboard, designed to run on a
 * DigitalOcean droplet (or any host that allows long-lived processes —
 * no 60-second serverless timeout).
 *
 * Loop:
 *   1. Poll Supabase via claim_next_job RPC.
 *   2. If a job is claimed, run runJobTick on it with a generous deadline.
 *      The state machine in tickWarmup will chain through open_app →
 *      open_reels → scrolling → close_app → done in a single shot.
 *   3. If a tick returns without `done` (workflow split a phase boundary
 *      or hit an error), re-fetch from the DB and keep ticking — we still
 *      hold the lock until the next_run_at extension expires.
 *   4. Sleep POLL_INTERVAL_MS between empty polls.
 *
 * Start with:  npm run worker
 * In production:  pm2 start ecosystem.config.cjs (or `pm2 start dist/worker.js`)
 */

import {
  claimNextJob,
  failJob,
  getJob,
  type Job,
} from "@/lib/workflows/queue";
import { runJobTick } from "@/lib/workflows";

const POLL_INTERVAL_MS = 5_000;
const PER_TICK_BUDGET_MS = 55 * 60 * 1000; // 55 minutes per single tick call
const LOCK_SECONDS = 3700; // ~62 min — must exceed per-tick budget
const MAX_TICK_LOOPS = 50; // safety net: a single job claim shouldn't loop forever

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString();

let stopping = false;
process.on("SIGINT", () => {
  console.log(`[${ts()}] SIGINT received — stopping after current job`);
  stopping = true;
});
process.on("SIGTERM", () => {
  console.log(`[${ts()}] SIGTERM received — stopping after current job`);
  stopping = true;
});

async function processClaimedJob(initial: Job): Promise<void> {
  let job: Job | null = initial;
  let loops = 0;
  while (job && loops < MAX_TICK_LOOPS && !stopping) {
    if (job.status !== "running" && job.status !== "pending") {
      console.log(
        `[${ts()}] Job ${job.id} status changed to ${job.status} — releasing`
      );
      return;
    }
    const deadlineMs = Date.now() + PER_TICK_BUDGET_MS;
    const result = await runJobTick(job, deadlineMs);
    console.log(
      `[${ts()}] tick ${job.id} done=${result.done} error=${result.error ?? "-"}`
    );
    if (result.done) return;

    // Re-fetch from DB: persistJob/failJob/finishJob have written latest state,
    // and the user may have cancelled mid-tick.
    await sleep(500);
    job = await getJob(job.id);
  }

  if (loops >= MAX_TICK_LOOPS && job) {
    await failJob(job.id, job.state, "worker hit MAX_TICK_LOOPS safety cap");
    console.error(`[${ts()}] Job ${job.id} aborted: MAX_TICK_LOOPS reached`);
  }
}

async function main(): Promise<void> {
  console.log(`[${ts()}] clicker-worker starting (pid ${process.pid})`);
  console.log(
    `[${ts()}] POLL=${POLL_INTERVAL_MS}ms BUDGET=${PER_TICK_BUDGET_MS}ms LOCK=${LOCK_SECONDS}s`
  );

  while (!stopping) {
    let claimed: Job | null = null;
    try {
      claimed = await claimNextJob(LOCK_SECONDS);
    } catch (e) {
      console.error(`[${ts()}] claimNextJob threw:`, e);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!claimed) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(
      `[${ts()}] Picked up ${claimed.kind} ${claimed.id} on device=${claimed.device_id}`
    );
    try {
      await processClaimedJob(claimed);
    } catch (e) {
      console.error(`[${ts()}] processClaimedJob threw for ${claimed.id}:`, e);
      // Best-effort: write a failure marker so the job doesn't get stuck.
      try {
        await failJob(
          claimed.id,
          claimed.state,
          `worker threw: ${e instanceof Error ? e.message : String(e)}`
        );
      } catch {
        // ignore
      }
    }
  }

  console.log(`[${ts()}] clicker-worker exiting cleanly`);
}

main().catch((e) => {
  console.error(`[${ts()}] Fatal:`, e);
  process.exit(1);
});
