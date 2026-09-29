import crypto from "crypto";

/**
 * Compact HMAC-signed tokens for the MCP OAuth flow (client ids and
 * authorization codes), so the flow needs no database tables. Keys are
 * derived from JWT_SECRET per purpose, so a token of one kind never
 * verifies as another — nor as a session JWT.
 */
export type OAuthSigner = {
  sign(purpose: string, payload: Record<string, unknown>): string;
  verify<T extends Record<string, unknown>>(purpose: string, token: unknown): T | null;
};

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export const createOAuthSigner = (secret: string): OAuthSigner => {
  const keyFor = (purpose: string) =>
    crypto.createHmac("sha256", secret).update(`excalidash-mcp-oauth:${purpose}`).digest();
  const mac = (purpose: string, body: string) =>
    crypto.createHmac("sha256", keyFor(purpose)).update(body).digest();

  return {
    sign(purpose, payload) {
      const body = b64url(JSON.stringify(payload));
      return `${body}.${b64url(mac(purpose, body))}`;
    },
    verify<T extends Record<string, unknown>>(purpose: string, token: unknown): T | null {
      if (typeof token !== "string" || token.length > 4096) return null;
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined) return null;
      const expected = mac(purpose, body);
      const given = Buffer.from(signature, "base64url");
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (typeof payload !== "object" || payload === null) return null;
        if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
        return payload as T;
      } catch {
        return null;
      }
    },
  };
};

export const sha256Base64Url = (value: string) =>
  crypto.createHash("sha256").update(value).digest("base64url");
