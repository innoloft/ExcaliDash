/**
 * Conversions between Excalidraw scene coordinates (what we persist for a
 * comment pin) and pixel offsets inside the canvas container (where the pin
 * overlay is drawn).
 *
 * The overlay sits absolutely inside the same element Excalidraw renders into,
 * so its top-left corner is the canvas origin. That makes the canvas's own page
 * offset (`appState.offsetLeft`/`offsetTop`) irrelevant here: only scroll and
 * zoom matter, exactly as in Excalidraw's own `sceneCoordsToViewportCoords`.
 */
export type CanvasViewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

export type Point = { x: number; y: number };

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
};

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Pull the scroll/zoom triple out of an Excalidraw app state defensively. */
export const readCanvasViewport = (appState: unknown): CanvasViewport => {
  const state = (appState ?? {}) as Record<string, unknown>;
  const rawZoom = state.zoom as { value?: unknown } | number | undefined;
  const zoomValue =
    typeof rawZoom === "number" ? rawZoom : (rawZoom?.value as unknown);
  const zoom = toFiniteNumber(zoomValue, 1);
  return {
    scrollX: toFiniteNumber(state.scrollX, 0),
    scrollY: toFiniteNumber(state.scrollY, 0),
    // A zero or negative zoom would collapse every pin onto the origin.
    zoom: zoom > 0 ? zoom : 1,
  };
};

export const sceneToCanvasPoint = (
  point: Point,
  viewport: CanvasViewport,
): Point => ({
  x: (point.x + viewport.scrollX) * viewport.zoom,
  y: (point.y + viewport.scrollY) * viewport.zoom,
});

export const canvasPointToScene = (
  point: Point,
  viewport: CanvasViewport,
): Point => ({
  x: point.x / viewport.zoom - viewport.scrollX,
  y: point.y / viewport.zoom - viewport.scrollY,
});

export const viewportsEqual = (
  a: CanvasViewport,
  b: CanvasViewport,
): boolean =>
  a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.zoom === b.zoom;
