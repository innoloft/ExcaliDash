import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri } from "./authorizationRequest";
import { createOAuthSigner } from "./signing";

describe("isAllowedRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:53682/callback",
    "http://127.0.0.1:9999/cb",
    "http://[::1]:8080/cb",
  ])("allows %s", (uri) => expect(isAllowedRedirectUri(uri)).toBe(true));

  it.each([
    "https://claude.ai/api/mcp/auth_callback/../evil",
    "https://evil.example/api/mcp/auth_callback",
    "https://localhost/callback",
    "http://localhost.evil.example/cb",
    "http://user:pw@localhost/cb",
    "http://localhost/cb#fragment",
    "javascript:alert(1)",
    42,
  ])("rejects %s", (uri) => expect(isAllowedRedirectUri(uri)).toBe(false));
});

describe("createOAuthSigner", () => {
  const signer = createOAuthSigner("secret");

  it("round-trips payloads for the same purpose only", () => {
    const token = signer.sign("code", { u: "user-1" });
    expect(signer.verify("code", token)).toEqual({ u: "user-1" });
    expect(signer.verify("client", token)).toBeNull();
    expect(createOAuthSigner("other").verify("code", token)).toBeNull();
  });

  it("rejects tampered and expired tokens", () => {
    const [, signature] = signer.sign("code", { u: "user-1" }).split(".");
    const forged = `${Buffer.from(JSON.stringify({ u: "admin" })).toString("base64url")}.${signature}`;
    expect(signer.verify("code", forged)).toBeNull();
    const expired = signer.sign("code", { u: "user-1", exp: Math.floor(Date.now() / 1000) - 1 });
    expect(signer.verify("code", expired)).toBeNull();
  });
});
