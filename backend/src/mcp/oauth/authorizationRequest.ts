import type { OAuthSigner } from "./signing";

export const CLIENT_PURPOSE = "client";

/** Where Claude (claude.ai, Claude Desktop) sends users back after consent. */
const CLAUDE_REDIRECT_URIS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Only Claude's hosted callback and loopback callbacks (native apps such as
 * Claude Code, RFC 8252) may receive codes, so a third-party site cannot
 * register itself as a client.
 */
export const isAllowedRedirectUri = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 512) return false;
  if (CLAUDE_REDIRECT_URIS.has(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
};

export type RegisteredClient = {
  clientId: string;
  name: string;
  redirectUris: string[];
};

export const readClient = (
  signer: OAuthSigner,
  clientId: unknown,
): RegisteredClient | null => {
  const payload = signer.verify<{ r?: unknown; n?: unknown }>(
    CLIENT_PURPOSE,
    clientId,
  );
  if (!payload || !Array.isArray(payload.r) || typeof payload.n !== "string")
    return null;
  const redirectUris = payload.r.filter(isAllowedRedirectUri);
  if (redirectUris.length === 0) return null;
  return { clientId: clientId as string, name: payload.n, redirectUris };
};

export type AuthorizationRequest = {
  client: RegisteredClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
};

export class AuthorizationRequestError extends Error {
  constructor(
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Validate an authorization request. Errors are shown to the user rather
 * than redirected, so a bad request never bounces anywhere unverified.
 */
export const parseAuthorizationRequest = (
  signer: OAuthSigner,
  params: Record<string, unknown>,
): AuthorizationRequest => {
  const client = readClient(signer, params.client_id);
  if (!client) {
    throw new AuthorizationRequestError(
      "invalid_client",
      "Unknown client. Remove and re-add the connector.",
    );
  }
  const redirectUri = str(params.redirect_uri);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    throw new AuthorizationRequestError(
      "invalid_request",
      "redirect_uri does not match the registered client",
    );
  }
  if (params.response_type !== "code") {
    throw new AuthorizationRequestError(
      "unsupported_response_type",
      "Only response_type=code is supported",
    );
  }
  const codeChallenge = str(params.code_challenge);
  if (!codeChallenge || !/^[A-Za-z0-9\-._~]{43,128}$/.test(codeChallenge)) {
    throw new AuthorizationRequestError(
      "invalid_request",
      "A PKCE code_challenge is required",
    );
  }
  if (params.code_challenge_method !== "S256") {
    throw new AuthorizationRequestError(
      "invalid_request",
      "code_challenge_method must be S256",
    );
  }
  const state = str(params.state);
  if (state && state.length > 1024) {
    throw new AuthorizationRequestError("invalid_request", "state is too long");
  }
  return { client, redirectUri, codeChallenge, state };
};

export const buildRedirect = (
  redirectUri: string,
  params: Record<string, string | null>,
): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
};
