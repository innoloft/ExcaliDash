import { describe, expect, it, vi } from "vitest";
import {
  ExcaliDashApiError,
  type Collection,
  type DrawingSummary,
  type ExcaliDashApi,
} from "./apiClient";
import {
  addDrawing,
  drawingIdFromRef,
  getDrawing,
  mergeElements,
  replaceDrawing,
  resolveCollection,
  summarizeElements,
  upsertElements,
} from "./operations";

const content = JSON.stringify({
  type: "excalidraw",
  elements: [{ id: "a" }],
  appState: {},
});
const APP = "https://exd.example";

const summary = (overrides: Partial<DrawingSummary> = {}): DrawingSummary => ({
  id: "d1",
  name: "Drawing",
  collectionId: null,
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const fakeApi = (
  collections: Collection[] = [],
  drawings: DrawingSummary[] = [],
  elements: unknown[] = [],
) => {
  const api = {
    listCollections: vi.fn(async () => collections),
    createCollection: vi.fn(async (name: string) => ({
      id: "new",
      name,
      isOwner: true,
      sharedRole: null,
    })),
    listDrawings: vi.fn(async () => drawings),
    createDrawing: vi.fn(async (input) =>
      summary({ name: input.name, collectionId: input.collectionId }),
    ),
    replaceDrawing: vi.fn(async (id: string, input) =>
      summary({ id, name: input.name ?? "Drawing" }),
    ),
    getDrawing: vi.fn(async (id: string) => ({
      ...summary({ id, version: 4 }),
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    })),
    updateElements: vi.fn(async (id: string, _elements, version: number) =>
      summary({ id, version: version + 1 }),
    ),
  } satisfies ExcaliDashApi;
  return api;
};

const col = (id: string, name: string, isOwner = true): Collection => ({
  id,
  name,
  isOwner,
  sharedRole: null,
});

describe("resolveCollection", () => {
  const collections = [
    col("trash", "Trash"),
    col("c1", "Architecture"),
    col("c2", "Ideas"),
  ];

  it("matches by id, then case-insensitive name", async () => {
    const api = fakeApi(collections);
    expect((await resolveCollection(api, "c2")).collection.id).toBe("c2");
    expect((await resolveCollection(api, "architecture")).collection.id).toBe(
      "c1",
    );
  });

  it("never resolves to the trash", async () => {
    await expect(
      resolveCollection(fakeApi(collections), "trash"),
    ).rejects.toThrow(/not found/);
  });

  it("creates only when asked", async () => {
    const api = fakeApi(collections);
    await expect(resolveCollection(api, "Roadmap")).rejects.toThrow(
      /createCollectionIfMissing/,
    );
    const result = await resolveCollection(api, "Roadmap", {
      createIfMissing: true,
    });
    expect(result).toMatchObject({
      created: true,
      collection: { id: "new", name: "Roadmap" },
    });
  });

  it("refuses ambiguous names", async () => {
    const api = fakeApi([col("c1", "Shared"), col("c9", "shared", false)]);
    await expect(resolveCollection(api, "Shared")).rejects.toThrow(
      /ambiguous.*c1.*c9 \(shared\)/,
    );
  });
});

describe("addDrawing", () => {
  it("stores the drawing in the resolved collection", async () => {
    const api = fakeApi([col("c1", "Architecture")]);
    const result = await addDrawing(api, APP, {
      content,
      name: "Flow",
      collection: "Architecture",
    });
    expect(api.createDrawing).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Flow",
        collectionId: "c1",
        elements: [{ id: "a" }],
      }),
    );
    expect(result).toMatchObject({
      collectionName: "Architecture",
      url: `${APP}/editor/d1`,
    });
  });

  it("stores without a collection by default", async () => {
    const api = fakeApi();
    await addDrawing(api, APP, { content });
    expect(api.createDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Untitled Drawing", collectionId: null }),
    );
    expect(api.listCollections).not.toHaveBeenCalled();
  });
});

describe("replaceDrawing", () => {
  it("replaces by id without renaming", async () => {
    const api = fakeApi();
    await replaceDrawing(api, APP, { drawingId: "d7", content });
    expect(api.replaceDrawing).toHaveBeenCalledWith(
      "d7",
      expect.not.objectContaining({ name: expect.anything() }),
    );
  });

  it("looks up by exact name within a collection", async () => {
    const api = fakeApi(
      [col("c1", "Architecture")],
      [
        summary({ id: "d2", name: "Flow v2" }),
        summary({ id: "d3", name: "Flow" }),
      ],
    );
    await replaceDrawing(api, APP, {
      name: "Flow",
      collection: "Architecture",
      content,
      rename: "Flow (final)",
    });
    expect(api.listDrawings).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "c1", search: "Flow" }),
    );
    expect(api.replaceDrawing).toHaveBeenCalledWith(
      "d3",
      expect.objectContaining({ name: "Flow (final)" }),
    );
  });

  it("refuses ambiguous or missing names", async () => {
    const twins = fakeApi(
      [],
      [
        summary({ id: "d2", name: "Flow" }),
        summary({ id: "d3", name: "Flow" }),
      ],
    );
    await expect(
      replaceDrawing(twins, APP, { name: "Flow", content }),
    ).rejects.toThrow(/Several.*d2.*d3/);
    await expect(
      replaceDrawing(fakeApi(), APP, { name: "Flow", content }),
    ).rejects.toThrow(/No drawing named/);
  });

  it("validates the file before contacting the server", async () => {
    const api = fakeApi();
    await expect(
      replaceDrawing(api, APP, { name: "Flow", content: "{" }),
    ).rejects.toThrow(/JSON/);
    expect(api.listDrawings).not.toHaveBeenCalled();
    await expect(replaceDrawing(api, APP, { content })).rejects.toThrow(
      /drawingId.*name/,
    );
  });
});

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 10.4,
  y: 20.6,
  width: 200,
  height: 80,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  version: 3,
  isDeleted: false,
  ...extra,
});

