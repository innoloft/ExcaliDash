import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../generated/client";
import { config } from "../config";
import { getTestPrisma, setupTestDb } from "./testUtils";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const userAgent = "vitest-mcp-oauth";
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto
  .createHash("sha256")
  .update(verifier)
  .digest("base64url");

describe("MCP OAuth connector flow", () => {
  let prisma: PrismaClient;
  let app: any;
  let user: { id: string; email: string };
  let session: string;
  let agent: any;
  let csrf: { header: string; token: string };
  let clientId: string;

  const authorizeParams = (overrides: Record<string, string> = {}) => ({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    ...overrides,
  });

  const decide = (
    decision: "approve" | "deny",
    overrides: Record<string, string> = {},
  ) =>
    agent
      .post("/oauth/authorize")
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${session}`)
      .set(csrf.header, csrf.token)
      .send({ ...authorizeParams(overrides), decision });

  const approveForCode = async () => {
    const response = await decide("approve");
    expect(response.status).toBe(200);
    const redirect = new URL(response.body.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(redirect.searchParams.get("state")).toBe("state-123");
    return redirect.searchParams.get("code")!;
  };

  const exchange = (code: string, codeVerifier = verifier) =>
    request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: CLAUDE_CALLBACK,
    });

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true },
      create: { id: "default", authEnabled: true },
    });
    user = await prisma.user.create({
      data: {
        email: "oauth-user@test.local",
        passwordHash: "x",
        name: "OAuth User",
      },
      select: { id: true, email: true },
    });
    session = jwt.sign(
      { userId: user.id, email: user.email, type: "access" },
      config.jwtSecret,
      {
        expiresIn: "15m",
      },
    );
    agent = request.agent(app);
    const csrfResponse = await agent
      .get("/csrf-token")
      .set("User-Agent", userAgent);
    csrf = { header: csrfResponse.body.header, token: csrfResponse.body.token };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("points unauthenticated MCP clients at the OAuth metadata", async () => {
    // Supertest binds a new port per request; pin the host so derived URLs agree.
    const host = "excalidash.test";
    const unauthorized = await request(app)
      .post("/mcp")
      .set("Host", host)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(unauthorized.status).toBe(401);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(
      unauthorized.headers["www-authenticate"],
    )?.[1];
    expect(metadataUrl).toMatch(
      /\/\.well-known\/oauth-protected-resource\/mcp$/,
    );

    expect(metadataUrl).toBe(
      `http://${host}/.well-known/oauth-protected-resource/mcp`,
    );
    const resource = await request(app)
      .get(new URL(metadataUrl!).pathname)
      .set("Host", host);
    expect(resource.body.resource).toMatch(/\/mcp$/);

    const server = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .set("Host", host);
    expect(server.body).toMatchObject({
      issuer: resource.body.authorization_servers[0],
      code_challenge_methods_supported: ["S256"],
    });
    expect(server.body.authorization_endpoint).toBe(
      `${server.body.issuer}/oauth/authorize`,
    );
    expect(server.body.token_endpoint).toBe(
      `${server.body.issuer}/api/oauth/token`,
    );
  });

  it("registers only Claude and loopback redirect URIs", async () => {
    const rejected = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Evil",
        redirect_uris: ["https://evil.example/callback"],
      });
    expect(rejected.status).toBe(400);

    const registered = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Claude",
        redirect_uris: [CLAUDE_CALLBACK],
        token_endpoint_auth_method: "none",
      });
    expect(registered.status).toBe(201);
    clientId = registered.body.client_id;

    const loopback = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["http://localhost:53682/callback"],
        token_endpoint_auth_method: "client_secret_post",
      });
    expect(loopback.status).toBe(201);
    expect(loopback.body.token_endpoint_auth_method).toBe("none");
    expect(loopback.body.client_secret).toBeUndefined();
  });

  it("shows the consent details only to a signed-in user", async () => {
    const anonymous = await request(app)
      .get("/oauth/authorize")
      .query(authorizeParams());
    expect(anonymous.status).toBe(401);

    const details = await request(app)
      .get("/oauth/authorize")
      .set("Authorization", `Bearer ${session}`)
      .query(authorizeParams());
    expect(details.status).toBe(200);
    expect(details.body).toMatchObject({
      clientName: "Claude",
      redirectOrigin: "https://claude.ai",
      user: { email: "oauth-user@test.local" },
    });

    const wrongRedirect = await request(app)
      .get("/oauth/authorize")
      .set("Authorization", `Bearer ${session}`)
      .query(authorizeParams({ redirect_uri: "http://localhost:1/cb" }));
    expect(wrongRedirect.status).toBe(400);

    const tampered = await request(app)
      .get("/oauth/authorize")
      .set("Authorization", `Bearer ${session}`)
      .query(authorizeParams({ client_id: `${clientId}x` }));
    expect(tampered.body.error).toBe("invalid_client");
  });

  it("requires CSRF protection on the consent decision", async () => {
    const response = await request(app)
      .post("/oauth/authorize")
      .set("User-Agent", "no-csrf-token")
      .set("Authorization", `Bearer ${session}`)
      .send({ ...authorizeParams(), decision: "approve" });
    expect(response.status).toBe(403);
  });

  it("returns access_denied when the user declines", async () => {
    const response = await decide("deny");
    const redirect = new URL(response.body.redirectTo);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("exchanges an approved code once, with PKCE, for a working API key", async () => {
    const code = await approveForCode();
    expect((await exchange(code, "x".repeat(43))).body.error).toBe(
      "invalid_grant",
    );

    const token = await exchange(code);
    expect(token.status).toBe(200);
    expect(token.body).toMatchObject({ token_type: "Bearer" });
    expect(token.body.access_token).toMatch(/^exd_/);
    expect(token.body.expires_in).toBeUndefined();

    const replay = await exchange(code);
    expect(replay.body.error).toBe("invalid_grant");

    const keys = await prisma.apiKey.findMany({ where: { userId: user.id } });
    expect(keys.map((key) => key.name)).toEqual(["Claude (OAuth)"]);

    const tools = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(tools.status).toBe(200);
    expect(tools.body.result.tools).toHaveLength(4);
  });
});
