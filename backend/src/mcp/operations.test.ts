import { describe, expect, it, vi } from "vitest";
import type { Collection, DrawingSummary, ExcaliDashApi } from "./apiClient";
import { addDrawing, replaceDrawing, resolveCollection } from "./operations";

const content = JSON.stringify({ type: "excalidraw", elements: [{ id: "a" }], appState: {} });
const APP = "https://exd.example";

const summary = (overrides: Partial<DrawingSummary> = {}): DrawingSummary => ({
  id: "d1",
  name: "Drawing",
  collectionId: null,
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const fakeApi = (collections: Collection[] = [], drawings: DrawingSummary[] = []) => {
  const api = {
    listCollections: vi.fn(async () => collections),
    createCollection: vi.fn(async (name: string) => ({ id: "new", name, isOwner: true, sharedRole: null })),
    listDrawings: vi.fn(async () => drawings),
    createDrawing: vi.fn(async (input) => summary({ name: input.name, collectionId: input.collectionId })),
    replaceDrawing: vi.fn(async (id: string, input) => summary({ id, name: input.name ?? "Drawing" })),
  } satisfies ExcaliDashApi;
  return api;
};

const col = (id: string, name: string, isOwner = true): Collection => ({ id, name, isOwner, sharedRole: null });

describe("resolveCollection", () => {
  const collections = [col("trash", "Trash"), col("c1", "Architecture"), col("c2", "Ideas")];

  it("matches by id, then case-insensitive name", async () => {
    const api = fakeApi(collections);
    expect((await resolveCollection(api, "c2")).collection.id).toBe("c2");
    expect((await resolveCollection(api, "architecture")).collection.id).toBe("c1");
  });

  it("never resolves to the trash", async () => {
    await expect(resolveCollection(fakeApi(collections), "trash")).rejects.toThrow(/not found/);
  });

  it("creates only when asked", async () => {
    const api = fakeApi(collections);
    await expect(resolveCollection(api, "Roadmap")).rejects.toThrow(/createCollectionIfMissing/);
    const result = await resolveCollection(api, "Roadmap", { createIfMissing: true });
    expect(result).toMatchObject({ created: true, collection: { id: "new", name: "Roadmap" } });
  });

  it("refuses ambiguous names", async () => {
    const api = fakeApi([col("c1", "Shared"), col("c9", "shared", false)]);
    await expect(resolveCollection(api, "Shared")).rejects.toThrow(/ambiguous.*c1.*c9 \(shared\)/);
  });
});

describe("addDrawing", () => {
  it("stores the drawing in the resolved collection", async () => {
    const api = fakeApi([col("c1", "Architecture")]);
    const result = await addDrawing(api, APP, { content, name: "Flow", collection: "Architecture" });
    expect(api.createDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Flow", collectionId: "c1", elements: [{ id: "a" }] }),
    );
    expect(result).toMatchObject({ collectionName: "Architecture", url: `${APP}/editor/d1` });
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
    expect(api.replaceDrawing).toHaveBeenCalledWith("d7", expect.not.objectContaining({ name: expect.anything() }));
  });

  it("looks up by exact name within a collection", async () => {
    const api = fakeApi([col("c1", "Architecture")], [summary({ id: "d2", name: "Flow v2" }), summary({ id: "d3", name: "Flow" })]);
    await replaceDrawing(api, APP, { name: "Flow", collection: "Architecture", content, rename: "Flow (final)" });
    expect(api.listDrawings).toHaveBeenCalledWith(expect.objectContaining({ collectionId: "c1", search: "Flow" }));
    expect(api.replaceDrawing).toHaveBeenCalledWith("d3", expect.objectContaining({ name: "Flow (final)" }));
  });

  it("refuses ambiguous or missing names", async () => {
    const twins = fakeApi([], [summary({ id: "d2", name: "Flow" }), summary({ id: "d3", name: "Flow" })]);
    await expect(replaceDrawing(twins, APP, { name: "Flow", content })).rejects.toThrow(/Several.*d2.*d3/);
    await expect(replaceDrawing(fakeApi(), APP, { name: "Flow", content })).rejects.toThrow(/No drawing named/);
  });

  it("validates the file before contacting the server", async () => {
    const api = fakeApi();
    await expect(replaceDrawing(api, APP, { name: "Flow", content: "{" })).rejects.toThrow(/JSON/);
    expect(api.listDrawings).not.toHaveBeenCalled();
    await expect(replaceDrawing(api, APP, { content })).rejects.toThrow(/drawingId.*name/);
  });
});
