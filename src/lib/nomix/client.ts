/**
 * NomixClicker REST client.
 *
 * Mirrors the Python `Clicker`/`Screen`/`Agent` classes from
 * https://github.com/nomix-ai/ClickerScriptingLibrary. Low-level methods map
 * 1:1 to REST endpoints; high-level helpers (`click`, `swipe`) compose them
 * the same way the Python lib does.
 */

import type {
  ApiResult,
  Coords,
  DeviceStatus,
  ScreenState,
  ScrollDirection,
  SwipeOptions,
} from "./types";

export class NomixError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
    this.name = "NomixError";
  }
}

export interface INomixClient {
  // Device management
  listDevices(): Promise<string[]>;
  getStatus(deviceId: string): Promise<DeviceStatus>;
  restart(deviceId: string): Promise<ApiResult>;

  // Low-level input (1:1 with REST)
  clickAt(deviceId: string, duration?: number): Promise<ApiResult>;
  move(
    deviceId: string,
    start: Coords,
    end: Coords,
    options?: { isPressed?: boolean; duration?: number }
  ): Promise<ApiResult>;
  type(deviceId: string, text: string): Promise<ApiResult>;
  scroll(
    deviceId: string,
    x: number,
    y: number,
    direction: ScrollDirection,
    distance?: number,
    duration?: number
  ): Promise<ApiResult>;
  screenState(deviceId: string): Promise<ScreenState>;

  // High-level helpers
  click(deviceId: string, coords: Coords, duration?: number): Promise<void>;
  swipe(deviceId: string, from: Coords, options: SwipeOptions): Promise<void>;
}

export class NomixClient implements INomixClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://panel.nomixclicker.com/clicker/v1"
  ) {
    if (!apiKey) {
      throw new Error("NomixClient: apiKey is required");
    }
  }

  private async req<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      // Each request is short — set a generous timeout via AbortController
      // upstream if needed. screen-state has 60s budget on their side.
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new NomixError(
        res.status,
        `Nomix ${init.method ?? "GET"} ${path} → ${res.status} ${res.statusText}`,
        body
      );
    }

    return (await res.json()) as T;
  }

  // ----- Device management -----

  listDevices(): Promise<string[]> {
    return this.req<string[]>("/devices");
  }

  getStatus(deviceId: string): Promise<DeviceStatus> {
    return this.req<DeviceStatus>(`/${deviceId}/status`);
  }

  restart(deviceId: string): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/restart`, { method: "POST" });
  }

  // ----- Low-level input -----

  clickAt(deviceId: string, duration = 100): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/click`, {
      method: "POST",
      body: JSON.stringify({ duration }),
    });
  }

  move(
    deviceId: string,
    start: Coords,
    end: Coords,
    options: { isPressed?: boolean; duration?: number } = {}
  ): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/move`, {
      method: "POST",
      body: JSON.stringify({
        start,
        end,
        is_pressed: options.isPressed ?? false,
        duration: options.duration ?? 300,
      }),
    });
  }

  type(deviceId: string, text: string): Promise<ApiResult> {
    if (text.length > 10000) {
      throw new Error("Nomix type(): text exceeds 10000 character limit");
    }
    return this.req<ApiResult>(`/${deviceId}/keyboard/type`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  scroll(
    deviceId: string,
    x: number,
    y: number,
    direction: ScrollDirection,
    distance = 300,
    duration = 500
  ): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/scroll`, {
      method: "POST",
      body: JSON.stringify({ x, y, direction, distance, duration }),
    });
  }

  screenState(deviceId: string): Promise<ScreenState> {
    return this.req<ScreenState>(`/${deviceId}/screen-state`, {
      method: "POST",
    });
  }

  // ----- High-level helpers -----

  /**
   * Tap at the given HID coordinates. Internally does a move-to + click.
   * `duration` is the hold time in ms.
   */
  async click(deviceId: string, coords: Coords, duration = 100): Promise<void> {
    await this.move(deviceId, coords, coords);
    await this.clickAt(deviceId, duration);
  }

  /**
   * Swipe from `from` in the given direction(s). Distance in HID units.
   * Matches the Python helper: positive `down`/`right` increase the axis;
   * `up`/`left` decrease it. Multiple axes can be combined (diagonal swipe).
   */
  async swipe(
    deviceId: string,
    from: Coords,
    options: SwipeOptions
  ): Promise<void> {
    const [x, y] = from;
    const dx = (options.right ?? 0) - (options.left ?? 0);
    const dy = (options.down ?? 0) - (options.up ?? 0);
    const to: Coords = [x + dx, y + dy];
    await this.move(deviceId, from, to, {
      isPressed: true,
      duration: options.duration ?? 300,
    });
  }
}
