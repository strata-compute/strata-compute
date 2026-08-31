import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Correlates a request across logs and response metadata. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
