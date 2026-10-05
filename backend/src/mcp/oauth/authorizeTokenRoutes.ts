import crypto from "crypto";
import express from "express";
import type { PrismaClient } from "../../generated/client";
import {
  DEFAULT_API_KEY_SCOPES,
  generateApiKey,
  serializeApiKeyScopes,
} from "../../auth/apiKeys";
import { logAuditEvent } from "../../utils/audit";
import {
  AuthorizationRequestError,
  buildRedirect,
  parseAuthorizationRequest,
  readClient,
} from "./authorizationRequest";
import { OAUTH_AUTHORIZE_API_PATH, OAUTH_TOKEN_PATH } from "../constants";
import { sha256Base64Url, type OAuthSigner } from "./signing";

const CODE_PURPOSE = "code";
const CODE_TTL_SECONDS = 300;

type Deps = {
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
  signer: OAuthSigner;
};

type CodePayload = {
  u: string; // user id
  c: string; // sha256(client_id)
  ru: string; // redirect_uri
  cc: string; // PKCE code_challenge (S256)
  n: string; // client name, for the API key's label
  j: string; // code id, for single use
  exp: number;
};

const tokenError = (res: express.Response, status: number, error: string, description: string) =>
  res.status(status).json({ error, error_description: description });

/**
 * Authorization-code flow for the MCP connector. The access token handed to
 * the client is an ordinary, non-expiring ExcaliDash API key, so the MCP
 * endpoint needs no new token type and users revoke access under
 * Settings → API Keys.
 */
export const registerOAuthAuthorizeTokenRoutes = (app: express.Express, deps: Deps) => {
  const { prisma, requireAuth, signer } = deps;

  // Codes are single use. Remembering spent ids in memory is enough for a
  // single backend instance; PKCE already binds a code to the client that
  // started the flow.
  const spentCodes = new Map<string, number>();
  const spendCode = (id: string, exp: number): boolean => {
    const now = Date.now();
    for (const [key, expiresAt] of spentCodes) if (expiresAt < now) spentCodes.delete(key);
    if (spentCodes.has(id)) return false;
    spentCodes.set(id, exp * 1000);
    return true;
  };

  const ensureInteractiveUser = (req: express.Request, res: express.Response): boolean => {
    const user = req.user;
    const credential = user?.authCredentialType;
    if (!user || (credential !== "jwt" && credential !== "bootstrap")) {
      res.status(401).json({ error: "unauthorized", error_description: "Sign in to ExcaliDash first" });
      return false;
    }
    if (user.impersonatorId) {
      res.status(403).json({
        error: "access_denied",
        error_description: "Connecting apps is not allowed while impersonating",
      });
      return false;
    }
    return true;
  };

  const withRequest = (
    req: express.Request,
    res: express.Response,
    params: Record<string, unknown>,
  ) => {
    try {
      return parseAuthorizationRequest(signer, params);
    } catch (error) {
      if (!(error instanceof AuthorizationRequestError)) throw error;
      res.status(400).json({ error: error.error, error_description: error.message });
      return null;
    }
  };

  // What the consent page shows before the user decides.
  app.get(OAUTH_AUTHORIZE_API_PATH, requireAuth, (req, res) => {
    if (!ensureInteractiveUser(req, res)) return;
    const request = withRequest(req, res, req.query as Record<string, unknown>);
    if (!request) return;
    res.json({
      clientName: request.client.name,
      redirectOrigin: new URL(request.redirectUri).origin,
      scopes: [...DEFAULT_API_KEY_SCOPES],
      user: { name: req.user!.name, email: req.user!.email },
    });
  });

  // The user's decision. Cookie-authenticated, so the global CSRF check applies.
  app.post(OAUTH_AUTHORIZE_API_PATH, requireAuth, (req, res) => {
    if (!ensureInteractiveUser(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = withRequest(req, res, body);
    if (!request) return;

    if (body.decision !== "approve") {
      return res.json({
        redirectTo: buildRedirect(request.redirectUri, {
          error: "access_denied",
          error_description: "The user declined access",
          state: request.state,
        }),
      });
    }
    const code = signer.sign(CODE_PURPOSE, {
      u: req.user!.id,
      c: sha256Base64Url(request.client.clientId),
      ru: request.redirectUri,
      cc: request.codeChallenge,
      n: request.client.name,
      j: crypto.randomBytes(12).toString("base64url"),
      exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
    } satisfies CodePayload);
    return res.json({ redirectTo: buildRedirect(request.redirectUri, { code, state: request.state }) });
  });

  app.post(OAUTH_TOKEN_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.grant_type !== "authorization_code") {
      return tokenError(res, 400, "unsupported_grant_type", "Only authorization_code is supported");
    }
    const client = readClient(signer, body.client_id);
    if (!client) return tokenError(res, 401, "invalid_client", "Unknown client");

    const code = signer.verify<CodePayload>(CODE_PURPOSE, body.code);
    const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    if (
      !code ||
      code.c !== sha256Base64Url(client.clientId) ||
      code.ru !== body.redirect_uri ||
      !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) ||
      sha256Base64Url(verifier) !== code.cc
    ) {
      return tokenError(res, 400, "invalid_grant", "The authorization code is invalid or expired");
    }
    if (!spendCode(code.j, code.exp)) {
      return tokenError(res, 400, "invalid_grant", "The authorization code was already used");
    }

    const user = await prisma.user.findUnique({
      where: { id: code.u },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) {
      return tokenError(res, 400, "invalid_grant", "The account is no longer active");
    }

    const generated = generateApiKey();
    const scopes = [...DEFAULT_API_KEY_SCOPES];
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: `${code.n} (OAuth)`.slice(0, 100),
        keyId: generated.keyId,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: serializeApiKeyScopes(scopes),
      },
      select: { id: true },
    });
    await logAuditEvent({
      userId: user.id,
      action: "api_key_created",
      resource: `api_key:${apiKey.id}`,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });

    return res.json({ access_token: generated.token, token_type: "Bearer", scope: scopes.join(" ") });
  });
};
