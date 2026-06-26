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

function isHomeScreen(screen: Screen | null): boolean {
  if (!screen) return false;
  const app = screen.appName.toLowerCase();
  return app.includes("home") || app === "springboard";
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
  if (current && isInApp(current, appName)) {
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

    const opened = await waitForApp(client, deviceId, appName);
    if (opened) return opened;
  }
  return null;
}

/** Match an app by name across app_name OR screen_description — vision
 *  sometimes reports a generic app_name during transitions but the description
 *  still mentions the app. */
function isInApp(screen: Screen, appName: string): boolean {
  const needle = appName.toLowerCase();
  if (screen.appName.toLowerCase().includes(needle)) return true;
  if (screen.description.toLowerCase().includes(needle)) return true;
  return false;
}

/** After tapping an app icon, the app may take 3-8s to render. Poll briefly. */
async function waitForApp(
  client: INomixClient,
  deviceId: string,
  appName: string,
  { totalTimeoutMs = 10_000, intervalMs = 2000 }: { totalTimeoutMs?: number; intervalMs?: number } = {}
): Promise<Screen | null> {
  const deadline = Date.now() + totalTimeoutMs;
  // First poll after a brief initial wait (covers the standard launch animation).
  await sleep(2500);
  while (Date.now() < deadline) {
    const screen = await parseScreen(client, deviceId);
    if (screen && isInApp(screen, appName)) return screen;
    if (Date.now() + intervalMs >= deadline) break;
    await sleep(intervalMs);
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

  return waitForApp(client, deviceId, appName);
}

/**
 * "Close" the foreground app (puts it in background; phone shows Home Screen).
 *
 * Tries the home gesture, verifies via parseScreen, retries with a stronger
 * variant if needed. Important inside Reels/TikTok-style feeds where a normal
 * upward swipe can be misinterpreted as "next item" instead of the home
 * gesture.
 */
export async function closeApp(
  client: INomixClient,
  deviceId: string,
  { attempts = 3 }: { attempts?: number } = {}
): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    await goHome(client, deviceId);
    await sleep(1500);
    let screen = await parseScreen(client, deviceId);
    if (isHomeScreen(screen)) return true;

    // Stronger fallback: longer flick starting closer to the very bottom edge.
    await client.swipe(deviceId, [16384, 32700], {
      up: 25000,
      duration: 200,
    });
    await sleep(1500);
    screen = await parseScreen(client, deviceId);
    if (isHomeScreen(screen)) return true;
  }
  return false;
}
