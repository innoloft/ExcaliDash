import type { Collection, DrawingSummary, ExcaliDashApi } from "./apiClient";
import { parseExcalidrawScene } from "./excalidrawScene";

// The API exposes the caller's trash as a pseudo-collection; it is never a
// sensible target for storing a drawing.
const TRASH_ID = "trash";

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const listUsableCollections = async (api: ExcaliDashApi): Promise<Collection[]> =>
  (await api.listCollections()).filter((c) => c.id !== TRASH_ID);

/**
 * Resolve a collection by id, falling back to a case-insensitive name match.
 * Creates it when `createIfMissing` is set and nothing matches.
 */
export const resolveCollection = async (
  api: ExcaliDashApi,
  ref: string,
  options: { createIfMissing?: boolean } = {},
): Promise<{ collection: Collection; created: boolean }> => {
  const collections = await listUsableCollections(api);
  const byId = collections.find((c) => c.id === ref);
  if (byId) return { collection: byId, created: false };

  const byName = collections.filter((c) => sameName(c.name, ref));
  if (byName.length === 1) return { collection: byName[0], created: false };
  if (byName.length > 1) {
    const ids = byName.map((c) => `${c.id}${c.isOwner ? "" : " (shared)"}`).join(", ");
    throw new Error(`Collection name "${ref}" is ambiguous; pass one of these ids: ${ids}`);
  }

  if (options.createIfMissing) {
    return { collection: await api.createCollection(ref.trim()), created: true };
  }
  const available = collections.map((c) => `"${c.name}"`).join(", ") || "none";
  throw new Error(
    `Collection "${ref}" not found (available: ${available}). ` +
      "Set createCollectionIfMissing to create it.",
  );
};

export const drawingUrl = (appUrl: string, id: string) => `${appUrl}/editor/${id}`;

type DrawingResult = DrawingSummary & { url: string };

export type AddDrawingInput = {
  /** The .excalidraw file contents, as JSON text or an object. */
  content: unknown;
  name?: string;
  collection?: string;
  createCollectionIfMissing?: boolean;
};

export const addDrawing = async (
  api: ExcaliDashApi,
  appUrl: string,
  input: AddDrawingInput,
): Promise<DrawingResult & { collectionName: string | null; createdCollection: boolean }> => {
  const scene = parseExcalidrawScene(input.content);
  const resolved = input.collection
    ? await resolveCollection(api, input.collection, {
        createIfMissing: input.createCollectionIfMissing,
      })
    : null;

  const drawing = await api.createDrawing({
    ...scene,
    name: input.name?.trim() || "Untitled Drawing",
    collectionId: resolved?.collection.id ?? null,
  });
  return {
    ...drawing,
    url: drawingUrl(appUrl, drawing.id),
    collectionName: resolved?.collection.name ?? null,
    createdCollection: resolved?.created ?? false,
  };
};

/** Find exactly one drawing by name, optionally within one collection. */
export const findDrawingByName = async (
  api: ExcaliDashApi,
  name: string,
  collection?: string,
): Promise<DrawingSummary> => {
  const collectionId = collection ? (await resolveCollection(api, collection)).collection.id : undefined;
  const candidates = await api.listDrawings({ collectionId, search: name.trim(), limit: 200 });
  const exact = candidates.filter((d) => d.name === name.trim());
  const matches = exact.length > 0 ? exact : candidates.filter((d) => sameName(d.name, name));

  if (matches.length === 1) return matches[0];
  const scope = collection ? ` in collection "${collection}"` : "";
  if (matches.length === 0) {
    throw new Error(
      `No drawing named "${name}"${scope}. Drawings in collections shared with you ` +
        "are only found when `collection` is given.",
    );
  }
  const ids = matches.map((d) => `${d.id} (collection ${d.collectionId ?? "none"})`).join(", ");
  throw new Error(`Several drawings are named "${name}"${scope}; pass drawingId: ${ids}`);
};

export type ReplaceDrawingInput = {
  content: unknown;
  drawingId?: string;
  name?: string;
  collection?: string;
  rename?: string;
};

export const replaceDrawing = async (
  api: ExcaliDashApi,
  appUrl: string,
  input: ReplaceDrawingInput,
): Promise<DrawingResult> => {
  const hasId = Boolean(input.drawingId?.trim());
  const hasName = Boolean(input.name?.trim());
  if (hasId === hasName) {
    throw new Error("Identify the drawing with exactly one of `drawingId` or `name`");
  }
  // Parse the file before touching the server so a bad file fails fast.
  const scene = parseExcalidrawScene(input.content);
  const drawingId = hasId
    ? input.drawingId!.trim()
    : (await findDrawingByName(api, input.name!, input.collection)).id;

  const drawing = await api.replaceDrawing(drawingId, {
    ...scene,
    ...(input.rename?.trim() ? { name: input.rename.trim() } : {}),
  });
  return { ...drawing, url: drawingUrl(appUrl, drawing.id) };
};
