import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import { io as connect, type Socket } from "socket.io-client";
import { PrismaClient } from "../generated/client";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb } from "./testUtils";

const createKey = async (
  prisma: PrismaClient,
  userId: string,
  scopes?: string[],
): Promise<string> => {
  const generated = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId,
      name: "Native client",
      keyId: generated.keyId,
      tokenHash: generated.tokenHash,
      prefix: generated.prefix,
      scopes: serializeApiKeyScopes(scopes),
    },
  });
  return generated.token;
};

const once = <T>(socket: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe("realtime collaboration with API keys", () => {
  let prisma: PrismaClient;
  let url: string;
  let httpServer: any;
  let drawingId: string;
  let ownerKey: string;
  let readOnlyKey: string;
  const sockets: Socket[] = [];

  const open = async (token: string): Promise<Socket> => {
    const socket = connect(url, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (error) => reject(error));
    });
    return socket;
  };

  const join = (socket: Socket) =>
    new Promise<any>((resolve) => {
      socket.emit(
        "join-room",
        { drawingId, user: { id: "spoofed", name: "Native", color: "#ff0000" } },
        resolve,
      );
    });

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    const mod = await import("../index");
    httpServer = mod.httpServer;
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });
    const owner = await prisma.user.create({
      data: {
        email: "socket-owner@test.local",
        passwordHash: "",
        name: "Socket Owner",
        role: "USER",
        isActive: true,
      },
    });
    const drawing = await prisma.drawing.create({
      data: {
        name: "Live",
        userId: owner.id,
        elements: "[]",
        appState: "{}",
        files: "{}",
      },
    });
    drawingId = drawing.id;
    ownerKey = await createKey(prisma, owner.id);
    readOnlyKey = await createKey(prisma, owner.id, [
      "drawings:read",
      "collections:read",
    ]);
    if (!httpServer.listening) {
      await new Promise<void>((resolve) =>
        httpServer.listen(0, "127.0.0.1", resolve),
      );
    }
    const { port } = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("rejects an invalid API key at the handshake", async () => {
    await expect(open("exd_AAAAAAAAAAAAAAAA_invalid")).rejects.toThrow(
      /Invalid or revoked API key/,
    );
  });

  it("joins as the key's owner and relays edits both ways", async () => {
    const a = await open(ownerKey);
    const b = await open(ownerKey);
    const joined = await join(a);
    expect(joined.user.name).toBe("Socket Owner");
    expect(joined.user.id).not.toBe("spoofed");
    await join(b);

    const received = once<any>(b, "element-update");
    a.emit("element-update", {
      drawingId,
      elements: [{ id: "el1", version: 2 }],
    });
    expect((await received).elements[0].id).toBe("el1");

    const cursor = once<any>(a, "cursor-move");
    b.emit("cursor-move", { drawingId, pointer: { x: 1, y: 2 } });
    const moved = await cursor;
    expect(moved.pointer).toEqual({ x: 1, y: 2 });
    expect(moved.username).toBe("Socket Owner");
  });

  it("lets read-only keys watch but not edit", async () => {
    const writer = await open(ownerKey);
    const reader = await open(readOnlyKey);
    await join(writer);
    await join(reader);

    const error = once<any>(reader, "error");
    reader.emit("element-update", { drawingId, elements: [{ id: "x" }] });
    expect((await error).message).toMatch(/Read-only/);

    const received = once<any>(reader, "element-update");
    writer.emit("element-update", { drawingId, elements: [{ id: "el2" }] });
    expect((await received).elements[0].id).toBe("el2");
  });
});
