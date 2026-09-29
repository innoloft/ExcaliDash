import express from "express";
import { DEFAULT_API_KEY_SCOPES } from "../../auth/apiKeys";
import { MCP_PATH, OAUTH_REGISTER_PATH, OAUTH_TOKEN_PATH } from "../constants";
import { resolvePublicBaseUrl } from "../publicUrl";
import { CLIENT_PURPOSE, isAllowedRedirectUri } from "./authorizationRequest";
import type { OAuthSigner } from "./signing";

/** The consent page is a frontend route; the backend is served under /api. */
const AUTHORIZE_PAGE_PATH = "/oauth/authorize";

export const protectedResourceMetadataUrl = (baseUrl: string) =>
  `${baseUrl}/.well-known/oauth-protected-resource${MCP_PATH}`;

type Deps = { signer: OAuthSigner; publicAppUrl: string | null };

/**
 * OAuth discovery (RFC 9728, RFC 8414) and dynamic client registration
 * (RFC 7591) for the MCP endpoint, as expected by Claude's connectors.
 */
export const registerOAuthDiscoveryRoutes = (app: express.Express, deps: Deps) => {
  const baseUrl = (req: express.Request) => resolvePublicBaseUrl(req, deps.publicAppUrl);

  const protectedResource: express.RequestHandler = (req, res) => {
    const base = baseUrl(req);
    res.json({
      resource: `${base}${MCP_PATH}`,
      authorization_servers: [base],
      scopes_supported: [...DEFAULT_API_KEY_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "ExcaliDash",
    });
  };
  app.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, protectedResource);
  app.get("/.well-known/oauth-protected-resource", protectedResource);

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = baseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}${AUTHORIZE_PAGE_PATH}`,
      token_endpoint: `${base}/api${OAUTH_TOKEN_PATH}`,
      registration_endpoint: `${base}/api${OAUTH_REGISTER_PATH}`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...DEFAULT_API_KEY_SCOPES],
    });
  });

  // Registration is stateless: the client id is a signed copy of the
  // client's metadata, so nothing is stored until a user approves.
  app.post(OAUTH_REGISTER_PATH, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirectUris.length === 0 || redirectUris.length > 5 || !redirectUris.every(isAllowedRedirectUri)) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "Only Claude and loopback (localhost) redirect URIs are allowed",
      });
    }
    // Every client is registered as a public client (PKCE, no secret),
    // whatever auth method it asked for; the response says so (RFC 7591 §3.2.1).
    const name =
      typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim().slice(0, 60)
        : "MCP client";
    const issuedAt = Math.floor(Date.now() / 1000);
    const clientId = deps.signer.sign(CLIENT_PURPOSE, { r: redirectUris, n: name, iat: issuedAt });
    return res.status(201).json({
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });
};
