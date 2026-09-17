import { useEffect } from "react";
import { attachCanvasZoomForwarding } from "./canvasZoomForwarding";

interface UseCanvasScrollToZoomArgs {
  containerRef: React.RefObject<HTMLElement>;
  enabled: boolean;
}

/**
 * Applies the user's "scroll wheel zooms" preference to the canvas. When it is
 * off, Excalidraw's own wheel handling stays in place (wheel pans, shift+wheel
 * pans horizontally, ctrl/cmd+wheel zooms); when it is on, plain wheel events
 * are forwarded as zoom instead.
 */
export const useCanvasScrollToZoom = ({
  containerRef,
  enabled,
}: UseCanvasScrollToZoomArgs): void => {
  useEffect(() => {
    if (!enabled) return;
    return attachCanvasZoomForwarding(containerRef.current);
  }, [containerRef, enabled]);
};
