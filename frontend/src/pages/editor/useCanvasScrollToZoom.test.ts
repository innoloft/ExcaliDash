import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasScrollToZoom } from "./useCanvasScrollToZoom";

let container: HTMLDivElement;
let canvas: HTMLCanvasElement;

/** Wheel events seen by the canvas, in dispatch order. */
const seen: WheelEvent[] = [];
const record = (event: Event) => {
  seen.push(event as WheelEvent);
};

const wheel = (init: WheelEventInit) =>
  canvas.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }),
  );

beforeEach(() => {
  seen.length = 0;
  container = document.createElement("div");
  canvas = document.createElement("canvas");
  container.appendChild(canvas);
  document.body.appendChild(container);
  canvas.addEventListener("wheel", record);
});

afterEach(() => {
  container.remove();
});

describe("useCanvasScrollToZoom", () => {
  it("leaves plain wheel events alone when the preference is off", () => {
    renderHook(() =>
      useCanvasScrollToZoom({ containerRef: { current: container }, enabled: false }),
    );
    wheel({ deltaY: 120 });
    expect(seen).toHaveLength(1);
    expect(seen[0].ctrlKey).toBe(false);
    expect(seen[0].defaultPrevented).toBe(false);
  });

  it("re-dispatches a plain wheel as ctrl+wheel when the preference is on", () => {
    renderHook(() =>
      useCanvasScrollToZoom({ containerRef: { current: container }, enabled: true }),
    );
    wheel({ deltaY: 120 });
    const zoomEvents = seen.filter((event) => event.ctrlKey);
    expect(zoomEvents).toHaveLength(1);
    expect(zoomEvents[0].deltaY).toBe(120);
  });

  it("does not touch ctrl/cmd+wheel, which already zooms", () => {
    renderHook(() =>
      useCanvasScrollToZoom({ containerRef: { current: container }, enabled: true }),
    );
    wheel({ deltaY: 120, metaKey: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].defaultPrevented).toBe(false);
  });

  it("detaches when the preference is turned off", () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useCanvasScrollToZoom({ containerRef: { current: container }, enabled }),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    seen.length = 0;
    wheel({ deltaY: 120 });
    expect(seen).toHaveLength(1);
    expect(seen[0].ctrlKey).toBe(false);
  });
});
