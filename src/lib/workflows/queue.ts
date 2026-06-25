/**
 * Job queue persistence layer.
 *
 * Uses the service-role Supabase client so it works from cron contexts
 * without a user session. All queries hit the `public.jobs` table; the
 * atomic claim is delegated to the `claim_next_job` Postgres function
 * (see supabase/migrations/002_claim_next_job.sql).
 */

import { adminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type Job<TPayload = unknown, TState = unknown> = {
  id: string;
  kind: string;
  account_id: string | null;
  device_id: string | null;
  payload: TPayload;
  state: TState;
  status: JobStatus;
  attempts: number;
  next_run_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Atomically claim the next runnable job. Marks it 'running' and sets a
 * lock window via next_run_at. Returns null if nothing is claimable.
 *
 * Per-device exclusion is enforced inside the SQL function.
 */
export async function claimNextJob(
  lockSeconds = 90
): Promise<Job | null> {
  const supabase = adminClient();
  const { data, error } = await supabase.rpc("claim_next_job", {
    p_lock_seconds: lockSeconds,
  });
  if (error) throw error;
  // claim_next_job returns SETOF jobs — empty array means "nothing to claim".
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Job | undefined) ?? null;
}

/**
 * Persist an in-progress job after a tick. The caller decides when to
 * resume by setting `nextRunInSeconds` (default 30s).
 */
export async function persistJob(
  jobId: string,
  state: unknown,
  {
    nextRunInSeconds = 30,
    error: jobError,
  }: { nextRunInSeconds?: number; error?: string } = {}
): Promise<void> {
  const supabase = adminClient();
  const nextRunAt = new Date(
    Date.now() + nextRunInSeconds * 1000
  ).toISOString();
  const { error } = await supabase
    .from("jobs")
    .update({
      state: state as Json,
      next_run_at: nextRunAt,
      error: jobError ?? null,
    })
    .eq("id", jobId);
  if (error) throw error;
}

/** Mark a job complete (terminal). */
export async function finishJob(
  jobId: string,
  state: unknown
): Promise<void> {
  const supabase = adminClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      state: state as Json,
      status: "completed",
      finished_at: new Date().toISOString(),
      next_run_at: null,
      error: null,
    })
    .eq("id", jobId);
  if (error) throw error;
}

/** Mark a job permanently failed. */
export async function failJob(
  jobId: string,
  state: unknown,
  reason: string
): Promise<void> {
  const supabase = adminClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      state: state as Json,
      status: "failed",
      finished_at: new Date().toISOString(),
      next_run_at: null,
      error: reason,
    })
    .eq("id", jobId);
  if (error) throw error;
}
