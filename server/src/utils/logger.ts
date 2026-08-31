import { env } from "../config/env.ts";

/**
 * Structured JSON logging. Every line carries a context object so provider,
 * asset, job and computation can be filtered downstream.
 *
 * Secrets never reach here: context keys that look like credentials are
 * redacted before serialisation.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT = /(key|token|secret|password|authorization|credential|dsn|connection)/i;

export interface LogContext {
  provider?: string;
  asset?: string;
  job?: string;
  computation?: string;
  requestId?: string;
  durationMs?: number;
  count?: number;
  [key: string]: unknown;
}

function sanitize(context: LogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    out[key] = REDACT.test(key) ? "[redacted]" : value;
  }
  return out;
}

/**
 * Values that must never appear in a log line, read lazily.
 *
 * Deliberately not imported from `utils/secrets.ts`: that module reads the
 * validated env, and env's own loader logs. Importing it here would close a
 * cycle. Reading `process.env` directly is the one place in the codebase that
 * is justified, because this runs beneath the layer that validates it.
 */
let secretCache: string[] | null = null;

function secrets(): string[] {
  if (secretCache) return secretCache;
  const found = new Set<string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DSN|DATABASE_URL)/i.test(name)) continue;
    if (typeof value !== "string" || value.length < 8) continue;
    found.add(value);
    try {
      const password = new URL(value).password;
      if (password.length >= 8) found.add(decodeURIComponent(password));
    } catch {
      // not a URL; the raw value is already recorded
    }
  }
  secretCache = [...found].sort((a, b) => b.length - a.length);
  return secretCache;
}

function scrubSecrets(line: string): string {
  let out = line;
  for (const secret of secrets()) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function emit(level: LogLevel, message: string, context: LogContext = {}) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) return;

  // `sanitize` redacts by key, which covers anything this codebase chooses to
  // log. A credential can also arrive inside a value we did not author — a
  // provider quoting our key back in an error string — so the finished line
  // is scrubbed by value as well. Two different failures, two defences.
  const line = scrubSecrets(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...sanitize(context),
  }));

  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bound: LogContext): Logger;
}

export function createLogger(bound: LogContext = {}): Logger {
  return {
    debug: (m, c) => emit("debug", m, { ...bound, ...c }),
    info: (m, c) => emit("info", m, { ...bound, ...c }),
    warn: (m, c) => emit("warn", m, { ...bound, ...c }),
    error: (m, c) => emit("error", m, { ...bound, ...c }),
    child: (extra) => createLogger({ ...bound, ...extra }),
  };
}

export const logger = createLogger();

/** Turns an unknown thrown value into a loggable shape; stacks stay out of production logs. */
export function describeError(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      err: error.message,
      errName: error.name,
      ...(env.isProduction ? {} : { stack: error.stack }),
    };
  }
  return { err: String(error) };
}
