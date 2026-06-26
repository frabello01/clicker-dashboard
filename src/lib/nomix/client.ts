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

export type AgentTask = {
  task_id: string;
  device_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  task: string;
  result: string | null;
  steps_completed: number;
};

export interface INomixClient {
  // Device management
  listDevices(): Promise<string[]>;
  getStatus(deviceId: string): Promise<DeviceStatus>;
  restart(deviceId: string): Promise<ApiResult>;

  // Autonomous AI agent — navigates the phone from a natural-language task.
  // Robust for "open app X" / "go to the Reels tab" where coordinate-based
  // automation is brittle. One task per device at a time.
  agentRun(deviceId: string, task: string): Promise<AgentTask>;
  agentStatus(deviceId: string, taskId: string): Promise<AgentTask>;
  /** Run + poll to completion. Returns the final task (or last polled state
   *  on timeout). */
  agentRunToCompletion(
    deviceId: string,
    task: string,
    opts?: { pollMs?: number; timeoutMs?: number }
  ): Promise<AgentTask>;

  // Low-level input (1:1 with REST)
  clickAt(deviceId: string, duration?: number): Promise<ApiResult>;
  tap(
    deviceId: string,
    coords: Coords,
    duration?: number
  ): Promise<ApiResult>;
  move(
    deviceId: string,
    start: Coords,
    end: Coords,
    options?: { isPressed?: boolean; duration?: number }
  ): Promise<ApiResult>;
  type(deviceId: string, text: string, delayMs?: number): Promise<ApiResult>;
  combo(deviceId: string, codes: string[]): Promise<ApiResult>;
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

  // ----- Autonomous AI agent -----

  agentRun(deviceId: string, task: string): Promise<AgentTask> {
    return this.req<AgentTask>(`/${deviceId}/agent/run`, {
      method: "POST",
      body: JSON.stringify({ task }),
    });
  }

  agentStatus(deviceId: string, taskId: string): Promise<AgentTask> {
    return this.req<AgentTask>(`/${deviceId}/agent/${taskId}`);
  }

  async agentRunToCompletion(
    deviceId: string,
    task: string,
    { pollMs = 5000, timeoutMs = 180_000 }: { pollMs?: number; timeoutMs?: number } = {}
  ): Promise<AgentTask> {
    const started = await this.agentRun(deviceId, task);
    const deadline = Date.now() + timeoutMs;
    let last = started;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        last = await this.agentStatus(deviceId, started.task_id);
      } catch {
        continue; // transient — keep polling
      }
      if (
        last.status === "completed" ||
        last.status === "failed" ||
        last.status === "cancelled"
      ) {
        return last;
      }
    }
    return last;
  }

  // ----- Low-level input -----

  clickAt(deviceId: string, duration = 100): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/click`, {
      method: "POST",
      body: JSON.stringify({ duration }),
    });
  }

  /**
   * Atomic single tap at HID coords — preferred over move+click for taps:
   * one API round-trip instead of two, and doesn't depend on cursor state.
   */
  tap(deviceId: string, coords: Coords, duration = 100): Promise<ApiResult> {
    const [left, top] = coords;
    return this.req<ApiResult>(`/${deviceId}/tap`, {
      method: "POST",
      body: JSON.stringify({ left, top, duration }),
    });
  }

  move(
    deviceId: string,
    start: Coords,
    end: Coords,
    options: { isPressed?: boolean; duration?: number } = {}
  ): Promise<ApiResult> {
    const [startX, startY] = start;
    const [endX, endY] = end;
    return this.req<ApiResult>(`/${deviceId}/move`, {
      method: "POST",
      body: JSON.stringify({
        start_left: startX,
        start_top: startY,
        end_left: endX,
        end_top: endY,
        is_pressed: options.isPressed ?? false,
        duration: options.duration ?? 300,
      }),
    });
  }

  /**
   * Press a key combo (e.g. ["Backspace"] or ["MetaLeft", "Space"]).
   * Maps to POST /{id}/keyboard/combo. Codes use the W3C UI Events KeyboardEvent.code values.
   */
  combo(deviceId: string, codes: string[]): Promise<ApiResult> {
    return this.req<ApiResult>(`/${deviceId}/keyboard/combo`, {
      method: "POST",
      body: JSON.stringify({ codes }),
    });
  }

  type(deviceId: string, text: string, delayMs = 0): Promise<ApiResult> {
    if (text.length === 0 || text.length > 10000) {
      throw new Error(
        "Nomix type(): text length must be 1..10000 chars (per spec)"
      );
    }
    return this.req<ApiResult>(`/${deviceId}/keyboard/type`, {
      method: "POST",
      body: JSON.stringify({ text, delay: delayMs }),
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
      body: JSON.stringify({
        left: x,
        top: y,
        direction,
        distance,
        duration,
      }),
    });
  }

  screenState(deviceId: string): Promise<ScreenState> {
    return this.req<ScreenState>(`/${deviceId}/screen-state`, {
      method: "POST",
    });
  }

  // ----- High-level helpers -----

  /**
   * Tap at the given HID coordinates. Uses the dedicated `/tap` endpoint
   * (one API call, atomic). `duration` is the hold time in ms.
   */
  async click(deviceId: string, coords: Coords, duration = 100): Promise<void> {
    await this.tap(deviceId, coords, duration);
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
