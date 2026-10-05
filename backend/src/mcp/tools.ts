import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ExcaliDashApi } from "./apiClient";
import {
  addDrawing,
  drawingUrl,
  listUsableCollections,
  replaceDrawing,
  resolveCollection,
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
        drawingId: z
          .string()
          .optional()
          .describe("Id of the drawing to replace"),
        name: z
          .string()
          .optional()
          .describe("Name of the drawing to replace, when the id is unknown"),
        collection: z
          .string()
          .optional()
          .describe(
            `Narrow the name lookup to this collection. ${collectionDescription}`,
          ),
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
};
