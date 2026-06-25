/**
 * Workflow dispatcher — runs one chunked tick of whatever workflow a job
 * encodes. Add new `kind` handlers here as we ship more phases.
 *
 * Called by the cron route after `claimNextJob()` returns a row.
 */

import { getNomixClient } from "@/lib/nomix";
import { failJob, finishJob, persistJob, type Job } from "./queue";
import {
  WARMUP_KIND,
  isWarmupPayload,
  tickWarmup,
  type WarmupPayload,
  type WarmupState,
} from "./warmup";

/** After a successful tick that left the job in progress, when to retry. */
const NEXT_TICK_DELAY_SECONDS = 30;
/** After a recoverable error, back off a bit longer. */
const ERROR_RETRY_DELAY_SECONDS = 60;
/** When the vision pipeline is disconnected (NMX Viewer offline / no frame),
 *  back off MUCH longer — retrying every 15s just spams Nomix API while the
 *  user is presumably reconnecting the broadcast on the phone. */
const NMX_DISCONNECTED_DELAY_SECONDS = 120;
/** Hard cap on tick attempts before we mark the job failed. */
const MAX_ATTEMPTS = 20;

/** Heuristic: error string indicates the phone's NMX Viewer broadcast has
 *  stopped. Surfaces from Nomix with messages like "No frame available". */
function isNmxDisconnected(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("no frame available") ||
    lower.includes("restart broadcast") ||
    lower.includes("nmx viewer")
  );
}

export type RunResult = {
  jobId: string;
  kind: string;
  done: boolean;
  error?: string;
};

/**
 * Run a single tick of the given job. Persists state + status to the DB.
 * `deadlineMs` is the wall-clock by which the tick must return.
 */
export async function runJobTick(
  job: Job,
  deadlineMs: number
): Promise<RunResult> {
  if (!job.device_id) {
    await failJob(job.id, job.state, "job has no device_id");
    return { jobId: job.id, kind: job.kind, done: false, error: "no device_id" };
  }

  const client = getNomixClient();

  switch (job.kind) {
    case WARMUP_KIND: {
      if (!isWarmupPayload(job.payload)) {
        await failJob(job.id, job.state, "invalid warmup payload");
        return {
          jobId: job.id,
          kind: job.kind,
          done: false,
          error: "invalid payload",
        };
      }
      const payload = job.payload as WarmupPayload;
      const state = job.state as Partial<WarmupState> | null;

      let result: Awaited<ReturnType<typeof tickWarmup>>;
      try {
        result = await tickWarmup(
          client,
          job.device_id,
          state,
          payload,
          deadlineMs
        );
      } catch (e) {
        // Exception inside the tick — most often a Nomix HTTP error or a
        // Vercel max-duration hit. Persist the error so the row doesn't
        // sit at status='running' forever and the next claim cycle has
        // visibility into what's wrong.
        const message = e instanceof Error ? e.message : String(e);
        const nextState = (state ?? {}) as WarmupState;
        const isDisc = isNmxDisconnected(message);
        // NMX disconnect doesn't count toward MAX_ATTEMPTS — it's a temporary
        // user-fixable situation, not a workflow bug.
        if (!isDisc && job.attempts >= MAX_ATTEMPTS) {
          await failJob(job.id, nextState, `tick threw: ${message}`);
          return {
            jobId: job.id,
            kind: job.kind,
            done: false,
            error: message,
          };
        }
        await persistJob(job.id, nextState, {
          nextRunInSeconds: isDisc
            ? NMX_DISCONNECTED_DELAY_SECONDS
            : ERROR_RETRY_DELAY_SECONDS,
          error: `tick threw: ${message}`,
        });
        return {
          jobId: job.id,
          kind: job.kind,
          done: false,
          error: message,
        };
      }

      if (result.done) {
        await finishJob(job.id, result.state);
        return { jobId: job.id, kind: job.kind, done: true };
      }

      if (result.error && job.attempts >= MAX_ATTEMPTS) {
        await failJob(
          job.id,
          result.state,
          `max attempts reached: ${result.error}`
        );
        return {
          jobId: job.id,
          kind: job.kind,
          done: false,
          error: result.error,
        };
      }

      const isDisc = isNmxDisconnected(result.error);
      await persistJob(job.id, result.state, {
        nextRunInSeconds: isDisc
          ? NMX_DISCONNECTED_DELAY_SECONDS
          : result.error
          ? ERROR_RETRY_DELAY_SECONDS
          : NEXT_TICK_DELAY_SECONDS,
        error: result.error,
      });
      return {
        jobId: job.id,
        kind: job.kind,
        done: false,
        error: result.error,
      };
    }

    default: {
      await failJob(job.id, job.state, `unknown job kind: ${job.kind}`);
      return {
        jobId: job.id,
        kind: job.kind,
        done: false,
        error: `unknown kind: ${job.kind}`,
      };
    }
  }
}
