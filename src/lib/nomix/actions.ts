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

/** Sleep a random duration to simulate human-like timing variance. */
export function randomSleep(minS = 0.3, maxS = 0.8): Promise<void> {
  const ms = (Math.random() * (maxS - minS) + minS) * 1000;
  return sleep(ms);
}

/** iOS swipe-back gesture (swipe right from left edge). */
export function swipeBack(client: INomixClient, deviceId: string): Promise<void> {
  return client.swipe(deviceId, [5000, 16000], { right: 20000, duration: 300 });
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
 * Open an app via iOS Spotlight search.
 *
 * Returns the post-launch screen on success, null on failure. NOTE:
 * defaults to a SINGLE attempt with no `closeApp` cleanup — when called
 * from a chunked workflow under cron, the next tick is the natural retry.
 * Multi-retry internally easily blows the Vercel 60s function budget
 * (each iteration is ~20-25s + closeApp recovery is ~13s).
 */
export async function openApp(
  client: INomixClient,
  deviceId: string,
  appName: string,
  { retries = 1 }: { retries?: number } = {}
): Promise<Screen | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Swipe down from middle-upper area to invoke Spotlight
    await client.swipe(deviceId, [16000, 10000], { down: 8000, duration: 300 });
    await sleep(500);

    await client.type(deviceId, appName);
    await sleep(2000);

    const search = await parseScreen(client, deviceId);
    if (!search || !(await search.findAndClick(client, deviceId, appName))) {
      continue;
    }

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
