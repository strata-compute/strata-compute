import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../../utils/errors.ts";

/**
 * Query and param validation. Parsed output replaces the raw input on
 * `res.locals`, so handlers work with typed values and never re-parse.
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(AppError.validation(result.error.issues.map(issueOf)));
      return;
    }
    res.locals.query = result.data;
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(AppError.validation(result.error.issues.map(issueOf)));
      return;
    }
    res.locals.params = result.data;
    next();
  };
}

function issueOf(issue: { path: PropertyKey[]; message: string }) {
  return { field: issue.path.join(".") || "(root)", message: issue.message };
}

/** Typed accessors so handlers avoid casting at every call site. */
export function query<T>(res: Response): T {
  return res.locals.query as T;
}

export function params<T>(res: Response): T {
  return res.locals.params as T;
}
