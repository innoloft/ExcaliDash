import {
  ExcaliDashApiError,
  type Collection,
  type DrawingSummary,
  type ExcaliDashApi,
} from "./apiClient";
import { parseExcalidrawScene } from "./excalidrawScene";

// The API exposes the caller's trash as a pseudo-collection; it is never a
// sensible target for storing a drawing.
const TRASH_ID = "trash";

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const listUsableCollections = async (
  api: ExcaliDashApi,
): Promise<Collection[]> =>
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
    const ids = byName
      .map((c) => `${c.id}${c.isOwner ? "" : " (shared)"}`)
      .join(", ");
    throw new Error(
      `Collection name "${ref}" is ambiguous; pass one of these ids: ${ids}`,
    );
  }

  if (options.createIfMissing) {
    return {
      collection: await api.createCollection(ref.trim()),
      created: true,
    };
  }
  const available = collections.map((c) => `"${c.name}"`).join(", ") || "none";
  throw new Error(
    `Collection "${ref}" not found (available: ${available}). ` +
      "Set createCollectionIfMissing to create it.",
  );
};

export const drawingUrl = (appUrl: string, id: string) =>
  `${appUrl}/editor/${id}`;

/** Accept a bare drawing id or a drawing URL (`…/editor/<id>`). */
export const drawingIdFromRef = (ref: string): string => {
  const trimmed = ref.trim();
  const match = /\/editor\/([^/?#]+)/.exec(trimmed);
  return match ? decodeURIComponent(match[1]) : trimmed;
};

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
): Promise<
  DrawingResult & { collectionName: string | null; createdCollection: boolean }
> => {
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
  const collectionId = collection
    ? (await resolveCollection(api, collection)).collection.id
    : undefined;
  const candidates = await api.listDrawings({
    collectionId,
    search: name.trim(),
    limit: 200,
  });
  const exact = candidates.filter((d) => d.name === name.trim());
  const matches =
    exact.length > 0 ? exact : candidates.filter((d) => sameName(d.name, name));

  if (matches.length === 1) return matches[0];
  const scope = collection ? ` in collection "${collection}"` : "";
  if (matches.length === 0) {
    throw new Error(
      `No drawing named "${name}"${scope}. Drawings in collections shared with you ` +
        "are only found when `collection` is given.",
    );
  }
  const ids = matches
    .map((d) => `${d.id} (collection ${d.collectionId ?? "none"})`)
    .join(", ");
  throw new Error(
    `Several drawings are named "${name}"${scope}; pass drawingId: ${ids}`,
  );
};

/** How a tool names an existing drawing: by id (or URL), or by exact name. */
export type DrawingRef = {
  drawingId?: string;
  name?: string;
  collection?: string;
};

/** Validate a reference without contacting the server. */
const checkDrawingRef = (ref: DrawingRef): DrawingRef => {
  const hasId = Boolean(ref.drawingId?.trim());
  const hasName = Boolean(ref.name?.trim());
  if (hasId === hasName) {
    throw new Error(
      "Identify the drawing with exactly one of `drawingId` or `name`",
    );
  }
  return ref;
};

const resolveDrawingId = async (
  api: ExcaliDashApi,
  ref: DrawingRef,
): Promise<string> =>
  ref.drawingId?.trim()
    ? drawingIdFromRef(ref.drawingId)
    : (await findDrawingByName(api, ref.name!, ref.collection)).id;

export type ReplaceDrawingInput = DrawingRef & {
  content: unknown;
  rename?: string;
};

export const replaceDrawing = async (
  api: ExcaliDashApi,
  appUrl: string,
  input: ReplaceDrawingInput,
): Promise<DrawingResult> => {
  const lookup = checkDrawingRef(input);
  // Parse the file before touching the server so a bad file fails fast.
  const scene = parseExcalidrawScene(input.content);
  const drawingId = await resolveDrawingId(api, lookup);

  const drawing = await api.replaceDrawing(drawingId, {
    ...scene,
    ...(input.rename?.trim() ? { name: input.rename.trim() } : {}),
  });
  return { ...drawing, url: drawingUrl(appUrl, drawing.id) };
};

type SceneElement = Record<string, unknown> & { id: string; type: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLive = (element: unknown): element is SceneElement =>
  isRecord(element) &&
  typeof element.id === "string" &&
  element.isDeleted !== true;

// Excalidraw's defaults; a compact element only carries values that differ.
const STYLE_DEFAULTS: Record<string, unknown> = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
};

const round = (value: unknown) =>
  typeof value === "number" ? Math.round(value) : value;

const textOf = (element: Record<string, unknown>) =>
  typeof element.originalText === "string"
    ? element.originalText
    : element.text;

const compactBinding = (binding: unknown) =>
  isRecord(binding) && typeof binding.elementId === "string"
    ? { elementId: binding.elementId }
    : undefined;

/**
 * Reduce a scene element to the fields that carry meaning: geometry, text,
 * non-default style, links and bindings. Bound text is folded into its
 * container as `label`.
 */
export const compactElement = (
  element: SceneElement,
  label?: SceneElement,
): Record<string, unknown> => {
  const compact: Record<string, unknown> = {
    id: element.id,
    type: element.type,
    x: round(element.x),
    y: round(element.y),
    width: round(element.width),
    height: round(element.height),
  };
  if (typeof element.angle === "number" && element.angle !== 0)
    compact.angle = element.angle;
  if (element.type === "text") {
    compact.text = textOf(element);
    compact.fontSize = element.fontSize;
    compact.fontFamily = element.fontFamily;
    if (typeof element.containerId === "string")
      compact.containerId = element.containerId;
  }
  if (label) {
    compact.label = {
      text: textOf(label),
      fontSize: label.fontSize,
      fontFamily: label.fontFamily,
    };
  }
  for (const [key, fallback] of Object.entries(STYLE_DEFAULTS)) {
    if (element[key] !== undefined && element[key] !== fallback)
      compact[key] = element[key];
  }
  if (isRecord(element.roundness)) compact.roundness = element.roundness;
  if (Array.isArray(element.points))
    compact.points = (element.points as unknown[]).map((point) =>
      Array.isArray(point) ? point.map(round) : point,
    );
  const start = compactBinding(element.startBinding);
  const end = compactBinding(element.endBinding);
  if (start) compact.startBinding = start;
  if (end) compact.endBinding = end;
  if (typeof element.link === "string" && element.link)
    compact.link = element.link;
  if (element.locked === true) compact.locked = true;
  if (Array.isArray(element.groupIds) && element.groupIds.length > 0)
    compact.groupIds = element.groupIds;
  if (typeof element.frameId === "string") compact.frameId = element.frameId;
  return compact;
};

/** The live elements in z-order, bound labels folded into their containers. */
export const summarizeElements = (
  elements: unknown[],
): Record<string, unknown>[] => {
  const live = elements.filter(isLive);
  const ids = new Set(live.map((element) => element.id));
  const labels = new Map<string, SceneElement>();
  for (const element of live) {
    if (
      element.type === "text" &&
      typeof element.containerId === "string" &&
      ids.has(element.containerId)
    ) {
      labels.set(element.containerId, element);
    }
  }
  const folded = new Set([...labels.values()].map((label) => label.id));
  return live
    .filter((element) => !folded.has(element.id))
    .map((element) => compactElement(element, labels.get(element.id)));
};

export const DEFAULT_PAGE_SIZE = { summary: 250, file: 60 } as const;

export type GetDrawingInput = DrawingRef & {
  format?: "summary" | "file";
  offset?: number;
  limit?: number;
};

export const getDrawing = async (
  api: ExcaliDashApi,
  appUrl: string,
  input: GetDrawingInput,
) => {
  const drawingId = await resolveDrawingId(api, checkDrawingRef(input));
  const drawing = await api.getDrawing(drawingId);
  const format = input.format ?? "summary";
  const all =
    format === "summary"
      ? summarizeElements(drawing.elements)
      : drawing.elements.filter(isLive);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = input.limit ?? DEFAULT_PAGE_SIZE[format];
  const page = all.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    id: drawing.id,
    name: drawing.name,
    url: drawingUrl(appUrl, drawing.id),
    collectionId: drawing.collectionId,
    version: drawing.version,
    updatedAt: drawing.updatedAt,
    format,
    total: all.length,
    offset,
    returned: page.length,
    nextOffset: next < all.length ? next : null,
    elements: page,
    // Scene-wide state travels once, with the first page of the file.
    ...(format === "file" && offset === 0
      ? { appState: drawing.appState, files: drawing.files }
      : {}),
  };
};

