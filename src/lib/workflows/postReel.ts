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
/** Match keyword that uniquely identifies our upload channel (case-insensitive
 *  substring against element content / screen description). */
const UPLOAD_CHANNEL_NAME = "creator advisor";

async function saveVideoFromTelegram(
  client: INomixClient,
  deviceId: string,
  _payload: PostReelPayload
): Promise<boolean> {
  // 1. Home Screen
  await goHome(client, deviceId);
  await sleep(1500);

  // 2. Spotlight via "Cerca" button
  await client.click(deviceId, [16366, 27245]);
  await sleep(1500);

  // 3. Clear + type
  for (let i = 0; i < 30; i++) await client.combo(deviceId, ["Backspace"]);
  await client.type(deviceId, "telegram");
  await sleep(2000);

  // 4. VISION: find Telegram NATIVE app icon. iOS Spotlight has sections
  //    in this order: Suggerimenti (Chrome bookmarks!) → Applicazioni (real
  //    apps) → Siti web. A naive "first icon" picks the Suggerimenti bookmark.
  //
  //    Strict match: vision labels the actual app icon as "Telegram app icon"
  //    or just "Telegram"; Suggerimenti/web entries get descriptive labels
  //    like "Telegram - web", "Telegram icon with Chrome badge", etc.
  const spotlight = await parseScreen(client, deviceId);
  if (!spotlight) return false;

  const isLikelyApp = (s: string): boolean => {
    const t = s.trim();
    return (
      /^telegram$/i.test(t) ||
      /^telegram\s+(app|app icon|messenger|icon)$/i.test(t)
    );
  };

  // First pass: exact label match (most reliable).
  let tgIcon = spotlight.elements.find(
    (el) =>
      el.type === "icon" &&
      el.interactivity &&
      el.content !== null &&
      isLikelyApp(el.content)
  );

  // Fallback: any telegram-icon-like element that does NOT look like a web result.
  if (!tgIcon) {
    const candidates = spotlight.elements
      .filter(
        (el) =>
          el.type === "icon" &&
          el.interactivity &&
          el.content !== null &&
          /telegram/i.test(el.content) &&
          !/(chrome|safari|web|browser|edge|firefox|brave|page|bookmark|url|\.org|\.com|http)/i.test(
            el.content
          )
      )
      .sort((a, b) => a.center[1] - b.center[1]);
    tgIcon = candidates[0];
  }

  if (!tgIcon) return false;
  await client.click(deviceId, tgIcon.center);
  await sleep(5000);

  // Verify we landed in Telegram (and not Chrome/Safari opening web.telegram.org).
  // If wrong, try the SECOND candidate.
  const after = await parseScreen(client, deviceId);
  const appName = (after?.appName ?? "").toLowerCase();
  if (
    !appName.includes("telegram") ||
    /(chrome|safari|edge|firefox|brave)/i.test(appName)
  ) {
    // Open wrong app — bail; the dispatcher will retry. (We don't loop here
    // because each retry burns another ~30s vision call.)
    return false;
  }

  // 5. Navigate to the channel — Telegram remembers the last view (could be
  //    chat list, an open chat, a media preview, etc). Be tolerant.
  const reached = await navigateToUploadChannel(client, deviceId);
  if (!reached) return false;

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
  await sleep(4500);

  // 7. iOS share button
  await client.click(deviceId, [2588, 30505]);
  await sleep(3000);

  // 8. Scroll share-sheet actions list up so "Salva video" is on-screen
  await client.swipe(deviceId, [16384, 28000], { up: 7000, duration: 400 });
  await sleep(1500);

  // 9. Tap "Salva video"
  await client.click(deviceId, [16367, 21380]);
  await sleep(5000);

  // 10. Return to Home Screen
  await goHome(client, deviceId);
  await sleep(1500);
  return true;
}

/**
 * Navigate inside Telegram to the upload channel's chat view, regardless of
 * what Telegram opens to (chat list / inside a different chat / media preview).
 *
 * Strategy: up to 4 vision-guided attempts.
 *   - If the channel title is visible in the top-bar area → we're already inside, done.
 *   - Else if a chat row matching the channel name is interactive → tap it, retry.
 *   - Else if a "Back" button exists → tap it to go up one level, retry.
 *   - Else → fail.
 */
async function navigateToUploadChannel(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const screen = await parseScreen(client, deviceId);
    if (!screen) return false;

    // Already inside the channel? Telegram puts the chat title in the top bar
    // (y typically < 6000 on iPhone 15 Pro).
    const titleInTop = screen.elements.find(
      (el) =>
        el.center[1] < 6000 &&
        el.content !== null &&
        el.content.toLowerCase().includes(UPLOAD_CHANNEL_NAME)
    );
    if (titleInTop) {
      // Also verify we can see message/file content (we're truly inside, not on chat list)
      const hasMessages = screen.elements.some(
        (el) =>
          el.content !== null &&
          /file message|chat message|\.(mov|mp4)/i.test(el.content)
      );
      if (hasMessages) return true;
    }

    // Channel row visible in chat list? Tap it.
    const chatRow = screen.elements.find(
      (el) =>
        el.interactivity &&
        el.content !== null &&
        el.content.toLowerCase().includes(UPLOAD_CHANNEL_NAME) &&
        el.center[1] > 6000 // below the top bar, so it's a list row not a header
    );
    if (chatRow) {
      await client.click(deviceId, chatRow.center);
      await sleep(3000);
      continue;
    }

    // Else: try going back one level (top-left back button).
    const backBtn = screen.elements.find(
      (el) =>
        el.interactivity &&
        el.center[1] < 5000 &&
        el.center[0] < 5000 &&
        el.content !== null &&
        /back|indietro|fine|chiudi|close|chat|sfoglia/i.test(el.content)
    );
    if (backBtn) {
      await client.click(deviceId, backBtn.center);
      await sleep(2000);
      continue;
    }

    // Last resort: an iOS swipe-back gesture (right swipe from left edge)
    await client.swipe(deviceId, [200, 16000], { right: 25000, duration: 300 });
    await sleep(2000);
  }
  return false;
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
