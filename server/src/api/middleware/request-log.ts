import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger.ts";

/** One structured line per request, emitted on completion. */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();

  res.on("finish", () => {
    const durationMs = Number((performance.now() - started).toFixed(2));
    const context = {
      requestId: res.locals.requestId as string | undefined,
      method: req.method,
      path: req.route?.path ? req.baseUrl + req.route.path : req.path,
      status: res.statusCode,
      durationMs,
    };
    if (res.statusCode >= 500) logger.error("request failed", context);
    else if (res.statusCode >= 400) logger.warn("request rejected", context);
    else logger.info("request", context);
  });

  next();
}