/**
 * Merge `incoming` into `existing` by element id: a known id is replaced in
 * place (keeping its z-position), a new one is appended, and each id in
 * `deleteIds` — plus any text bound to it — is tombstoned the way Excalidraw
 * deletes (`isDeleted`). Versions are bumped past the stored ones so that
 * collaborating editors accept the change.
 */
export const mergeElements = (
  existing: unknown[],
  incoming: SceneElement[],
  deleteIds: string[] = [],
) => {
  const toDelete = new Set(deleteIds);
  const clash = incoming.find((element) => toDelete.has(element.id));
  if (clash) {
    throw new Error(
      `Element "${clash.id}" is both in \`elements\` and in \`deleteIds\``,
    );
  }
  const byId = new Map(incoming.map((element) => [element.id, element]));
  const versionOf = (element: unknown) =>
    isRecord(element) && typeof element.version === "number"
      ? element.version
      : 0;
  const bump = (from: unknown, onto: Record<string, unknown>) => ({
    ...onto,
    version: Math.max(versionOf(onto), versionOf(from) + 1),
  });

  let updated = 0;
  let deleted = 0;
  const found = new Set<string>();
  const merged = existing.map((element) => {
    if (!isRecord(element) || typeof element.id !== "string") return element;
    const replacement = byId.get(element.id);
    if (replacement) {
      byId.delete(element.id);
      updated++;
      return bump(element, replacement);
    }
    const boundToDeleted =
      typeof element.containerId === "string" &&
      toDelete.has(element.containerId);
    if (
      element.isDeleted !== true &&
      (toDelete.has(element.id) || boundToDeleted)
    ) {
      if (toDelete.has(element.id)) found.add(element.id);
      deleted++;
      return bump(element, { ...element, isDeleted: true });
    }
    if (toDelete.has(element.id)) found.add(element.id);
    return element;
  });
  const added = [...byId.values()];
  return {
    elements: [...merged, ...added],
    added: added.length,
    updated,
    deleted,
    notFound: deleteIds.filter((id) => !found.has(id)),
  };
};

