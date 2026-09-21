import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mock thinking-orbs — its canvas/IntersectionObserver rendering has no
// jsdom equivalent.
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: () => null,
}));

/**
 * jsdom has no PointerEvent, and React's synthetic pointer handlers read
 * `clientX`/`clientY`/`pointerId` off it. Without this shim those arrive as
 * `null`, so any drag/swipe code computes NaN and cannot be unit-tested.
 *
 * A MouseEvent subclass carries the coordinates; the pointer-specific fields
 * are copied across manually.
 */
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    width: number;
    height: number;
    pressure: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0.5;
    }
  }
  // @ts-expect-error assigning a shim over jsdom's missing implementation
  window.PointerEvent = PointerEventShim;
}

afterEach(() => {
  cleanup();
});
