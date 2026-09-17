import { describe, expect, it } from "vitest";
import {
  canvasPointToScene,
  readCanvasViewport,
  sceneToCanvasPoint,
  viewportsEqual,
} from "../canvasCoords";

describe("canvasCoords", () => {
  it("places a scene point using scroll and zoom", () => {
    const viewport = { scrollX: 100, scrollY: -50, zoom: 2 };
    expect(sceneToCanvasPoint({ x: 10, y: 60 }, viewport)).toEqual({
      x: 220,
      y: 20,
    });
  });

  it("round-trips scene -> canvas -> scene", () => {
    const viewport = { scrollX: -37.5, scrollY: 12.25, zoom: 0.75 };
    const scene = { x: 412.5, y: -98.25 };
    const back = canvasPointToScene(sceneToCanvasPoint(scene, viewport), viewport);
    expect(back.x).toBeCloseTo(scene.x, 6);
    expect(back.y).toBeCloseTo(scene.y, 6);
  });

  it("reads Excalidraw app state and falls back for missing values", () => {
    expect(
      readCanvasViewport({ scrollX: 5, scrollY: 6, zoom: { value: 1.5 } }),
    ).toEqual({ scrollX: 5, scrollY: 6, zoom: 1.5 });
    expect(readCanvasViewport(undefined)).toEqual({
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
    });
  });

  it("never returns a zoom that would collapse pins onto the origin", () => {
    expect(readCanvasViewport({ zoom: { value: 0 } }).zoom).toBe(1);
    expect(readCanvasViewport({ zoom: { value: Number.NaN } }).zoom).toBe(1);
    expect(readCanvasViewport({ zoom: -2 }).zoom).toBe(1);
  });

  it("compares viewports field by field", () => {
    const base = { scrollX: 1, scrollY: 2, zoom: 3 };
    expect(viewportsEqual(base, { ...base })).toBe(true);
    expect(viewportsEqual(base, { ...base, zoom: 3.0001 })).toBe(false);
  });
});
