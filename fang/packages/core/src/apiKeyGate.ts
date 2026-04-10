import type { RequestHandler } from "express";

/**
 * Extract Bearer or X-Api-Key from an Express request.
 */
export function extractApiKeyFromRequest(req: {
  headers: { authorization?: string; "x-api-key"?: string | string[] };
}): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim() || undefined;
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string") return x.trim() || undefined;
  if (Array.isArray(x) && x[0]) return String(x[0]).trim() || undefined;
  return undefined;
}

/**
 * When `expectedKey` is set, reject requests without a matching API key (401 JSON).
 * When unset, no-op (next).
 */
export function apiKeyGate(expectedKey: string | undefined): RequestHandler {
  if (!expectedKey) {
    return (_req, _res, next) => {
      next();
    };
  }

  return (req, res, next) => {
    const token = extractApiKeyFromRequest(req);
    if (token === expectedKey) {
      next();
      return;
    }
    res.status(401).json({
      error: "Unauthorized",
      message:
        "Invalid or missing API key. Send Authorization: Bearer <key> or X-Api-Key.",
    });
  };
}
