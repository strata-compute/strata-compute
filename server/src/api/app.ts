import express, { type Express } from "express";
import { env } from "../config/env.ts";
import { cors } from "./middleware/cors.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { requestId } from "./middleware/request-id.ts";
import { requestLog } from "./middleware/request-log.ts";
import { router } from "./routes/index.ts";
import { intelligenceRouter } from "./routes/intelligence.ts";
import { intelligenceEventsRouter } from "./routes/intelligence-events.ts";
import { phase6Router } from "./routes/phase6.ts";
import { streamRouter } from "./routes/stream.ts";

/** Assembles the HTTP surface. Order matters and is the point of this file. */
export function createApp(): Express {
  const app = express();

  /**
   * Trust the first proxy hop only when a proxy is actually in front.
   *
   * This was unconditional, which meant `req.ip` came from a header any
   * caller can set — so a client could pick its own rate-limit bucket per
   * request and the limiter counted nothing. Behind a real proxy the header
   * is trustworthy and the setting is required; without one it must be off.
   */
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  /**
   * Response headers for a JSON API.
   *
   * Small and deliberate: this surface serves no HTML and no documents, so it
   * needs neither a full CSP nor most of what a page needs. What it does need
   * is to never be sniffed into another content type, never be framed, and
   * never leak a referrer to a provider domain.
   */
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (env.isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.use(requestId);
  app.use(requestLog);
  app.use(cors);
  app.use(rateLimit);
  app.use(express.json({ limit: "64kb" }));

  // Order is load-bearing. The base router owns `/arena/:round`, which would
  // otherwise match `/arena/current` and `/arena/history` and reject them as
  // malformed round numbers. Express takes the first match, so the specific
  // routes are mounted ahead of the parameterised one.
  // before the base router: /intelligence/market and /intelligence/event/:id
  // must not be swallowed by a broader parameterised route
  app.use("/api", intelligenceEventsRouter);
  app.use("/api", phase6Router);
  app.use("/api", streamRouter);
  app.use("/api", intelligenceRouter);
  app.use("/api", router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
