export type DrawingScene = {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Some exports store scene fields as JSON strings; accept both forms, as the
// dashboard's own importer does.
const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Parse the contents of an .excalidraw file, given as JSON text or already parsed. */
export const parseExcalidrawScene = (content: unknown): DrawingScene => {
  let parsed: unknown = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Drawing is not valid JSON");
    }
  }
  if (!isRecord(parsed)) throw new Error("Drawing must be a JSON object");

  if (typeof parsed.type === "string" && parsed.type !== "excalidraw") {
    throw new Error(
      `Unsupported file type "${parsed.type}" — expected an Excalidraw scene (type "excalidraw")`,
    );
  }

  const candidate = isRecord(parsed.data) ? parsed.data : parsed;
  const elements = parseMaybeJson(candidate.elements ?? []);
  const appState = parseMaybeJson(candidate.appState ?? {});
  const files = parseMaybeJson(candidate.files ?? {});

  if (!Array.isArray(elements)) throw new Error("Drawing has no valid `elements` array");
  if (!isRecord(appState)) throw new Error("Drawing has an invalid `appState`");
  if (!isRecord(files)) throw new Error("Drawing has an invalid `files` map");

  return { elements, appState, files };
};
