import { describe, expect, it } from "vitest";
import { parseExcalidrawScene } from "./excalidrawScene";

const scene = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "a", type: "rectangle" }],
  appState: { viewBackgroundColor: "#fff" },
  files: {},
};

describe("parseExcalidrawScene", () => {
  it("reads a standard .excalidraw file as text or object", () => {
    const expected = { elements: scene.elements, appState: scene.appState, files: {} };
    expect(parseExcalidrawScene(JSON.stringify(scene))).toEqual(expected);
    expect(parseExcalidrawScene(scene)).toEqual(expected);
  });

  it("accepts nested data and stringified fields", () => {
    const nested = { data: { elements: JSON.stringify(scene.elements), appState: "{}" } };
    expect(parseExcalidrawScene(JSON.stringify(nested))).toEqual({
      elements: scene.elements,
      appState: {},
      files: {},
    });
  });

  it("rejects library files and malformed input", () => {
    expect(() => parseExcalidrawScene('{"type":"excalidrawlib"}')).toThrow(/Unsupported file type/);
    expect(() => parseExcalidrawScene("not json")).toThrow(/not valid JSON/);
    expect(() => parseExcalidrawScene([])).toThrow(/JSON object/);
    expect(() => parseExcalidrawScene('{"elements":{}}')).toThrow(/elements/);
  });
});
