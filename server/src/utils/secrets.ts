import { env } from "../config/env.ts";

/**
 * SECRET SCRUBBING
 *
 * The logger redacts by key name, which handles anything this codebase puts
 * into a log context deliberately. It cannot handle a secret arriving inside
 * a *value* — and providers do exactly that. Alpha Vantage answers a
 * throttled request with prose containing the caller's own API key:
 *
 *   "We have detected your API key as <key> and our standard API rate
 *    limit is 25 requests per day..."
 *
 * That string was stored as the provider's last error and served verbatim
 * through /api/health. A credential reached a public endpoint without any
 * code ever deciding to put it there, which is precisely why scrubbing by key
 * name is not enough on its own.
 *
 * So this scrubs by value: whatever the configured credentials actually are,
 * they are removed from any provider-supplied text before it is stored,
 * logged or served. It is deliberately indiscriminate — it does not need to
 * know which provider echoed what.
 */

/** Env names whose values must never appear in output. */
const CREDENTIAL_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DSN|DATABASE_URL)/i;

/**
 * Short values are excluded. A three-character secret would match constantly
 * in ordinary text and turn every message into redaction noise, which hides
 * more than it protects.
 */
const MINIMUM_LENGTH = 8;

let cached: string[] | null = null;

function secretValues(): string[] {
  if (cached) return cached;

  const values = new Set<string>();
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    if (!CREDENTIAL_NAME.test(name)) continue;
    if (typeof value !== "string") continue;
    if (value.length < MINIMUM_LENGTH) continue;
    values.add(value);

    // A connection string carries its password as one component; the whole
    // URL rarely appears in provider text, but the password can.
    const password = passwordOf(value);
    if (password && password.length >= MINIMUM_LENGTH) values.add(password);
  }

  // longest first, so a value containing another is replaced whole
  cached = [...values].sort((a, b) => b.length - a.length);
  return cached;
}

function passwordOf(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.password ? decodeURIComponent(url.password) : null;
  } catch {
    return null;
  }
}

/** Replaces every configured credential found in `text` with a marker. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of secretValues()) {
    if (!out.includes(secret)) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Test seam: env is read once, so a changed environment needs a reset. */
export function __resetSecretCache(): void {
  cached = null;
}
