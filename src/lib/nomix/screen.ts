/**
 * Screen — wraps a ScreenState snapshot with the query helpers the Python
 * `Screen` class exposes (find / findAndClick / contains). Mirrors
 * utils/recognition.py from nomix-ai/ClickerScriptingLibrary.
 *
 * Fetch a Screen with `parseScreen(client, deviceId)`; reuse it across
 * multiple `.find()` / `.contains()` calls instead of re-parsing.
 */

import type { INomixClient } from "./client";
import type { Coords, ScreenElement, ScreenState } from "./types";

export class Screen {
  constructor(public readonly state: ScreenState) {}

  get appName(): string {
    return this.state.app_name;
  }
  get description(): string {
    return this.state.description;
  }
  get elements(): ScreenElement[] {
    return this.state.elements;
  }
  get latency(): number {
    return this.state.latency;
  }

  /**
   * First element whose content contains any keyword (case-insensitive substring).
   * Returns center coords or null. Defaults to interactive-only matches.
   */
  find(
    keywords: string | string[],
    opts: { interactiveOnly?: boolean } = {}
  ): Coords | null {
    const kws = (Array.isArray(keywords) ? keywords : [keywords]).map((k) =>
      k.toLowerCase()
    );
    const interactiveOnly = opts.interactiveOnly ?? true;
    for (const kw of kws) {
      for (const el of this.state.elements) {
        if (!el.content) continue;
        if (!el.content.toLowerCase().includes(kw)) continue;
        if (interactiveOnly && !el.interactivity) continue;
        return el.center;
      }
    }
    return null;
  }

  /** Find by keywords and click. Returns true if found and clicked. */
  async findAndClick(
    client: INomixClient,
    deviceId: string,
    keywords: string | string[],
    opts: { interactiveOnly?: boolean } = {}
  ): Promise<boolean> {
    const coords = this.find(keywords, opts);
    if (!coords) return false;
    await client.click(deviceId, coords);
    return true;
  }

  /** True if any keyword appears in the description or any element content. */
  contains(keywords: string | string[]): boolean {
    const kws = (Array.isArray(keywords) ? keywords : [keywords]).map((k) =>
      k.toLowerCase()
    );
    const desc = this.state.description.toLowerCase();
    for (const kw of kws) {
      if (desc.includes(kw)) return true;
      if (
        this.state.elements.some(
          (e) => e.content && e.content.toLowerCase().includes(kw)
        )
      )
        return true;
    }
    return false;
  }
}

/**
 * Capture current screen with retry. Returns null after `retries` failures —
 * callers check `if (!screen)` rather than wrapping in try/catch (per the
 * Nomix scripting convention).
 */
export async function parseScreen(
  client: INomixClient,
  deviceId: string,
  { retries = 3, retryDelayMs = 3000 }: { retries?: number; retryDelayMs?: number } = {}
): Promise<Screen | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const state = await client.screenState(deviceId);
      return new Screen(state);
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      console.error(
        `parseScreen(${deviceId}) failed after ${retries} attempts:`,
        e
      );
    }
  }
  return null;
}
