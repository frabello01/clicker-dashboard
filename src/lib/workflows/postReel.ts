/**
 * Instagram post-reel workflow.
 *
 * Phases (chained inside one tick — droplet worker has no Vercel timeout):
 *   save_video      open Telegram → tap upload channel → tap latest doc → Save Video
 *   open_instagram  goHome → Spotlight → tap Instagram icon (skip if already in IG)
 *   open_composer   tap "+" → tap "Reel"
 *   pick_video      tap gallery → tap most recent video → Next
 *   write_caption   tap caption field → paste text
 *   publish         tap Share/Publish → wait for upload to complete
 *   done            cleanup (goHome) handled by worker
 */

import type { INomixClient } from "@/lib/nomix/client";
import {
  closeApp,
  goHome,
  openApp,
} from "@/lib/nomix/actions";
import { parseScreen, Screen } from "@/lib/nomix/screen";

export const POST_REEL_KIND = "instagram_post_reel" as const;

export type PostReelPayload = {
  /** Caption to paste in the Reel composer. */
  caption: string;
  /** Telegram message_id of the document — used for traceability / debugging. */
  telegram_message_id: number;
  /** Original filename (e.g. "my-reel.mp4") — shown in Telegram document list. */
  file_name: string;
  /** Telegram document file_id — can be used to re-fetch metadata via Bot API. */
  telegram_file_id?: string;
};

export type PostReelPhase =
  | "save_video"
  | "open_instagram"
  | "open_composer"
  | "pick_video"
  | "write_caption"
  | "publish"
  | "done";

export type PostReelState = {
  phase: PostReelPhase;
  /** When the workflow first started — for total-elapsed reporting. */
  started_at?: string;
  /** Last observable phone state, for debug if a phase stalls. */
  last_app_seen?: string;
  /** Where the upload progress bar last reached (if observable). */
  last_progress_note?: string;
};

export type TickResult = {
  state: PostReelState;
  done: boolean;
  error?: string;
};

const NEW_STATE: PostReelState = { phase: "save_video" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function newPostReelState(): PostReelState {
  return { ...NEW_STATE };
}

export function isPostReelPayload(v: unknown): v is PostReelPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.caption === "string" &&
    typeof p.telegram_message_id === "number" &&
    typeof p.file_name === "string"
  );
}

// ---------------- Main entry ----------------

export async function tickPostReel(
  client: INomixClient,
  deviceId: string,
  rawState: Partial<PostReelState> | null,
  payload: PostReelPayload,
  _deadlineMs: number
): Promise<TickResult> {
  const state: PostReelState = { ...NEW_STATE, ...(rawState ?? {}) };
  if (!state.started_at) state.started_at = new Date().toISOString();

  if (state.phase === "save_video") {
    const ok = await saveVideoFromTelegram(client, deviceId, payload);
    if (!ok) return { state, done: false, error: "saveVideoFromTelegram failed" };
    state.phase = "open_instagram";
  }

  if (state.phase === "open_instagram") {
    const opened = await openApp(client, deviceId, "instagram");
    if (!opened) return { state, done: false, error: "openApp(instagram) failed" };
    state.last_app_seen = opened.appName;
    await sleep(2500);
    state.phase = "open_composer";
  }

  if (state.phase === "open_composer") {
    const ok = await openReelComposer(client, deviceId);
    if (!ok) return { state, done: false, error: "openReelComposer failed" };
    state.phase = "pick_video";
  }

  if (state.phase === "pick_video") {
    const ok = await pickLatestVideoFromGallery(client, deviceId);
    if (!ok) return { state, done: false, error: "pickLatestVideoFromGallery failed" };
    state.phase = "write_caption";
  }

  if (state.phase === "write_caption") {
    const ok = await writeCaption(client, deviceId, payload.caption);
    if (!ok) return { state, done: false, error: "writeCaption failed" };
    state.phase = "publish";
  }

  if (state.phase === "publish") {
    const ok = await publishReel(client, deviceId);
    if (!ok) return { state, done: false, error: "publishReel failed" };
    state.phase = "done";
  }

  if (state.phase === "done") {
    await closeApp(client, deviceId);
    return { state, done: true };
  }

  return { state, done: true };
}

// ---------------- Phase implementations ----------------

/**
 * Saves the latest video from the Telegram upload channel into iOS Photos.
 *
 * Built with HARDCODED COORDINATES captured from an iPhone 15 Pro (iOS Italian)
 * to minimize parseScreen calls — Nomix vision has a ~30s cooldown per call,
 * so a 5-vision workflow costs 2-3 minutes. We use vision only at TWO
 * decision points: finding the Telegram icon in Spotlight (Spotlight order
 * varies) and finding the latest video in the chat (position depends on
 * message count).
 */
