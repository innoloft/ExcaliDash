import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { StringValue } from "ms";
import { PrismaClient } from "../generated/client";
import { config } from "../config";
import { getTestPrisma, setupTestDb } from "./testUtils";

describe("Drawing comments", () => {
  const userAgent = "vitest-drawing-comments";
  let prisma: PrismaClient;
  let app: any;

  let owner: { id: string; email: string };
  let viewer: { id: string; email: string };
  let outsider: { id: string; email: string };
  let ownerToken: string;
  let viewerToken: string;
  let outsiderToken: string;

  let ownerAgent: ReturnType<typeof request.agent>;
  let ownerCsrf: { name: string; token: string };
  let viewerAgent: ReturnType<typeof request.agent>;
  let viewerCsrf: { name: string; token: string };

  const signAccessToken = (user: { id: string; email: string }) => {
    const signOptions: SignOptions = {
      expiresIn: config.jwtAccessExpiresIn as StringValue,
    };
    return jwt.sign(
      { userId: user.id, email: user.email, type: "access" },
      config.jwtSecret,
      signOptions,
    );
  };

  const createUser = async (email: string, name: string) => {
    const passwordHash = await bcrypt.hash("password123", 10);
    return prisma.user.create({
      data: { email, passwordHash, name, role: "USER", isActive: true },
      select: { id: true, email: true },
    });
  };

  const createCsrf = async (agent: ReturnType<typeof request.agent>) => {
    const response = await agent.get("/csrf-token").set("User-Agent", userAgent);
    return { name: response.body.header, token: response.body.token };
  };

  const createDrawing = async () =>
    prisma.drawing.create({
      data: {
        name: "Commented drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        userId: owner.id,
        version: 1,
      },
      select: { id: true },
    });

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));

    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });

    owner = await createUser("owner-comments@test.local", "Owner User");
    viewer = await createUser("viewer-comments@test.local", "Viewer User");
    outsider = await createUser("outsider-comments@test.local", "Outsider");

    ownerToken = signAccessToken(owner);
    viewerToken = signAccessToken(viewer);
    outsiderToken = signAccessToken(outsider);

    ownerAgent = request.agent(app);
    ownerCsrf = await createCsrf(ownerAgent);
    viewerAgent = request.agent(app);
    viewerCsrf = await createCsrf(viewerAgent);
  }, 120000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const shareWithViewer = async (drawingId: string) =>
    prisma.drawingPermission.create({
      data: {
        drawingId,
        granteeUserId: viewer.id,
        permission: "view",
        createdByUserId: owner.id,
      },
    });

  it("lets a view-only recipient post a pinned comment and reply to it", async () => {
    const drawing = await createDrawing();
    await shareWithViewer(drawing.id);

    const created = await viewerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token)
      .send({ body: "Should this arrow point left?", x: 120.5, y: -40 });

    expect(created.status).toBe(201);
    expect(created.body.parentId).toBeNull();
    expect(created.body.x).toBe(120.5);
    expect(created.body.y).toBe(-40);
    // The display name comes from the account, not from the request body.
    expect(created.body.authorName).toBe("Viewer User");
    expect(created.body.authorUserId).toBe(viewer.id);

    const reply = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "No, it is correct.", parentId: created.body.id });

    expect(reply.status).toBe(201);
    expect(reply.body.parentId).toBe(created.body.id);

    const list = await request(app)
      .get(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(list.status).toBe(200);
    expect(list.body.comments).toHaveLength(2);
  });

  it("rejects a root comment without finite coordinates", async () => {
    const drawing = await createDrawing();

    const response = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "no pin", x: "12", y: null });

    expect(response.status).toBe(400);
  });

  it("rejects replying to a reply so threads stay one level deep", async () => {
    const drawing = await createDrawing();

    const root = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "root", x: 0, y: 0 });
    const reply = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "reply", parentId: root.body.id });

    const nested = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "nested", parentId: reply.body.id });

    expect(nested.status).toBe(404);
  });

  it("hides comments from users without access to the drawing", async () => {
    const drawing = await createDrawing();

    const list = await request(app)
      .get(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(list.status).toBe(404);

    const outsiderAgent = request.agent(app);
    const outsiderCsrf = await createCsrf(outsiderAgent);
    const post = await outsiderAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .set(outsiderCsrf.name, outsiderCsrf.token)
      .send({ body: "let me in", x: 1, y: 1 });
    expect(post.status).toBe(404);
  });

  it("deletes a thread with its replies, but only for the author or the owner", async () => {
    const drawing = await createDrawing();
    await shareWithViewer(drawing.id);

    const viewerThread = await viewerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token)
      .send({ body: "viewer thread", x: 5, y: 5 });
    await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "owner reply", parentId: viewerThread.body.id });

    const ownerThread = await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "owner thread", x: 9, y: 9 });

    // A viewer cannot delete someone else's comment...
    const forbidden = await viewerAgent
      .delete(`/drawings/${drawing.id}/comments/${ownerThread.body.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token);
    expect(forbidden.status).toBe(403);

    // ...but the drawing owner can moderate any thread on their canvas.
    const deleted = await ownerAgent
      .delete(`/drawings/${drawing.id}/comments/${viewerThread.body.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token);
    expect(deleted.status).toBe(204);

    const remaining = await prisma.drawingComment.findMany({
      where: { drawingId: drawing.id },
      select: { id: true },
    });
    expect(remaining.map((row) => row.id)).toEqual([ownerThread.body.id]);
  });

  it("lets the thread author resolve and unresolve without edit access", async () => {
    const drawing = await createDrawing();
    await shareWithViewer(drawing.id);

    const thread = await viewerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token)
      .send({ body: "please check", x: 1, y: 2 });

    const resolved = await viewerAgent
      .patch(`/drawings/${drawing.id}/comments/${thread.body.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token)
      .send({ resolved: true });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolvedAt).not.toBeNull();

    const reopened = await viewerAgent
      .patch(`/drawings/${drawing.id}/comments/${thread.body.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${viewerToken}`)
      .set(viewerCsrf.name, viewerCsrf.token)
      .send({ resolved: false });
    expect(reopened.status).toBe(200);
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it("removes a drawing's comments when the drawing is deleted", async () => {
    const drawing = await createDrawing();
    await ownerAgent
      .post(`/drawings/${drawing.id}/comments`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.name, ownerCsrf.token)
      .send({ body: "bye", x: 0, y: 0 });

    await prisma.drawing.delete({ where: { id: drawing.id } });

    const remaining = await prisma.drawingComment.count({
      where: { drawingId: drawing.id },
    });
    expect(remaining).toBe(0);
  });
});
