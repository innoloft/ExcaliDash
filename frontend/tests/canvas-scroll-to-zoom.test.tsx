import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasScrollToZoom } from "../src/pages/editor/useCanvasScrollToZoom";
import { renderHook } from "./renderHook";

// The node environment has no DOM, so the container only records the wheel
// listener it is given and the tests call it with hand-built events.
class FakeWheelEvent extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    const { bubbles, cancelable, ...wheelInit } = init;
    super(type, { bubbles: Boolean(bubbles), cancelable: Boolean(cancelable) });
    Object.assign(this, wheelInit);
  }
}

type WheelHandler = (event: Partial<WheelEvent>) => void;

let listeners: Map<WheelHandler, unknown>;
let container: {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const makeTarget = (overUi = false) => ({
  tagName: "CANVAS",
  closest: vi.fn(() => (overUi ? {} : null)),
  dispatchEvent: vi.fn(),
});

const makeWheel = (
  target: ReturnType<typeof makeTarget>,
  init: Partial<WheelEvent> = {},
) => ({
  target,
  deltaX: 0,
  deltaY: 120,
  deltaMode: 0,
  clientX: 10,
  clientY: 20,
  ctrlKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...init,
});

const fireWheel = (event: Partial<WheelEvent>) => {
  for (const listener of listeners.keys()) listener(event);
};

const mount = (enabled: boolean) =>
  renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useCanvasScrollToZoom({
        containerRef: { current: container as unknown as HTMLElement },
        enabled,
      }),
    { enabled },
  );

beforeEach(() => {
  listeners = new Map();
  container = {
    addEventListener: vi.fn((_type: string, listener: WheelHandler, options) =>
      listeners.set(listener, options),
    ),
    removeEventListener: vi.fn((_type: string, listener: WheelHandler) =>
      listeners.delete(listener),
    ),
  };
  vi.stubGlobal("WheelEvent", FakeWheelEvent);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCanvasScrollToZoom", () => {
  it("leaves Excalidraw's wheel handling alone when the preference is off", async () => {
    await mount(false);
    expect(container.addEventListener).not.toHaveBeenCalled();
  });

  it("re-dispatches a plain wheel over the canvas as ctrl+wheel", async () => {
    await mount(true);
    const target = makeTarget();
    const event = makeWheel(target);
    fireWheel(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(target.dispatchEvent).toHaveBeenCalledOnce();
    const zoom = target.dispatchEvent.mock.calls[0][0];
    expect(zoom).toMatchObject({ ctrlKey: true, deltaY: 120, clientX: 10 });
    expect(zoom._isFakeZoom).toBe(true);
  });

  it("does not touch ctrl/cmd+wheel, which already zooms", async () => {
    await mount(true);
    const target = makeTarget();
    const event = makeWheel(target, { metaKey: true });
    fireWheel(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(target.dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not hijack wheel events over the editor UI", async () => {
    await mount(true);
    const target = makeTarget(true);
    const event = makeWheel(target);
    fireWheel(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(target.dispatchEvent).not.toHaveBeenCalled();
  });

  it("detaches when the preference is turned off", async () => {
    const { rerender } = await mount(true);
    expect(listeners.size).toBe(1);
    await rerender({ enabled: false });
    expect(container.removeEventListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
