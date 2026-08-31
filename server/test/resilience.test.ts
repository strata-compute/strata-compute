import assert from "node:assert/strict";
import { toAppError } from "../src/utils/errors.ts";
import { scrubSecrets } from "../src/utils/secrets.ts";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import { HttpClient, ProviderHttpError } from "../src/providers/http/client.ts";
import {
  RateLimiter,
  RateLimitExceededError,
} from "../src/providers/http/rate-limiter.ts";

/**
 * Resilience behaviour, exercised against a local server rather than a live
 * provider: retries, backoff, throttle detection and quota enforcement have
 * to be testable without burning a real rate limit.
 */

function startServer(handler: (url: string, count: number) => { status: number; body: unknown }) {
  let count = 0;
  const server = createServer((req, res) => {
    count += 1;
    const { status, body } = handler(req.url ?? "/", count);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise<{ server: Server; port: number; calls: () => number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, calls: () => count });
    });
  });
}

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

describe("http client resilience", () => {
  it("retries a 500 and succeeds on a later attempt", async () => {
    const { server, port, calls } = await startServer((_url, count) =>
      count < 3 ? { status: 500, body: { error: "boom" } } : { status: 200, body: { ok: true } },
    );
    servers.push(server);

    const client = new HttpClient({
      provider: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimit: { perSecond: 100 },
      maxRetries: 3,
    });

    const result = await client.get<{ ok: boolean }>("/retry");
    assert.equal(result.ok, true);
    assert.equal(calls(), 3);
  });

  it("gives up after the retry budget and reports the status", async () => {
    const { server, port } = await startServer(() => ({ status: 503, body: { error: "down" } }));
    servers.push(server);

    const client = new HttpClient({
      provider: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimit: { perSecond: 100 },
      maxRetries: 1,
    });

    await assert.rejects(
      () => client.get("/always-down"),
      (error: unknown) => {
        assert.ok(error instanceof ProviderHttpError);
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });

  it("does not retry a 404 — it is not a transient failure", async () => {
    const { server, port, calls } = await startServer(() => ({
      status: 404,
      body: { error: "missing" },
    }));
    servers.push(server);

    const client = new HttpClient({
      provider: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimit: { perSecond: 100 },
      maxRetries: 3,
    });

    await assert.rejects(() => client.get("/missing"));
    assert.equal(calls(), 1);
  });

  it("treats a 200 body that says 'rate limited' as a throttle", async () => {
    const { server, port } = await startServer(() => ({
      status: 200,
      body: { Information: "Please consider spreading out your free API requests" },
    }));
    servers.push(server);

    const client = new HttpClient({
      provider: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimit: { perSecond: 100 },
      maxRetries: 0,
      detectThrottle: (body) =>
        (body as { Information?: string })?.Information ? "throttled" : null,
    });

    await assert.rejects(
      () => client.get("/throttled"),
      (error: unknown) => {
        assert.ok(error instanceof ProviderHttpError);
        assert.match(error.message, /rate limited/);
        return true;
      },
    );
  });

  it("reports failure state for the health endpoint", async () => {
    const { server, port } = await startServer(() => ({ status: 500, body: {} }));
    servers.push(server);

    const client = new HttpClient({
      provider: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimit: { perSecond: 100 },
      maxRetries: 0,
    });

    await assert.rejects(() => client.get("/fail"));
    const health = client.health();
    assert.equal(health.consecutiveFailures, 1);
    assert.ok(health.lastError);
    assert.ok(health.lastErrorAt);
  });
});

describe("rate limiter", () => {
  it("spaces calls to the configured interval", async () => {
    const limiter = new RateLimiter({ provider: "test", perSecond: 20 }); // 50ms apart
    const started = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // two gaps of 50ms; allow scheduler slack
    assert.ok(Date.now() - started >= 80, "calls were not spaced");
  });

  it("refuses once the daily quota is spent, and says when it resets", async () => {
    const limiter = new RateLimiter({ provider: "alpha_vantage", perSecond: 1000, perDay: 2 });
    await limiter.acquire();
    await limiter.acquire();

    await assert.rejects(
      () => limiter.acquire(),
      (error: unknown) => {
        assert.ok(error instanceof RateLimitExceededError);
        assert.match(error.message, /Daily quota of 2/);
        return true;
      },
    );
    assert.equal(limiter.remainingToday, 0);
  });

  it("keeps serving other callers after one is refused", async () => {
    const limiter = new RateLimiter({ provider: "test", perSecond: 1000, perDay: 1 });
    await limiter.acquire();
    await assert.rejects(() => limiter.acquire());
    // the chain must not be poisoned by the rejection
    await assert.rejects(() => limiter.acquire());
    assert.equal(limiter.snapshot().remainingToday, 0);
  });

  it("reports quota state without a network call", () => {
    const limiter = new RateLimiter({ provider: "test", perSecond: 1, perDay: 25 });
    const snapshot = limiter.snapshot();
    assert.equal(snapshot.perDay, 25);
    assert.equal(snapshot.remainingToday, 25);
    assert.ok(snapshot.resetsAt);
  });
});

/* ------------------------------------------------------ secret scrubbing -- */

/**
 * A credential reached /api/health without any code deciding to put it there.
 *
 * Alpha Vantage answers a throttled request with prose quoting the caller's
 * own API key. That message was stored as the provider's last error and
 * served verbatim. Key-based redaction could not catch it — the secret was
 * inside a value, not under a key that looked like one.
 */
describe("secret scrubbing", () => {
  it("removes a credential a provider quoted back at us", () => {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key || key.length < 8) {
      // nothing configured to leak; the scrubber has nothing to prove here
      assert.equal(scrubSecrets("no secrets configured"), "no secrets configured");
      return;
    }

    const message = `We have detected your API key as ${key} and our standard API rate limit is 25 requests per day.`;
    const scrubbed = scrubSecrets(message);

    assert.ok(!scrubbed.includes(key), "the API key survived scrubbing");
    assert.match(scrubbed, /\[redacted\]/);
    assert.match(scrubbed, /rate limit is 25 requests per day/, "the useful part was destroyed");
  });

  it("removes a database password without destroying the message", () => {
    const url = process.env.DATABASE_URL;
    if (!url) return;

    let password: string | null = null;
    try {
      password = new URL(url).password ? decodeURIComponent(new URL(url).password) : null;
    } catch {
      password = null;
    }
    if (!password || password.length < 8) return;

    const scrubbed = scrubSecrets(`connection refused for ${password} at host`);
    assert.ok(!scrubbed.includes(password));
    assert.match(scrubbed, /connection refused/);
  });

  it("leaves ordinary text alone", () => {
    const text = "coingecko returned 429 after 3 attempts";
    assert.equal(scrubSecrets(text), text);
  });
});

/* ------------------------------------------------- transient db failures -- */

/**
 * A pool that could not hand out a connection in time is not a broken
 * service. It was being reported as a 500 with the driver's own wording,
 * which tells a client the wrong thing twice: that the fault is permanent,
 * and how the storage layer is built.
 */
describe("database error classification", () => {
  const pgError = (message: string, code?: string) => {
    const error = new Error(message);
    if (code) (error as Error & { code?: string }).code = code;
    return error;
  };

  it("treats a pool acquisition timeout as temporary", () => {
    const app = toAppError(pgError("Connection terminated due to connection timeout"));
    assert.equal(app.code, "DATABASE_UNAVAILABLE");
    assert.equal(app.status, 503);
  });

  it("treats connection-level failures as temporary", () => {
    for (const code of ["ECONNREFUSED", "ETIMEDOUT", "53300", "57P03"]) {
      assert.equal(toAppError(pgError("boom", code)).status, 503, `code ${code}`);
    }
  });

  it("does not describe the storage layer to the client", () => {
    const app = toAppError(pgError("Connection terminated due to connection timeout"));
    for (const word of ["pool", "connection", "postgres", "pg", "timeout"]) {
      assert.ok(
        !app.message.toLowerCase().includes(word),
        `the client message leaked "${word}"`,
      );
    }
  });

  it("leaves a genuine programming error as a 500", () => {
    const app = toAppError(new TypeError("x is not a function"));
    assert.equal(app.code, "INTERNAL_ERROR");
    assert.equal(app.status, 500);
  });
});
