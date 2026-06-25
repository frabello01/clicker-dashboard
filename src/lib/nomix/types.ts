/**
 * Type definitions for the NomixClicker REST API.
 * Reference: https://panel.nomixclicker.com/docs (and the official Python lib at
 * https://github.com/nomix-ai/ClickerScriptingLibrary).
 *
 * Coordinate system: HID absolute coordinates, 0–32767 on both axes.
 * Device-independent — the same coordinates work on any iPhone model.
 *   (0, 0)         = top-left
 *   (16383, 16383) = center
 *   (32767, 32767) = bottom-right
 */

export type Coords = [number, number];

/** Common result envelope returned by action endpoints (click/move/type/scroll). */
export type ApiResult = {
  success: boolean;
  message: string;
};

/**
 * GET /devices returns a bare array of device IDs (the dongles attached to
 * your Nomix account). To know if a device is online + connected you have
 * to call GET /{deviceId}/status per device.
 */
export type DeviceStatus = {
  device_id: string;
  connected: boolean;
  [k: string]: unknown;
};

export type ElementType =
  | "icon"
  | "button"
  | "text"
  | "input"
  | "image"
  | "toggle"
  | "tab"
  | "other";

export type LocationZone =
  | "status-bar"
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "navigation-bar";

/**
 * One UI element parsed from a screen by the vision API.
 * `bbox` is [y_min, x_min, y_max, x_max] in HID coords (their convention).
 * `center` is (x, y) in HID coords.
 */
export type ScreenElement = {
  idx: number;
  type: ElementType;
  content: string;
  interactivity: boolean;
  center: Coords;
  bbox: [number, number, number, number];
  location: LocationZone;
};

export type ScreenState = {
  app_name: string;
  description: string;
  elements: ScreenElement[];
  latency: number;
};

export type ScrollDirection = "up" | "down" | "left" | "right";

export type SwipeOptions = {
  up?: number;
  down?: number;
  left?: number;
  right?: number;
  duration?: number;
};
