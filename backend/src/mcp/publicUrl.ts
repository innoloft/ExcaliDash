import type express from "express";

const readHeader = (req: express.Request, name: string): string | undefined => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
};

/**
 * Public origin of this ExcaliDash instance: the first FRONTEND_URL entry
 * when configured, otherwise derived from the (proxied) request.
 */
export const resolvePublicBaseUrl = (req: express.Request, publicAppUrl: string | null): string => {
  if (publicAppUrl) return publicAppUrl.replace(/\/+$/, "");
  const proto = readHeader(req, "x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  return `${proto}://${readHeader(req, "host") ?? "localhost"}`;
};
