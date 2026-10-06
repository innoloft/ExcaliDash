import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PrismaClient } from "../generated/client";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb } from "./testUtils";

const scene = (id: string) => ({
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      isDeleted: false,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

describe("MCP endpoint", () => {
  let prisma: PrismaClient;
  let app: any;
  let server: Server;
  let baseUrl: string;
  let writeKey: string;
  let readOnlyKey: string;

  const createKey = async (userId: string, scopes?: string[]) => {
    const generated = generateApiKey();
    await prisma.apiKey.create({
      data: {
        userId,
        name: "mcp",
        keyId: generated.keyId,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: serializeApiKeyScopes(scopes),
      },
    });
    return generated.token;
  };

  const connect = async (token: string) => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };

  const call = async (
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    const text = result.content[0].text;
    return {
      isError: Boolean(result.isError),
      text,
      json: result.isError ? null : JSON.parse(text),
    };
  };

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true },
      create: { id: "default", authEnabled: true },
    });
    const user = await prisma.user.create({
      data: {
        email: "mcp-user@test.local",
        passwordHash: "x",
        name: "MCP User",
      },
    });
    writeKey = await createKey(user.id);
    readOnlyKey = await createKey(user.id, [
      "drawings:read",
      "collections:read",
    ]);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  it("requires an API key", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toMatch(/^Bearer/);
  });

  it("rejects cross-origin browser requests", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Origin", "https://evil.example")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(403);
  });

  it("adds a drawing to a new collection and replaces it by name", async () => {
    const client = await connect(writeKey);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual([
      "list_collections",
      "list_drawings",
      "get_drawing",
      "add_drawing",
      "replace_drawing",
      "upsert_elements",
    ]);

    const added = await call(client, "add_drawing", {
      content: JSON.stringify(scene("first")),
      name: "Architecture overview",
      collection: "Diagrams",
      createCollectionIfMissing: true,
    });
    expect(added.isError).toBe(false);
    expect(added.json).toMatchObject({
      collectionName: "Diagrams",
      createdCollection: true,
    });
    expect(added.json.url).toMatch(new RegExp(`/editor/${added.json.id}$`));

    const replaced = await call(client, "replace_drawing", {
      content: scene("second"),
      name: "architecture overview",
      collection: "diagrams",
    });
    expect(replaced.isError).toBe(false);
    expect(replaced.json.id).toBe(added.json.id);

    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: added.json.id },
    });
    expect(
      JSON.parse(stored.elements).map((e: { id: string }) => e.id),
    ).toEqual(["second"]);
    expect(stored.collectionId).toBe(added.json.collectionId);
    expect(stored.preview).toBeNull();
    await client.close();
  });

  it("uploads a drawing in batches, reads it back and deletes from it", async () => {
    const client = await connect(writeKey);
    const element = (id: string, y: number) => ({
      ...scene(id).elements[0],
      y,
      version: 1,
    });
    const added = await call(client, "add_drawing", {
      content: { elements: [element("b1", 0)] },
      name: "Batched",
    });
    expect(added.isError).toBe(false);

    const url = added.json.url;
    for (const batch of [[element("b2", 20)], [element("b3", 40)]]) {
      const upserted = await call(client, "upsert_elements", {
        drawingId: url,
        elements: batch,
      });
      expect(upserted.isError).toBe(false);
      expect(upserted.json.added).toBe(1);
    }

    const read = await call(client, "get_drawing", { drawingId: url });
    expect(read.isError).toBe(false);
    expect(read.json.elements.map((e: { id: string }) => e.id)).toEqual([
      "b1",
      "b2",
      "b3",
    ]);

    const removed = await call(client, "upsert_elements", {
      name: "Batched",
      deleteIds: ["b2"],
    });
    expect(removed.json).toMatchObject({ deleted: 1, elementCount: 2 });
    const file = await call(client, "get_drawing", {
      drawingId: added.json.id,
      format: "file",
    });
    expect(file.json.elements.map((e: { id: string }) => e.id)).toEqual([
      "b1",
      "b3",
    ]);
    await client.close();
  });

  it("keeps the API key's scopes", async () => {
    const client = await connect(readOnlyKey);
    const listed = await call(client, "list_drawings", {});
    expect(listed.isError).toBe(false);
    expect(listed.json.map((d: { name: string }) => d.name)).toContain(
      "Architecture overview",
    );

    const added = await call(client, "add_drawing", { content: scene("x") });
    expect(added.isError).toBe(true);
    expect(added.text).toMatch(/403/);
    await client.close();
  });
});
