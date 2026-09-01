import fs from "node:fs";
import pg from "pg";
import { env } from "../config/env.ts";
import { describeError, logger } from "../utils/logger.ts";

/**
 * The Postgres connection pool.
 *
 * No longer optional: Postgres is the source of truth, and a missing
 * DATABASE_URL is a configuration error rather than a cue to run without
 * persistence. Startup validation refuses the process before this is reached.
 */

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (!env.DATABASE_URL) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: sslConfig(),
    /**
     * How long a query waits for a free connection.
     *
     * Five seconds, not ten, because the frontend gives up at eight: a longer
     * wait here means the browser sees a network timeout instead of the
     * controlled "temporarily unavailable" this service is trying to send.
     * Failing inside the caller's patience is what makes the failure legible.
     */
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    /**
     * A ceiling on any single statement.
     *
     * Without one, a query that plans badly holds its connection until it
     * finishes. That is exactly how this pool was starved: a handful of reads
     * running for fifty seconds each, while every other request queued for a
     * connection and timed out at five. Eight seconds is far above a healthy
     * query here and far below the point where one read can take the service
     * down with it.
     */
    statement_timeout: 8_000,
    // a managed pooler recycles connections; do not hold one forever
    maxLifetimeSeconds: 1_800,
  });

  pool.on("error", (error) => {
    logger.error("postgres pool error", describeError(error));
  });

  return pool;
}

/**
 * TLS configuration.
 *
 * With a CA supplied, the server certificate is verified — the correct
 * posture. Without one, the connection is still encrypted but the server is
 * unauthenticated, because Supabase's pooler presents a self-signed chain and
 * strict verification fails outright. That trade-off is logged once at
 * startup rather than left implicit: an operator should know which of the two
 * they are running.
 */
function sslConfig(): pg.ConnectionConfig["ssl"] {
  if (!env.DATABASE_SSL) return undefined;

  if (env.DATABASE_CA_CERT) {
    try {
      return { ca: fs.readFileSync(env.DATABASE_CA_CERT, "utf8"), rejectUnauthorized: true };
    } catch (error) {
      // Refusing here would take down a working service over a certificate
      // path; downgrading silently would hide it. Warn loudly and encrypt.
      logger.warn("DATABASE_CA_CERT could not be read — TLS will not verify the server", {
        ...describeError(error),
      });
    }
  }

  return { rejectUnauthorized: false };
}

export interface DatabaseHealth {
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  detail?: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const active = getPool();
  if (!active) {
    return {
      configured: false,
      connected: false,
      latencyMs: null,
      detail: "DATABASE_URL is not set",
    };
  }

  const started = performance.now();
  try {
    await active.query("SELECT 1");
    return {
      configured: true,
      connected: true,
      latencyMs: Number((performance.now() - started).toFixed(2)),
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      latencyMs: null,
      // The driver puts host and user into some error messages. Health is a
      // public endpoint, so the detail is reduced to a code and a category
      // rather than echoed.
      detail: redactConnectionDetail(error),
    };
  }
}

/**
 * A failure reason safe to publish.
 *
 * `pg` embeds the host, port and sometimes the user in its messages, and the
 * health endpoint is unauthenticated. What an operator needs is the category
 * of failure, which the code already carries.
 */
function redactConnectionDetail(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "database host could not be resolved";
    case "ECONNREFUSED":
      return "database refused the connection";
    case "ETIMEDOUT":
    case "ECONNRESET":
      return "database connection timed out";
    case "28P01":
      return "database rejected the credentials";
    case "3D000":
      return "database does not exist";
    case "53300":
      return "database connection limit reached";
    default:
      return code ? `database error ${code}` : "database connection failed";
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
