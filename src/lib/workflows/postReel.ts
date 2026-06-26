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

/**
 * Open an iOS app via Spotlight in a SINGLE vision call.
 *
 * Algorithm (1 vision call), based on the REAL Spotlight layout captured on
 * iPhone 15 Pro (IT). Spotlight sections, top to bottom:
 *   "Risultati migliori"  → native app: "Telegram App Icon" (button)   ← we want THIS
 *   "Suggerimenti"        → Chrome bookmarks ("telegram", "telegram web"…)
 *   "Siti web"            → Safari/Chrome results ("Telegram web.telegram.org"…)
 *
 * The native app icon is always the first interactive button/icon under the
 * "Risultati migliori" (top-hits) header, with a label like "Telegram App
 * Icon". Browser entries carry web markers (chrome / overlay / .org / web).
 *
 * Steps:
 *   1. goHome via Cmd+H (deterministic — fixes the old swipe-up that stranded
 *      us in Safari).
 *   2. Tap the Home "Cerca" button → Spotlight (standard iOS position).
 *   3. Clear + type "telegram".
 *   4. parseScreen once; pick the top-hits app icon; tap.
 */
async function openTelegramViaSpotlight(
  client: INomixClient,
  deviceId: string
): Promise<boolean> {
  await goHome(client, deviceId);
  await sleep(1500);

  // "Cerca" button — standard iOS position centred above the dock.
  await client.click(deviceId, [16366, 27245]);
  await sleep(1500);
  for (let i = 0; i < 30; i++) await client.combo(deviceId, ["Backspace"]);
  await client.type(deviceId, "telegram");
  await sleep(2000);

  const screen = await parseScreen(client, deviceId);
  if (!screen) {
    console.log("[openTelegram] parseScreen returned null (no frame)");
    return false;
  }
  console.log(
    `[openTelegram] app=${screen.appName} telegram-elements=`,
    JSON.stringify(
      screen.elements
        .filter((e) => e.content && /telegram/i.test(e.content))
        .map((e) => ({ t: e.type, c: e.content, y: e.center[1], i: e.interactivity }))
    )
  );

  // Anchor on the top-hits header so we never wander into Suggerimenti/Siti web.
  const topHitsHeader = screen.elements.find(
    (el) =>
      el.content !== null &&
      /(risultati migliori|migliori risultati|top hit|best match)/i.test(
        el.content
      )
  );
  const suggHeader = screen.elements.find(
    (el) =>
      el.content !== null &&
      /(suggeriment|suggestion|siti web|websites)/i.test(el.content)
  );
  const lowerBound = topHitsHeader?.center[1] ?? 0;
  const upperBound = suggHeader?.center[1] ?? Number.MAX_SAFE_INTEGER;

  const isBrowserEntry = (s: string) =>
    /(chrome|safari|edge|firefox|brave|overlay|browser|\.org|\.com|t\.me|http|web\b)/i.test(
      s
    );

  // Primary: an icon/button labelled like the native app ("Telegram App Icon"),
  // inside the top-hits band, with no browser markers.
  let target = screen.elements.find(
    (el) =>
      el.interactivity &&
      (el.type === "button" || el.type === "icon") &&
      el.content !== null &&
      /telegram/i.test(el.content) &&
      /app icon|app$/i.test(el.content) &&
      !isBrowserEntry(el.content) &&
      el.center[1] > lowerBound &&
      el.center[1] < upperBound
  );

  // Fallback: first interactive telegram element in the top-hits band.
  if (!target) {
    target = screen.elements
      .filter(
        (el) =>
          el.interactivity &&
          el.type !== "input" &&
          el.content !== null &&
          /telegram/i.test(el.content) &&
          !isBrowserEntry(el.content) &&
          el.center[1] > lowerBound &&
          el.center[1] < upperBound
      )
      .sort((a, b) => a.center[1] - b.center[1])[0];
  }

  if (!target) {
    console.log("[openTelegram] no target found after filtering");
    return false;
  }
  console.log(
    `[openTelegram] tapping target='${target.content}' @ (${target.center.join(",")})`
  );
  await client.click(deviceId, target.center);
  await sleep(5000);
  return true;
}

async function saveVideoFromTelegram(
  client: INomixClient,
  deviceId: string,
  _payload: PostReelPayload
): Promise<boolean> {
  // Delegate the whole Telegram→Photos flow to the Nomix agent. This is far
  // more robust than coordinate/vision navigation, which kept failing on the
  // unstable broadcast. The agent opens Telegram, finds the upload channel,
  // opens the latest video, and saves it to Photos via the iOS share sheet.
  const task =
    `Open the Telegram app. Open the channel named "Creator Advisor Upload Bot". ` +
    `Find the most recently posted video file in that channel and tap it to open the preview. ` +
    `Then tap the iOS share button (bottom-left), and in the share sheet tap "Salva video" ` +
    `to save the video into the Photos app. Confirm the video is saved.`;

  const result = await client.agentRunToCompletion(deviceId, task, {
    timeoutMs: 180_000,
  });
  if (result.status !== "completed") {
    return false;
  }
  await goHome(client, deviceId);
  await sleep(1500);
  return true;
}

/** @deprecated kept for reference — old coordinate/vision Telegram flow. */
async function saveVideoFromTelegram_legacy(
  client: INomixClient,
  deviceId: string,
  _payload: PostReelPayload
): Promise<boolean> {
  const tg = await openApp(client, deviceId, "telegram");
  if (!tg) return false;
  await sleep(2000);

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
