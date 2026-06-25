/**
 * Mock NomixClicker client — returns canned responses, useful before the
 * dongle ships. Toggle via NOMIX_USE_MOCK=true. Calls are logged to stdout
 * so you can confirm the orchestration code is firing what you expect.
 */

import type {
  ApiResult,
  Coords,
  DeviceStatus,
  ScreenElement,
  ScreenState,
  ScrollDirection,
  SwipeOptions,
} from "./types";
import type { INomixClient } from "./client";

const ok = (msg = "mock ok"): ApiResult => ({ success: true, message: msg });

const MOCK_DEVICE_IDS = ["mock-iphone-x-01", "mock-iphone-x-02"] as const;
const MOCK_DEVICE_CONNECTED: Record<string, boolean> = {
  "mock-iphone-x-01": true,
  "mock-iphone-x-02": false,
};

const MOCK_REELS_SCREEN: ScreenState = {
  app_name: "Instagram",
  description:
    "Instagram Reels feed. A short video is playing, with like/comment/share buttons on the right edge.",
  latency: 1.2,
  elements: [
    {
      idx: 0,
      type: "icon",
      content: "like",
      interactivity: true,
      center: [30000, 18000],
      bbox: [17000, 29000, 19000, 31000],
      location: "bottom-right",
    },
    {
      idx: 1,
      type: "icon",
      content: "comment",
      interactivity: true,
      center: [30000, 21000],
      bbox: [20000, 29000, 22000, 31000],
      location: "bottom-right",
    },
    {
      idx: 2,
      type: "icon",
      content: "share",
      interactivity: true,
      center: [30000, 24000],
      bbox: [23000, 29000, 25000, 31000],
      location: "bottom-right",
    },
    {
      idx: 3,
      type: "text",
      content: "@example_account",
      interactivity: true,
      center: [8000, 27000],
      bbox: [26000, 1000, 28000, 15000],
      location: "bottom-left",
    },
  ],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockNomixClient implements INomixClient {
  private log(label: string, payload?: unknown) {
    // eslint-disable-next-line no-console
    console.log(`[nomix:mock] ${label}`, payload ?? "");
  }

  async listDevices(): Promise<string[]> {
    this.log("listDevices");
    return [...MOCK_DEVICE_IDS];
  }

  async getStatus(deviceId: string): Promise<DeviceStatus> {
    this.log("getStatus", { deviceId });
    return {
      device_id: deviceId,
      connected: MOCK_DEVICE_CONNECTED[deviceId] ?? false,
    };
  }

  async restart(deviceId: string): Promise<ApiResult> {
    this.log("restart", { deviceId });
    await sleep(200);
    return ok("restart queued");
  }

  async clickAt(deviceId: string, duration = 100): Promise<ApiResult> {
    this.log("clickAt", { deviceId, duration });
    await sleep(50);
    return ok();
  }

  async move(
    deviceId: string,
    start: Coords,
    end: Coords,
    options: { isPressed?: boolean; duration?: number } = {}
  ): Promise<ApiResult> {
    this.log("move", { deviceId, start, end, ...options });
    await sleep(options.duration ?? 100);
    return ok();
  }

  async type(deviceId: string, text: string): Promise<ApiResult> {
    this.log("type", { deviceId, length: text.length });
    await sleep(text.length * 5);
    return ok();
  }

  async scroll(
    deviceId: string,
    x: number,
    y: number,
    direction: ScrollDirection,
    distance = 300,
    duration = 500
  ): Promise<ApiResult> {
    this.log("scroll", { deviceId, x, y, direction, distance, duration });
    await sleep(duration);
    return ok();
  }

  async screenState(deviceId: string): Promise<ScreenState> {
    this.log("screenState", { deviceId });
    await sleep(800);
    return MOCK_REELS_SCREEN;
  }

  async click(deviceId: string, coords: Coords, duration = 100): Promise<void> {
    await this.move(deviceId, coords, coords);
    await this.clickAt(deviceId, duration);
  }

  async swipe(
    deviceId: string,
    from: Coords,
    options: SwipeOptions
  ): Promise<void> {
    const [x, y] = from;
    const dx = (options.right ?? 0) - (options.left ?? 0);
    const dy = (options.down ?? 0) - (options.up ?? 0);
    await this.move(deviceId, from, [x + dx, y + dy], {
      isPressed: true,
      duration: options.duration ?? 300,
    });
  }
}

// Re-export the unused-locally type so other files can import from one place.
export type { ScreenElement };
