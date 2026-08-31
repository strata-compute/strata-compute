import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.ts";

/**
 * Origin allowlist from configuration. Kept deliberately small: the API is
 * read-only and unauthenticated, so there are no credentials to protect, but
 * the allowlist still keeps the surface explicit.
 */
export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");
  const allowAll = env.corsOrigins.includes("*");

  if (origin && (allowAll || env.corsOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (allowAll) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-request-id");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
