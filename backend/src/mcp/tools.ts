import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ExcaliDashApi } from "./apiClient";
import {
  addDrawing,
  DEFAULT_PAGE_SIZE,
  drawingUrl,
  getDrawing,
  listUsableCollections,
  replaceDrawing,
  resolveCollection,
  upsertElements,
} from "./operations";

const ok = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return ok(await fn());
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
};

const contentSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .describe(
    "The complete contents of the .excalidraw file (Excalidraw scene JSON with `elements`, " +
      "`appState`, `files`), as a JSON string or object.",
  );

const collectionDescription =
  "Collection id or name (case-insensitive). Use list_collections to see the options.";

// How get_drawing, replace_drawing and upsert_elements find their drawing.
const drawingRefSchema = {
  drawingId: z
    .string()
    .optional()
    .describe("Id of the drawing, or its URL (…/editor/<id>)"),
  name: z
    .string()
    .optional()
    .describe("Exact name of the drawing, when the id is unknown"),
  collection: z
    .string()
    .optional()
    .describe(
      `Narrow the name lookup to this collection. ${collectionDescription}`,
    ),
};

export const registerTools = (
  server: McpServer,
  api: ExcaliDashApi,
  appUrl: string,
) => {
  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the ExcaliDash collections the API key's user owns or has shared access to.",
      annotations: { readOnlyHint: true },
    },
    () => run(() => listUsableCollections(api)),
  );

  server.registerTool(
    "list_drawings",
    {
      title: "List drawings",
      description:
        "List drawings, most recently updated first. Without `collection`, lists the user's own " +
        "drawings across all collections (excluding trash).",
      inputSchema: {
        collection: z.string().optional().describe(collectionDescription),
        search: z
          .string()
          .optional()
          .describe("Only drawings whose name contains this text"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Default 50"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ collection, search, limit }) =>
      run(async () => {
        const collectionId = collection
          ? (await resolveCollection(api, collection)).collection.id
          : undefined;
        const drawings = await api.listDrawings({
          collectionId,
          search,
          limit,
        });
        return drawings.map((d) => ({ ...d, url: drawingUrl(appUrl, d.id) }));
      }),
  );

  server.registerTool(
    "get_drawing",
    {
      title: "Get drawing",
      description:
        "Read a drawing. Identify it by `drawingId` (or its URL), or by exact `name`. " +
        '`format: "summary"` (default) returns compact elements — geometry, text, ' +
        "non-default style, links, bindings — with bound text folded into its container as " +
        '`label`. `format: "file"` returns the full Excalidraw elements, plus `appState` ' +
        "and `files` on the first page. Deleted elements are left out. Results are paged: " +
        "pass `offset: nextOffset` until `nextOffset` is null.",
      inputSchema: {
        ...drawingRefSchema,
        format: z
          .enum(["summary", "file"])
          .optional()
          .describe("Default summary"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Index of the first element to return. Default 0"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe(
            `Elements per page. Default ${DEFAULT_PAGE_SIZE.summary} (summary) / ` +
              `${DEFAULT_PAGE_SIZE.file} (file)`,
          ),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(() => getDrawing(api, appUrl, input)),
  );

  server.registerTool(
    "add_drawing",
    {
      title: "Add drawing",
      description:
        "Store an .excalidraw file as a new ExcaliDash drawing, optionally in a collection. " +
        "Always creates a new drawing; use replace_drawing to overwrite an existing one.",
      inputSchema: {
        content: contentSchema,
        name: z
          .string()
          .optional()
          .describe(
            "Drawing name, usually the file name without its .excalidraw extension",
          ),
        collection: z
          .string()
          .optional()
          .describe(`${collectionDescription} Omit for no collection.`),
        createCollectionIfMissing: z
          .boolean()
          .optional()
          .describe(
            "Create the collection (by name) when it does not exist yet. Default false.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => run(() => addDrawing(api, appUrl, input)),
  );

  server.registerTool(
    "replace_drawing",
    {
      title: "Replace drawing",
      description:
        "Replace the contents of an existing ExcaliDash drawing with an .excalidraw file. " +
        "Identify the drawing by `drawingId`, or by exact `name` (optionally narrowed by `collection`). " +
        "Keeps the drawing's id, link, collection and sharing; open editors reload.",
      inputSchema: {
        content: contentSchema,
        ...drawingRefSchema,
        rename: z.string().optional().describe("Also rename the drawing"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) => run(() => replaceDrawing(api, appUrl, input)),
  );

  server.registerTool(
    "upsert_elements",
    {
      title: "Upsert elements",
      description:
        "Add, update or delete elements of an existing drawing and leave everything else " +
        "as it is. An element whose `id` is already in the drawing replaces it in place; a " +
        "new id is appended on top. `deleteIds` deletes elements, and the text bound to " +
        "them. Retrying the same call is safe. To store a drawing too large for one " +
        "add_drawing or replace_drawing call, send its first batch of elements there and " +
        "the remaining batches here, in order.",
      inputSchema: {
        ...drawingRefSchema,
        elements: z
          .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
          .optional()
          .describe(
            "Full Excalidraw elements (each with `id` and `type`), as a JSON array or its text",
          ),
        deleteIds: z
          .array(z.string())
          .optional()
          .describe("Ids of elements to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) => run(() => upsertElements(api, appUrl, input)),
  );
};
