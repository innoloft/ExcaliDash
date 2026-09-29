import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ExcaliDashClient } from "./apiClient";
import type { PrismaClient } from "../generated/client";
import { MCP_PATH } from "./constants";
import { registerOAuthAuthorizeTokenRoutes } from "./oauth/authorizeTokenRoutes";
import {
  protectedResourceMetadataUrl,
  registerOAuthDiscoveryRoutes,
} from "./oauth/discoveryRoutes";
import { createOAuthSigner } from "./oauth/signing";
import { resolvePublicBaseUrl } from "./publicUrl";
import { registerTools } from "./tools";

const SERVER_INFO = { name: "excalidash", version: "0.1.0" };

type RegisterMcpRoutesDeps = {
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
  /** Signs OAuth client ids and authorization codes. */
  jwtSecret: string;
  /** Public frontend URL (first FRONTEND_URL entry), for editor links. */
  publicAppUrl: string | null;
};

const readHeader = (req: express.Request, name: string): string | undefined => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
};

const jsonRpcError = (res: express.Response, status: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Remote MCP endpoint (Streamable HTTP, stateless). Every request gets a
 * fresh server whose tools call this backend's REST API over loopback with
 * the caller's API key, so the tools are exactly as capable as the key.
 */
export const registerMcpRoutes = (app: express.Express, deps: RegisterMcpRoutesDeps) => {
  const signer = createOAuthSigner(deps.jwtSecret);
  registerOAuthDiscoveryRoutes(app, { signer, publicAppUrl: deps.publicAppUrl });
  registerOAuthAuthorizeTokenRoutes(app, { prisma: deps.prisma, requireAuth: deps.requireAuth, signer });

  // Advertise Bearer auth on every 401, including requireAuth's own, and
  // point OAuth clients (Claude connectors) at the discovery document.
  const challenge: express.RequestHandler = (req, res, next) => {
    const metadataUrl = protectedResourceMetadataUrl(resolvePublicBaseUrl(req, deps.publicAppUrl));
    res.setHeader("WWW-Authenticate", `Bearer realm="excalidash", resource_metadata="${metadataUrl}"`);
    next();
  };
  app.post(MCP_PATH, challenge, deps.requireAuth, async (req, res) => {
    const credential = req.user?.authCredentialType;
    if (credential !== "apiKey" && credential !== "bootstrap") {
      return jsonRpcError(res, 401, "The MCP endpoint requires an ExcaliDash API key as Bearer token");
    }
    res.removeHeader("WWW-Authenticate");
    const apiKey =
      credential === "apiKey" ? readHeader(req, "authorization")!.slice("Bearer ".length) : null;
    // Hand the caller's proxy context to the loopback call so the HTTPS
    // redirect policy treats it like the request that reached us.
    const forwardedProto = readHeader(req, "x-forwarded-proto");
    const api = new ExcaliDashClient({
      baseUrl: `http://127.0.0.1:${req.socket.localPort}`,
      apiKey,
      headers: forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {},
    });

    const server = new McpServer(SERVER_INFO);
    registerTools(server, api, resolvePublicBaseUrl(req, deps.publicAppUrl));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
    }
  });

  // Stateless server: no server-initiated streams and no sessions to end.
  const methodNotAllowed: express.RequestHandler = (_req, res) => {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, "Method not allowed");
  };
  app.get(MCP_PATH, methodNotAllowed);
  app.delete(MCP_PATH, methodNotAllowed);
};
