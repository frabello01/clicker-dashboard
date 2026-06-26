/**
 * Instagram-specific primitives layered on top of the generic Nomix actions.
 * Ports the keyword constants and IG-specific orchestration from
 * scripts/instagram-warmup.py.
 *
 * The "generic-but-listed-here" helpers (isAd, chanceTap, postComment) live
 * here per the project roadmap (CLAUDE.md §"Phase 1 plan"). When Phase 2
 * adds another app surface they can be promoted to lib/nomix/actions.ts.
 */

import type { INomixClient } from "@/lib/nomix/client";
import type { Coords } from "@/lib/nomix/types";
import { Screen, parseScreen } from "@/lib/nomix/screen";

// ---------------- Keyword constants ----------------

export const COMMENTS = [
  "fire",
  "amazing",
  "love this",
  "wow",
  "so good",
  "this is great",
  "nice",
  "cool",
  "awesome",
  "beautiful",
] as const;

export const COMMENT_INPUT_KEYWORDS = [
  "add a comment",
  "add comment",
  "join the conversation",
  "comment as",
  "what do you think",
] as const;

export const COMMENT_SUBMIT_KEYWORDS = [
  "send arrow",
  "send comment",
  "post comment",
  "send",
] as const;

const AD_KEYWORDS = [
  "advertising",
  "advertisement",
  "sponsored",
  "contact us",
  "shop now",
  "learn more",
  "install now",
  "send message",
  "get quote",
] as const;

// ---------------- Predicates ----------------

/** Heuristic ad detection — matches description keywords or an "ad" badge. */
export function isAd(screen: Screen): boolean {
  if (screen.contains([...AD_KEYWORDS])) return true;
  return screen.elements.some(
    (el) => el.content !== null && el.content.toLowerCase() === "ad"
  );
}

// ---------------- Probabilistic actions ----------------

/** With probability `chance`, find a button by keyword and tap it. */
export async function chanceTap(
  client: INomixClient,
  deviceId: string,
  screen: Screen,
  keyword: string,
  chance: number
): Promise<boolean> {
  if (Math.random() >= chance) return false;
  return screen.findAndClick(client, deviceId, keyword);
}

/** Pick a random canned comment. */
export function randomComment(): string {
  return COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
}

// ---------------- Comment posting ----------------

/**
 * Cached comment input + submit coords. Pass the same object across
 * `postComment` calls within a session to skip re-parsing.
 */
export type CommentCoordCache = {
  input?: Coords;
  submit?: Coords;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Find the comment input, type `text`, submit. On first call parses the
 * screen twice (before typing → find input; after typing → find send button
 * which only appears with the keyboard up). On subsequent calls with a
 * populated cache, both parses are skipped.
 *
 * Mirrors post_comment() from utils/actions.py.
 */
export async function postComment(
  client: INomixClient,
  deviceId: string,
  text: string,
  {
    inputKeywords = [...COMMENT_INPUT_KEYWORDS],
    submitKeywords = [...COMMENT_SUBMIT_KEYWORDS],
    cache,
  }: {
    inputKeywords?: string[];
    submitKeywords?: string[];
    cache?: CommentCoordCache;
  } = {}
): Promise<boolean> {
  if (cache?.input && cache.submit) {
    await client.click(deviceId, cache.input);
    await client.type(deviceId, text);
    await sleep(500);
    await client.click(deviceId, cache.submit);
    return true;
  }

  const before = await parseScreen(client, deviceId);
  if (!before) return false;

  const inputCoords = before.find(inputKeywords, { interactiveOnly: false });
  if (!inputCoords) return false;

  await client.click(deviceId, inputCoords);
  await client.type(deviceId, text);
  await sleep(1000);

  const after = await parseScreen(client, deviceId);
  if (!after) return false;

  const submitCoords = after.find(submitKeywords, { interactiveOnly: false });
  if (!submitCoords) return false;

  if (cache) {
    cache.input = inputCoords;
    cache.submit = submitCoords;
  }

  await client.click(deviceId, submitCoords);
  await sleep(1000);
  // Tap above the comments sheet to dismiss
  await client.click(deviceId, [16383, 4096]);
  await sleep(500);
  return true;
}

// ---------------- Reels navigation ----------------

/**
 * Navigate to the Reels tab inside Instagram.
 *
 * Up to 3 internal attempts (each ~10s) because Instagram often shows a
 * splash/loading state right after launch where the Reels tab isn't yet
 * tappable. Cheap to retry — no closeApp / no center-tap fallback. Pass
 * `initialScreen` from openApp to skip the first parseScreen.
 */
export async function openReels(
  client: INomixClient,
  deviceId: string,
  initialScreen?: Screen
): Promise<boolean> {
  // If we already happen to be on the Reels feed (seed from openApp), done.
  if (initialScreen && initialScreen.description.toLowerCase().includes("reel")) {
    return true;
  }

  // PRIMARY: delegate to the Nomix agent — robust against broadcast hiccups
  // and Instagram UI changes. The Reels tab is the film-strip icon in the
  // bottom nav; the agent knows how to find and tap it.
  try {
    const result = await client.agentRunToCompletion(
      deviceId,
      "In the Instagram app, tap the Reels tab in the bottom navigation bar to open the Reels feed. The Reels tab is the clapperboard/film icon.",
      { timeoutMs: 90_000 }
    );
    if (result.status === "completed") {
      await sleep(2500);
      const check = await parseScreen(client, deviceId);
      // If the broadcast is flaky we may not get a frame; trust the agent's
      // completion in that case rather than failing the whole workflow.
      if (!check || check.description.toLowerCase().includes("reel")) {
        return true;
      }
    }
  } catch {
    // fall through to vision-based fallback
  }

  // FALLBACK: vision tap on the "reels" tab.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const screen = await parseScreen(client, deviceId);
    if (!screen) {
      await sleep(1500);
      continue;
    }
    const tapped = await screen.findAndClick(client, deviceId, "reels", {
      types: ["tab", "button", "icon"],
    });
    if (!tapped) {
      await sleep(2000);
      continue;
    }
    await sleep(2000);
    const check = await parseScreen(client, deviceId);
    if (check && check.description.toLowerCase().includes("reel")) {
      return true;
    }
  }
  return false;
}