async function saveVideoFromTelegram(
  client: INomixClient,
  deviceId: string,
  _payload: PostReelPayload
): Promise<boolean> {
  // 1. Make sure we're on Home Screen
  await goHome(client, deviceId);
  await sleep(1500);

  // 2. Open Spotlight via the "Cerca" button at the bottom of home screen
  await client.click(deviceId, [16366, 27245]);
  await sleep(1500);

  // 3. Clear any leftover query, then type "telegram"
  for (let i = 0; i < 30; i++) await client.combo(deviceId, ["Backspace"]);
  await client.type(deviceId, "telegram");
  await sleep(2000);

  // 4. VISION: find the Telegram app icon (position in Spotlight varies)
  const spotlight = await parseScreen(client, deviceId);
  if (!spotlight) return false;
  const tgIcon = spotlight.elements.find(
    (el) =>
      el.type === "icon" &&
      el.interactivity &&
      el.content !== null &&
      /^telegram\b/i.test(el.content)
  );
  if (!tgIcon) return false;
  await client.click(deviceId, tgIcon.center);
  await sleep(5000); // Telegram cold launch

  // 5. Tap the "Creator Advisor Upload Bot" channel row (top of chat list)
  await client.click(deviceId, [15564, 7437]);
  await sleep(4000);

  // 6. VISION: find the most recent video in the chat (bottom-most file)
  const chat = await parseScreen(client, deviceId);
  if (!chat) return false;
  const videos = chat.elements.filter(
    (el) =>
      el.interactivity &&
      el.content !== null &&
      /\.(mov|mp4|m4v)\b/i.test(el.content)
  );
  if (videos.length === 0) return false;
  const latest = videos.sort((a, b) => b.center[1] - a.center[1])[0];
  await client.click(deviceId, latest.center);
  await sleep(4500); // iOS opens the file in Photos/Files preview

  // 7. Tap the iOS share button (bottom-left of preview)
  await client.click(deviceId, [2588, 30505]);
  await sleep(3000); // share sheet animation

  // 8. Scroll the share-sheet actions list up so "Salva video" comes into view.
  //    Small drag inside the modal — too much would dismiss it or tap an action.
  await client.swipe(deviceId, [16384, 28000], {
    up: 7000,
    duration: 400,
  });
  await sleep(1500);

  // 9. Tap "Salva video" — its on-screen y is consistent after the scroll above
  //    on iPhone 15 Pro. (Captured: 16367, 21380.)
  await client.click(deviceId, [16367, 21380]);
  await sleep(5000); // save-to-Photos completion

  // 10. Return to Home Screen so the next phase starts clean.
  await goHome(client, deviceId);
  await sleep(1500);

  return true;
}

/**
 * Open Instagram's reel composer.
 *
 * Hardcoded coords captured from iPhone 15 Pro / IT iOS — IG's home-feed
 * "+" button is top-LEFT (not bottom). After the composer opens, the REEL
 * mode tab is at the bottom; we tap it and then the gallery preview.
 *
 * Coords:
 *   Add post (+):           (2326, 3194)   — top-left of IG home feed
 *   REEL mode tab:          (22183, 30702) — bottom of composer
 *   Gallery preview button: (2768, 30719)  — bottom-left, opens picker
 */
async function openReelComposer(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  await client.click(deviceId, [2326, 3194]); // Add post
  await sleep(3000);
  await client.click(deviceId, [22183, 30702]); // REEL tab
  await sleep(1500);
  await client.click(deviceId, [2768, 30719]); // gallery preview
  await sleep(3500);
  return true;
}

/**
 * Pick the most recent video from the gallery picker + advance through
 * the editor (dismissing the occasional Reels announcement modal) to reach
 * the caption screen.
 *
 * Coords (iPhone 15 Pro / IT iOS, "Recents" album view):
 *   First/latest video thumb:    (12270, 23117) — top-left of grid (after the Camera button)
 *   Avanti (gallery → editor):   (29244, 3112)  — top-right
 *   Reels announcement OK:       (16366, 23083) — modal that sometimes appears
 *   Avanti (editor → caption):   (27835, 30308) — bottom-right
 */
async function pickLatestVideoFromGallery(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  await client.click(deviceId, [12270, 23117]); // latest video thumb
  await sleep(1500);
  await client.click(deviceId, [29244, 3112]); // Avanti -> editor
  await sleep(4000);
  // Reels announcement modal — tap OK if present. The tap is harmless if
  // the modal isn't there (lands on the editor canvas, ignored).
  await client.click(deviceId, [16366, 23083]);
  await sleep(1500);
  await client.click(deviceId, [27835, 30308]); // Avanti -> caption screen
  await sleep(4000);
  return true;
}

/**
 * Type the caption into the "Aggiungi una didascalia..." input field.
 * Coord captured for iPhone 15 Pro / IT iOS: (9911, 16317).
 */
async function writeCaption(
  client: INomixClient,
  deviceId: string,
  caption: string
): Promise<boolean> {
  if (!caption) return true;
  await client.click(deviceId, [9911, 16317]);
  await sleep(1200);
  // Clear any leftover text in case IG remembered an old draft
  for (let i = 0; i < 50; i++) await client.combo(deviceId, ["Backspace"]);
  await client.type(deviceId, caption);
  await sleep(1500);
  return true;
}

/**
 * Tap "Condividi" to publish the reel. Coord: (24214, 30145).
 * IG's upload can take 30-90s; we DON'T poll for "posted" because every
 * parseScreen costs ~30s of vision latency. Trust the tap; the upload
 * progresses in background even after we return.
 */
async function publishReel(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  await client.click(deviceId, [24214, 30145]);
  // Give IG a chunk of time to start the upload before we navigate away —
  // tapping Home while the upload is mid-flight can cancel it on some
  // builds. 30s is conservative; reduce if confirmed safe.
  await sleep(30_000);
  return true;
}

// Re-export Screen type so callers don't need a separate import.
export type { Screen };
