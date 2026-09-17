import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  DEFAULT_CANVAS_VIEWPORT,
  readCanvasViewport,
  viewportsEqual,
  type CanvasViewport,
} from "../../utils/canvasCoords";

/**
 * Track the canvas scroll/zoom so overlay markers stay glued to their scene
 * position while the user pans and zooms.
 *
 * Excalidraw's `onChange` is debounced and does not fire for every pan frame,
 * so the overlay would visibly lag behind the canvas. Polling the app state on
 * each animation frame and re-rendering only when the triple actually changed
 * keeps the markers in lockstep at no cost while the canvas sits still.
 */
export const useCanvasViewport = (
  excalidrawAPI: MutableRefObject<any>,
  enabled: boolean,
): CanvasViewport => {
  const [viewport, setViewport] = useState<CanvasViewport>(
    DEFAULT_CANVAS_VIEWPORT,
  );
  const latestRef = useRef<CanvasViewport>(viewport);

  useEffect(() => {
    if (!enabled) return;
    let frameId = 0;
    const tick = () => {
      const api = excalidrawAPI.current;
      if (api && typeof api.getAppState === "function") {
        const next = readCanvasViewport(api.getAppState());
        if (!viewportsEqual(next, latestRef.current)) {
          latestRef.current = next;
          setViewport(next);
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [enabled, excalidrawAPI]);

  return viewport;
};