const boundText = (id: string, containerId: string, text: string) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 50,
  height: 20,
  text,
  originalText: text,
  fontSize: 16,
  fontFamily: 2,
  containerId,
  version: 2,
  isDeleted: false,
});

describe("drawingIdFromRef", () => {
  it("takes an id or a drawing URL", () => {
    expect(drawingIdFromRef(" d1 ")).toBe("d1");
    expect(drawingIdFromRef(`${APP}/editor/d1?x=1#y`)).toBe("d1");
  });
});

describe("summarizeElements", () => {
  it("folds bound text into its container and drops defaults and deleted elements", () => {
    const result = summarizeElements([
      rect("box", { backgroundColor: "#a5d8ff", link: "https://x" }),
      boundText("box-label", "box", "Hello"),
      rect("gone", { isDeleted: true }),
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100.2, 0],
        ],
        startBinding: { elementId: "box", focus: 0, gap: 4 },
      },
    ]);
    expect(result).toEqual([
      {
        id: "box",
        type: "rectangle",
        x: 10,
        y: 21,
        width: 200,
        height: 80,
        label: { text: "Hello", fontSize: 16, fontFamily: 2 },
        backgroundColor: "#a5d8ff",
        link: "https://x",
      },
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        startBinding: { elementId: "box" },
      },
    ]);
  });
});

describe("getDrawing", () => {
  const elements = [rect("a"), rect("b"), rect("c")];

  it("pages through the elements", async () => {
    const api = fakeApi([], [], elements);
    const first = await getDrawing(api, APP, { drawingId: "d1", limit: 2 });
    expect(first).toMatchObject({
      url: `${APP}/editor/d1`,
      format: "summary",
      total: 3,
      returned: 2,
      nextOffset: 2,
    });
    const last = await getDrawing(api, APP, {
      drawingId: "d1",
      offset: 2,
      limit: 2,
    });
    expect(last.elements.map((e) => e.id)).toEqual(["c"]);
    expect(last.nextOffset).toBeNull();
  });

  it("returns appState and files with the first page of the file only", async () => {
    const api = fakeApi([], [], elements);
    const first = await getDrawing(api, APP, {
      drawingId: "d1",
      format: "file",
    });
    expect(first.elements[0]).toEqual(elements[0]);
    expect(first).toHaveProperty("appState.viewBackgroundColor", "#ffffff");
    const later = await getDrawing(api, APP, {
      drawingId: "d1",
      format: "file",
      offset: 1,
    });
    expect(later).not.toHaveProperty("appState");
  });
});

describe("mergeElements", () => {
  it("replaces in place, appends new ids and bumps versions", () => {
    const result = mergeElements(
      [rect("a"), rect("b")],
      [rect("c"), rect("a", { width: 999, version: 1 })],
    );
    expect(result.elements.map((e: any) => e.id)).toEqual(["a", "b", "c"]);
    expect(result.elements[0]).toMatchObject({ width: 999, version: 4 });
    expect(result).toMatchObject({ added: 1, updated: 1, deleted: 0 });
  });

  it("tombstones deleted elements and their bound text", () => {
    const result = mergeElements(
      [rect("a"), boundText("a-label", "a", "Hi"), rect("b")],
      [],
      ["a", "missing"],
    );
    expect(result.elements).toEqual([
      expect.objectContaining({ id: "a", isDeleted: true, version: 4 }),
      expect.objectContaining({ id: "a-label", isDeleted: true, version: 3 }),
      expect.objectContaining({ id: "b", isDeleted: false }),
    ]);
    expect(result).toMatchObject({ deleted: 2, notFound: ["missing"] });
  });

  it("refuses to update and delete the same element", () => {
    expect(() => mergeElements([rect("a")], [rect("a")], ["a"])).toThrow(
      /both/,
    );
  });
});

describe("upsertElements", () => {
  it("writes the merged scene guarded by the version it read", async () => {
    const api = fakeApi([], [], [rect("a")]);
    const result = await upsertElements(api, APP, {
      drawingId: `${APP}/editor/d1`,
      elements: JSON.stringify([rect("b")]),
    });
    expect(api.updateElements).toHaveBeenCalledWith(
      "d1",
      [
        expect.objectContaining({ id: "a" }),
        expect.objectContaining({ id: "b" }),
      ],
      4,
    );
    expect(result).toMatchObject({ added: 1, elementCount: 2, version: 5 });
  });

  it("re-reads and merges again after a version conflict", async () => {
    const api = fakeApi([], [], [rect("a")]);
    api.updateElements.mockRejectedValueOnce(
      new ExcaliDashApiError(409, "409: Conflict"),
    );
    await upsertElements(api, APP, { drawingId: "d1", elements: [rect("b")] });
    expect(api.getDrawing).toHaveBeenCalledTimes(2);
    expect(api.updateElements).toHaveBeenCalledTimes(2);
  });

  it("validates the elements before contacting the server", async () => {
    const api = fakeApi();
    await expect(
      upsertElements(api, APP, { drawingId: "d1", elements: [{ id: "x" }] }),
    ).rejects.toThrow(/elements\[0\]/);
    await expect(upsertElements(api, APP, { drawingId: "d1" })).rejects.toThrow(
      /deleteIds/,
    );
    expect(api.getDrawing).not.toHaveBeenCalled();
  });
});
