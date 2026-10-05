import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import type { Server } from "socket.io";
import type { PrismaClient } from "../generated/client";
import { registerDrawingCreateUpdateRoutes } from "../routes/dashboard/drawingCreateUpdateRoutes";
import type { DrawingRouteContext } from "../routes/dashboard/drawingRouteContext";
import { cleanupTestDb, getTestPrisma, setupTestDb } from "./testUtils";

const PREVIEW =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';

describe("dashboard preview backfill", () => {
  let prisma: PrismaClient;
  let ownerId: string;
  let otherId: string;
  let app: express.Express;

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    const auth: express.RequestHandler = (req, _res, next) => {
      req.user = { id: ownerId } as express.Request["user"];
      next();
    };
    app = express();
    app.use(express.json());
    registerDrawingCreateUpdateRoutes(app, {
      prisma,
      requireAuth: auth,
      optionalAuth: auth,
      asyncHandler: (handler) => (req, res, next) => {
        void handler(req, res, next).catch(next);
      },
      parseJsonField: (raw, fallback) => (raw ? JSON.parse(raw) : fallback),
      drawingUpdateSchema: z.object({}),
      respondWithValidationErrors: (res, issues) =>
        res.status(400).json({ issues }),
      getRequestPrincipal: async () => ({ kind: "user", userId: ownerId }),
      respondWithAuthErrorIfPresent: () => false,
      invalidateDrawingsCache: vi.fn(),
      config: { nodeEnv: "test" },
      internDrawingFiles: async (files) => files,
      io: { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server,
    } as DrawingRouteContext);
  });

  beforeEach(async () => {
    await cleanupTestDb(prisma);
    const user = (email: string, name: string) =>
      prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: "x", name },
      });
    ownerId = (await user("owner@test.local", "Owner")).id;
    otherId = (await user("other@test.local", "Other")).id;
  });
  afterAll(async () => prisma.$disconnect());

  const createDrawing = (
    overrides: { userId?: string; preview?: string } = {},
  ) =>
    prisma.drawing.create({
      data: {
        userId: overrides.userId ?? ownerId,
        name: "MCP drawing",
        elements: "[]",
        appState: "{}",
        preview: overrides.preview ?? null,
        version: 4,
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      },
    });

  it("stores a missing preview without touching updatedAt or version", async () => {
    const drawing = await createDrawing();
    const response = await request(app)
      .put(`/drawings/${drawing.id}/preview`)
      .send({ preview: PREVIEW, version: 4 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stored: true });
    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawing.id },
    });
    expect(stored.preview).toContain("<rect");
    expect(stored.updatedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(stored.version).toBe(4);
  });

  it("never replaces an existing preview", async () => {
    const drawing = await createDrawing({ preview: "<svg>editor</svg>" });
    const response = await request(app)
      .put(`/drawings/${drawing.id}/preview`)
      .send({ preview: PREVIEW, version: 4 });
    expect(response.body).toEqual({ stored: false });
    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawing.id },
    });
    expect(stored.preview).toBe("<svg>editor</svg>");
  });

  it("ignores a preview rendered from an older version", async () => {
    const drawing = await createDrawing();
    const response = await request(app)
      .put(`/drawings/${drawing.id}/preview`)
      .send({ preview: PREVIEW, version: 3 });
    expect(response.body).toEqual({ stored: false });
    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawing.id },
    });
    expect(stored.preview).toBeNull();
  });

  it("sanitizes the stored SVG", async () => {
    const drawing = await createDrawing();
    await request(app)
      .put(`/drawings/${drawing.id}/preview`)
      .send({
        preview: PREVIEW.replace("<rect", "<script>alert(1)</script><rect"),
        version: 4,
      })
      .expect(200);
    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawing.id },
    });
    expect(stored.preview).not.toContain("script");
    expect(stored.preview).toContain("<rect");
  });

  it("refuses drawings the caller cannot edit", async () => {
    const drawing = await createDrawing({ userId: otherId });
    const response = await request(app)
      .put(`/drawings/${drawing.id}/preview`)
      .send({ preview: PREVIEW, version: 4 });
    expect(response.status).toBe(404);
    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawing.id },
    });
    expect(stored.preview).toBeNull();
  });
});
