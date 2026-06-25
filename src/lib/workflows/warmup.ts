/**
 * Instagram warmup workflow — step-state machine.
 *
 * Pure logic: takes the current job state + payload + a wall-clock deadline,
 * advances as far as it can within the deadline, returns the updated state.
 * Database IO and cron orchestration live in the caller (queue.ts + the cron
 * route).
 *
 * Phases:
 *   open_app  → open Instagram via Spotlight
 *   open_reels → navigate to the Reels tab
 *   scrolling → main loop: scroll, maybe like/comment, sleep, repeat until
 *               duration_minutes elapsed
 *   close_app → return to Home Screen
 *   done      → job complete
 *
 * Each tick runs as many scroll cycles as fit in the deadline budget,
 * persists state, and returns. The cron picks the job up again on the next
 * tick and resumes from `state.phase`.
 */

import type { INomixClient } from "@/lib/nomix/client";
import type { Coords } from "@/lib/nomix/types";
import {
  closeApp,
  openApp,
  randomSleep,
  swipeFeed,
} from "@/lib/nomix/actions";
import { parseScreen } from "@/lib/nomix/screen";
import {
  chanceTap,
  isAd,
  openReels,
  postComment,
  randomComment,
  type CommentCoordCache,
} from "@/lib/instagram/primitives";

// ---------------- Public shapes ----------------

export const WARMUP_KIND = "instagram_warmup" as const;

export type WarmupPayload = {
  /** Total wall-clock minutes of Reels scrolling (excludes app open/close). */
  duration_minutes: number;
  /** Min seconds to sleep after each scroll cycle. */
  pause_seconds_min: number;
  /** Max seconds to sleep after each scroll cycle. */
  pause_seconds_max: number;
  /** 0..1 — probability of tapping "like" on each Reel. */
  like_chance: number;
  /** 0..1 — probability of opening comments and posting a comment. */
  comment_chance: number;
};

export type WarmupPhase =
  | "open_app"
  | "open_reels"
  | "scrolling"
  | "close_app"
  | "done";

export type WarmupState = {
  phase: WarmupPhase;
  /** Number of completed scroll cycles in the scrolling phase. */
  scrolls: number;
  /** Number of likes tapped so far. */
  likes: number;
  /** Number of comments successfully posted so far. */
  comments: number;
  /** ISO timestamp when the scrolling phase started (set on first scroll tick). */
  scrolling_started_at?: string;
  /** Cached comment input/submit coords across postComment calls. */
  comment_cache?: CommentCoordCache;
};

export type TickResult = {
  state: WarmupState;
  /** True when the workflow has reached its terminal "done" phase. */
  done: boolean;
  /** Non-null if the tick aborted due to a recoverable error. */
  error?: string;
};

// ---------------- Defaults / helpers ----------------

const NEW_STATE: WarmupState = {
  phase: "open_app",
  scrolls: 0,
  likes: 0,
  comments: 0,
};

