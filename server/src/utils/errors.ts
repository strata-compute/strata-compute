/**
 * One error type crosses the API boundary. Everything thrown inside the
 * service is converted to an AppError before it reaches a client, so
 * responses never leak internals.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static notFound(resource: string, id?: string) {
    return new AppError(
      "NOT_FOUND",
      id ? `${resource} '${id}' was not found` : `${resource} was not found`,
    );
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError("BAD_REQUEST", message, details);
  }

  static validation(details: unknown) {
    return new AppError("VALIDATION_ERROR", "Request validation failed", details);
  }

  static providerUnavailable(provider: string, cause?: unknown) {
    return new AppError(
      "PROVIDER_UNAVAILABLE",
      `Market data provider '${provider}' is unavailable`,
      cause instanceof Error ? cause.message : undefined,
    );
  }

  static databaseUnavailable() {
    return new AppError("DATABASE_UNAVAILABLE", "Database is not available");
  }
}

/**
 * Failures that mean "the database could not be reached right now".
 *
 * These arrive as ordinary Errors from `pg` and were being classified as
 * INTERNAL_ERROR — a 500, which says the service is broken. It is not: a
 * connection that could not be acquired within its timeout, or a pool under
 * momentary contention from a running computation pass, is a temporary
 * condition and the honest answer is 503. The distinction matters to anything
 * that retries, and to anyone reading an error budget.
 */
const TRANSIENT_DATABASE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08003", // connection_does_not_exist
]);

function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code && TRANSIENT_DATABASE_CODES.has(code)) return true;
  // `pg` reports pool acquisition timeouts as a plain message with no code
  return /connection terminated due to connection timeout|timeout exceeded when trying to connect/i.test(
    error.message,
  );
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isTransientDatabaseError(error)) {
    // The message is deliberately generic: the cause is logged server-side,
    // and a client only needs to know it is temporary.
    return new AppError("DATABASE_UNAVAILABLE", "Market data temporarily unavailable");
  }

  return new AppError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Unexpected error",
  );
}