const toSceneElements = (elements: unknown[]): SceneElement[] =>
  elements.map((element, index) => {
    if (
      !isRecord(element) ||
      typeof element.id !== "string" ||
      !element.id ||
      typeof element.type !== "string"
    ) {
      throw new Error(
        `elements[${index}] is not an Excalidraw element (needs a string \`id\` and \`type\`)`,
      );
    }
    return element as SceneElement;
  });

export type UpsertElementsInput = DrawingRef & {
  /** Elements as JSON text or an array. */
  elements?: unknown;
  deleteIds?: string[];
};

const MAX_CONFLICT_RETRIES = 3;

export const upsertElements = async (
  api: ExcaliDashApi,
  appUrl: string,
  input: UpsertElementsInput,
) => {
  const lookup = checkDrawingRef(input);
  let raw: unknown = input.elements ?? [];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("`elements` is not valid JSON");
    }
  }
  if (!Array.isArray(raw)) throw new Error("`elements` must be an array");
  const incoming = toSceneElements(raw);
  const deleteIds = input.deleteIds ?? [];
  if (incoming.length === 0 && deleteIds.length === 0) {
    throw new Error("Pass `elements` to add or update, or `deleteIds`");
  }

  const drawingId = await resolveDrawingId(api, lookup);
  // Merge against the latest scene and write only if nobody saved in
  // between; on a conflict, re-read and merge again.
  for (let attempt = 0; ; attempt++) {
    const current = await api.getDrawing(drawingId);
    const merge = mergeElements(current.elements, incoming, deleteIds);
    try {
      const saved = await api.updateElements(
        drawingId,
        merge.elements,
        current.version,
      );
      return {
        ...saved,
        url: drawingUrl(appUrl, saved.id),
        added: merge.added,
        updated: merge.updated,
        deleted: merge.deleted,
        notFound: merge.notFound,
        elementCount: merge.elements.filter(isLive).length,
      };
    } catch (error) {
      const conflict =
        error instanceof ExcaliDashApiError && error.status === 409;
      if (!conflict || attempt >= MAX_CONFLICT_RETRIES) throw error;
    }
  }
};