/** Safety margin: stop the scrolling loop this many ms before deadline. */
const DEADLINE_MARGIN_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function randBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function elapsedSecondsSince(iso: string | undefined): number {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

// ---------------- Main entrypoint ----------------

/**
 * Advance the warmup workflow as far as the deadline allows. Returns the
 * updated state plus a `done` flag. The caller persists `result.state` and,
 * if `done`, marks the job completed.
 *
 * @param deadlineMs absolute wall-clock time (Date.now()) at which this
 *   invocation should yield, e.g. `Date.now() + 50_000` for a 60s function
 *   budget with 10s of caller-side overhead.
 */
export async function tickWarmup(
  client: INomixClient,
  deviceId: string,
  rawState: Partial<WarmupState> | null,
  payload: WarmupPayload,
  deadlineMs: number
): Promise<TickResult> {
  const state: WarmupState = {
    ...NEW_STATE,
    ...(rawState ?? {}),
  };

  switch (state.phase) {
    case "open_app": {
      const opened = await openApp(client, deviceId, "instagram");
      if (!opened) {
        return { state, done: false, error: "openApp(instagram) failed" };
      }
      state.phase = "open_reels";
      return { state, done: false };
    }

    case "open_reels": {
      const ok = await openReels(client, deviceId);
      if (!ok) {
        return { state, done: false, error: "openReels failed" };
      }
      state.phase = "scrolling";
      state.scrolling_started_at = new Date().toISOString();
      return runScrollingPhase(client, deviceId, state, payload, deadlineMs);
    }

    case "scrolling":
      return runScrollingPhase(client, deviceId, state, payload, deadlineMs);

    case "close_app": {
      await closeApp(client, deviceId);
      state.phase = "done";
      return { state, done: true };
    }

    case "done":
      return { state, done: true };
  }
}

// ---------------- Scrolling phase ----------------

async function runScrollingPhase(
  client: INomixClient,
  deviceId: string,
  state: WarmupState,
  payload: WarmupPayload,
  deadlineMs: number
): Promise<TickResult> {
  if (!state.scrolling_started_at) {
    state.scrolling_started_at = new Date().toISOString();
  }
  const totalSeconds = payload.duration_minutes * 60;
  // Ensure cache survives across iterations within this tick AND across ticks
  // (it's already part of state, so persisted automatically).
  if (!state.comment_cache) state.comment_cache = {};

  while (Date.now() < deadlineMs - DEADLINE_MARGIN_MS) {
    if (elapsedSecondsSince(state.scrolling_started_at) >= totalSeconds) {
      state.phase = "close_app";
      return { state, done: false };
    }

    const stepError = await doScrollCycle(client, deviceId, state, payload);
    if (stepError) {
      // Transient error — surface it but don't abandon the workflow; the
      // caller will increment attempts and reschedule.
      return { state, done: false, error: stepError };
    }

    // Pause between Reels (random within the configured range)
    const pauseS = randBetween(
      payload.pause_seconds_min,
      payload.pause_seconds_max
    );
    await sleep(pauseS * 1000);
  }

  return { state, done: false };
}

async function doScrollCycle(
  client: INomixClient,
  deviceId: string,
  state: WarmupState,
  payload: WarmupPayload
): Promise<string | undefined> {
  // Skip the swipe on the very first Reel of the entire warmup.
  if (state.scrolls > 0) {
    await swipeFeed(client, deviceId);
    await randomSleep(0.3, 0.8);
  }

  await sleep(1000);
  const screen = await parseScreen(client, deviceId);
  if (!screen) {
    return "parseScreen returned null";
  }

  if (isAd(screen)) {
    await screen.findAndClick(client, deviceId, ["close", "back"]);
    await sleep(500);
    state.scrolls += 1;
    return;
  }

  await randomSleep(1.5, 6.0);

  if (await chanceTap(client, deviceId, screen, "like", payload.like_chance)) {
    state.likes += 1;
    await randomSleep(0.5, 1.2);
  }

  if (
    await chanceTap(client, deviceId, screen, "comment", payload.comment_chance)
  ) {
    await sleep(2000);
    const posted = await postComment(client, deviceId, randomComment(), {
      cache: state.comment_cache,
    });
    if (posted) state.comments += 1;
  }

  state.scrolls += 1;
}

// ---------------- Utility for callers ----------------

/**
 * Build a fresh WarmupState for a brand-new job. Stored on `jobs.state` row
 * when the job is created.
 */
export function newWarmupState(): WarmupState {
  return { ...NEW_STATE };
}

/** Type guard — narrows an unknown jsonb blob to WarmupPayload. */
export function isWarmupPayload(v: unknown): v is WarmupPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.duration_minutes === "number" &&
    typeof p.pause_seconds_min === "number" &&
    typeof p.pause_seconds_max === "number" &&
    typeof p.like_chance === "number" &&
    typeof p.comment_chance === "number"
  );
}

/** Coords kept here for explicit re-export from workflows code. */
export type { Coords };
