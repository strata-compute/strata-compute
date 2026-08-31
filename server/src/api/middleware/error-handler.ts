import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.ts";
import type { ApiErrorBody } from "../../types/api.ts";
import { AppError, toAppError } from "../../utils/errors.ts";
import { describeError, logger } from "../../utils/logger.ts";
import { nowIso } from "../../utils/time.ts";

/** Terminal handler: nothing leaves the service except this shape. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const appError = toAppError(error);
  const requestId = res.locals.requestId as string | undefined;

  if (appError.status >= 500) {
    logger.error("unhandled error", {
      requestId,
      path: req.path,
      ...describeError(error),
    });
  }

  /**
   * Which messages survive to the client.
   *
   * Only INTERNAL_ERROR is replaced. It is the code for "something we did not
   * anticipate", and its message is whatever the thrown error happened to
   * say — a stack-adjacent string that can name a table, a file or a driver.
   *
   * The other 5xx codes are ones this service raises deliberately, with
   * messages written to be read by a client. Blanketing every status >= 500
   * turned "Market data temporarily unavailable" into "Internal server
   * error", which is both less useful and less true: it tells a caller the
   * service is broken when it is busy.
   */
  const message =
    appError.code === "INTERNAL_ERROR" && env.isProduction
      ? "Internal server error"
      : appError.message;

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
    meta: { requestId, timestamp: nowIso() },
  };

  res.status(appError.status).json(body);
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound("Route", `${req.method} ${req.path}`));
}
