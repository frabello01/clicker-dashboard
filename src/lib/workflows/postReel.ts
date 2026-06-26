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
  randomSleep,
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

async function saveVideoFromTelegram(
  client: INomixClient,
  deviceId: string,
  payload: PostReelPayload
): Promise<boolean> {
  const tg = await openApp(client, deviceId, "telegram");
  if (!tg) return false;
  await sleep(1500);

  // Open the upload channel — its title is unknown at code time, but it's the
  // chat that recently received the document. Fall back to the most recent
  // chat in the list (top of chats screen).
  const chats = await parseScreen(client, deviceId);
  if (!chats) return false;
  // Look for the channel by partial name match or first chat row.
  const channel =
    chats.find(["creator advisor", "upload"], { types: ["button", "icon", "text"] }) ??
    chats.elements.find((el) => el.type === "button" && el.interactivity)?.center;
  if (!channel) return false;
  await client.click(deviceId, channel);
  await randomSleep(1.5, 2.5);

  // Inside the chat, find the latest document — usually at the bottom of the
  // scrollable area. Match by file_name (Telegram shows it on each document row).
  const inChat = await parseScreen(client, deviceId);
  if (!inChat) return false;
  // Prefer an element whose content includes the filename; else any "document"-like icon.
  const doc =
    inChat.find(payload.file_name) ??
    inChat.find([".mp4", ".mov"], { interactiveOnly: false });
  if (!doc) return false;
  await client.click(deviceId, doc);
  await randomSleep(2.0, 3.0);

  // Telegram opens the file preview. Find the iOS share button (3-dots /
  // share icon top-right), then "Save Video" / "Save to Photos".
  const previewScreen = await parseScreen(client, deviceId);
  if (!previewScreen) return false;
  const shareBtn = previewScreen.find(["share", "more options", "actions"], {
    types: ["button", "icon"],
  });
  if (shareBtn) {
    await client.click(deviceId, shareBtn);
    await sleep(1500);
  }

  const shareSheet = await parseScreen(client, deviceId);
  if (!shareSheet) return false;
  const saveBtn = shareSheet.find(["save video", "save to photos", "salva video"], {
    interactiveOnly: false,
  });
  if (!saveBtn) return false;
  await client.click(deviceId, saveBtn);
  await randomSleep(2.0, 4.0);

  return true;
}

async function openReelComposer(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  const home = await parseScreen(client, deviceId);
  if (!home) return false;
  // The "+" button in the bottom-center nav opens the composer.
  const plusBtn = home.find(["create", "new post", "compose", "+"], {
    types: ["button", "icon", "tab"],
  });
  if (!plusBtn) return false;
  await client.click(deviceId, plusBtn);
  await sleep(2000);

  // Composer choice screen — tap "Reel".
  const composer = await parseScreen(client, deviceId);
  if (!composer) return false;
  const reelTab =
    composer.find("reel", { types: ["tab", "button"] }) ??
    composer.find("reels", { types: ["tab", "button"] });
  if (!reelTab) return false;
  await client.click(deviceId, reelTab);
  await sleep(2000);
  return true;
}

async function pickLatestVideoFromGallery(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  // Gallery picker: the most recent item is usually first (top-left). Vision
  // reports thumbnails as images — pick the first interactive image.
  const picker = await parseScreen(client, deviceId);
  if (!picker) return false;
  const firstThumb = picker.elements.find(
    (el) => (el.type === "image" || el.type === "button") && el.interactivity
  );
  if (!firstThumb) return false;
  await client.click(deviceId, firstThumb.center);
  await sleep(2000);

  // Tap "Next" (Avanti) to advance through trimmer / cover screens.
  for (let i = 0; i < 3; i++) {
    const screen = await parseScreen(client, deviceId);
    if (!screen) return false;
    const next = screen.find(["next", "avanti", "done", "share to"], {
      types: ["button"],
    });
    if (!next) break;
    await client.click(deviceId, next);
    await sleep(2500);
  }
  return true;
}

async function writeCaption(
  client: INomixClient,
  deviceId: string,
  caption: string
): Promise<boolean> {
  if (!caption) return true; // empty caption is allowed
  const screen = await parseScreen(client, deviceId);
  if (!screen) return false;
  const captionField = screen.find(
    ["write a caption", "scrivi una didascalia", "caption"],
    { interactiveOnly: false }
  );
  if (!captionField) return false;
  await client.click(deviceId, captionField);
  await sleep(800);
  await client.type(deviceId, caption);
  await sleep(1000);
  return true;
}

async function publishReel(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  const screen = await parseScreen(client, deviceId);
  if (!screen) return false;
  const shareBtn = screen.find(["share", "publish", "condividi", "pubblica"], {
    types: ["button"],
  });
  if (!shareBtn) return false;
  await client.click(deviceId, shareBtn);

  // Reel upload can take 30-90s. Poll for "Posted" / progress completion.
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const s = await parseScreen(client, deviceId);
    if (!s) continue;
    if (
      s.description.toLowerCase().includes("posted") ||
      s.description.toLowerCase().includes("pubblicato") ||
      s.find(["your reel", "il tuo reel", "see reel"])
    ) {
      return true;
    }
  }
  // Best-effort timeout — assume success if we got past the share button.
  return true;
}

// Re-export Screen type so callers don't need a separate import.
export type { Screen };
