/**
 * Generic, app-agnostic high-level actions. Mirrors the non-IG-specific parts
 * of utils/actions.py from nomix-ai/ClickerScriptingLibrary.
 *
 * IG-specific helpers (ad detection, comment posting, reels navigation) live
 * in src/lib/instagram/primitives.ts.
 */

import type { INomixClient } from "./client";
import { Screen, parseScreen } from "./screen";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Clear any pre-existing text from a focused keyboard input by spamming
 * Backspace. iOS Spotlight in particular remembers the previous query
 * across invocations, so without this `type("instagram")` after a previous
 * "Drive" search becomes "DriveInstagram".
 */
async function clearKeyboardInput(
  client: INomixClient,
  deviceId: string,
  maxChars = 40
): Promise<void> {
  for (let i = 0; i < maxChars; i++) {
    await client.combo(deviceId, ["Backspace"]);
  }
}

/** Sleep a random duration to simulate human-like timing variance. */
export function randomSleep(minS = 0.3, maxS = 0.8): Promise<void> {
  const ms = (Math.random() * (maxS - minS) + minS) * 1000;
  return sleep(ms);
}

/** iOS swipe-back gesture (swipe right from left edge). */
export function swipeBack(client: INomixClient, deviceId: string): Promise<void> {
  return client.swipe(deviceId, [5000, 16000], { right: 20000, duration: 300 });
}

/**
 * Force the phone back to the Home Screen.
 *
 * Face ID iPhones: swipe up from the very bottom edge ≈ "Home gesture".
 * Works from any app and from App Library / Notification Center / Spotlight.
 * Idempotent: doing it from Home is a no-op visually.
 */
export async function goHome(
  client: INomixClient,
  deviceId: string
): Promise<void> {
  await client.swipe(deviceId, [16384, 32500], {
    up: 17500,
    duration: 300,
  });
  await sleep(1200); // home animation
}

/** Swipe up to the next item in a vertical feed. */
export function swipeFeed(client: INomixClient, deviceId: string): Promise<void> {
  return client.swipe(deviceId, [16383, 26213], { up: 6553, duration: 100 });
}

/** Parse screen + find element by keywords + click — in one call. */
export async function findAndClick(
  client: INomixClient,
  deviceId: string,
  keywords: string | string[],
  opts: { interactiveOnly?: boolean } = {}
): Promise<boolean> {
  const screen = await parseScreen(client, deviceId);
  if (!screen) return false;
  return screen.findAndClick(client, deviceId, keywords, opts);
}

/**
 * Open an app, robust to whatever screen the phone is currently on.
 *
 * Strategy (in order):
 *   1. If we're ALREADY in the target app → return the current screen
 *      (zero-cost resume).
 *   2. If we're in App Library → use its native search bar (no Spotlight gesture
 *      needed, more reliable than swipe-down inside that view).
 *   3. Otherwise → goHome (force Home Screen) then Spotlight + type + tap.
 *
 * Returns the post-launch screen on success, null on failure.
 */
export async function openApp(
  client: INomixClient,
  deviceId: string,
  appName: string,
  { retries = 1 }: { retries?: number } = {}
): Promise<Screen | null> {
  // Pre-check current state — saves a full Spotlight cycle when possible.
  const current = await parseScreen(client, deviceId);
  if (
    current &&
    current.appName.toLowerCase().includes(appName.toLowerCase())
  ) {
    return current;
  }
  if (current && current.appName === "App Library") {
    const viaLibrary = await openViaAppLibrary(
      client,
      deviceId,
      appName,
      current
    );
    if (viaLibrary) return viaLibrary;
    // Fall through to Spotlight if App Library search failed.
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Ensure clean state — Spotlight gesture only behaves consistently from
    // Home Screen across iOS versions / jailbreak tweaks.
    await goHome(client, deviceId);

    await client.swipe(deviceId, [16000, 10000], { down: 8000, duration: 300 });
    await sleep(500);

    // Spotlight remembers the previous search across invocations. Clear it
    // before typing or we end up with "DriveInstagram" etc.
    await clearKeyboardInput(client, deviceId);
    await client.type(deviceId, appName);
    await sleep(2000);

    const search = await parseScreen(client, deviceId);
    if (!search) continue;
    // Tap icon/button only — never the input field (which contains our query).
    const tapped = await search.findAndClick(client, deviceId, appName, {
      types: ["icon", "button"],
    });
    if (!tapped) continue;

    await sleep(3000);
    const opened = await parseScreen(client, deviceId);
    if (
      opened &&
      opened.appName.toLowerCase().includes(appName.toLowerCase())
    ) {
      return opened;
    }
  }
  return null;
}

/**
 * Launch an app from the iOS App Library screen by using its built-in search
 * bar at the top. Avoids the unreliable swipe-down-for-Spotlight gesture when
 * we're already in App Library.
 */
async function openViaAppLibrary(
  client: INomixClient,
  deviceId: string,
  appName: string,
  screen: Screen
): Promise<Screen | null> {
  // App Library has exactly one input element (the search bar). Find it
  // structurally instead of by label, so it works across iOS languages.
  const searchInput = screen.elements.find(
    (el) => el.type === "input" && el.interactivity
  );
  if (!searchInput) return null;

  await client.click(deviceId, searchInput.center);
  await sleep(800);
  // Clear any leftover query (App Library remembers last search like Spotlight).
  await clearKeyboardInput(client, deviceId);
  await client.type(deviceId, appName);
  await sleep(1500);

  const results = await parseScreen(client, deviceId);
  if (!results) return null;
  const tapped = await results.findAndClick(client, deviceId, appName, {
    types: ["icon", "button"],
  });
  if (!tapped) return null;

  await sleep(3000);
  const opened = await parseScreen(client, deviceId);
  if (
    opened &&
    opened.appName.toLowerCase().includes(appName.toLowerCase())
  ) {
    return opened;
  }
  return null;
}

async function doCloseApp(
  client: INomixClient,
  deviceId: string
): Promise<void> {
  await sleep(1000);
  // Slow swipe up from bottom edge -> app switcher
  await client.swipe(deviceId, [16384, 32767], { up: 4767, duration: 1000 });
  await sleep(5000);
  // Swipe up on the last app card to dismiss it
  await client.swipe(deviceId, [26500, 20000], { up: 10000, duration: 300 });
  await sleep(5000);
  // Tap home area to exit the app switcher
  await client.click(deviceId, [16384, 30000], 100);
}

/**
 * Open the app switcher, dismiss the last app, return to Home Screen.
 * Verifies the device actually reached Home; retries on failure.
 */
export async function closeApp(
  client: INomixClient,
  deviceId: string,
  { retries = 3 }: { retries?: number } = {}
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await doCloseApp(client, deviceId);
    await sleep(3000);
    const screen = await parseScreen(client, deviceId);
    if (!screen || screen.appName.toLowerCase() === "home screen") {
      return true;
    }
  }
  return false;
}
