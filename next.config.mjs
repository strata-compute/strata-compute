/**
 * Content Security Policy.
 *
 * Built as a list so each decision can carry its reason. Two of them are
 * concessions rather than choices, and both are marked as such — a CSP whose
 * relaxations are undocumented is one nobody can ever tighten later.
 */
const csp = [
  "default-src 'self'",

  // 'unsafe-inline' is required because the App Router inlines its bootstrap
  // and streaming payloads, and the theme script must run before first paint
  // to avoid a flash of the wrong theme. Removing it needs a nonce, which
  // needs middleware on every request — a change to how every page is served,
  // which is not a pre-launch change to make.
  "script-src 'self' 'unsafe-inline'",

  // Tailwind emits a stylesheet, but Next also inlines critical CSS and
  // several components set CSS custom properties through the style attribute.
  "style-src 'self' 'unsafe-inline'",

  // The two CDNs that publish the asset artwork. Named rather than left to a
  // blanket `https:` — they already appear in the DOM as image sources, so
  // listing them discloses nothing new and keeps the policy meaningful.
  "img-src 'self' data: https://assets.parqet.com https://coin-images.coingecko.com",

  // next/font/google self-hosts at build time; nothing is fetched at runtime.
  "font-src 'self' data:",

  // Every browser request is same-origin. The Strata API is reached only from
  // the server, through the route handlers in app/api/* — the backend URL is
  // never in a client bundle, so it does not belong here either.
  "connect-src 'self'",

  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",

  // `upgrade-insecure-requests` is deliberately absent. It rewrites every
  // sub-request to https, including same-origin ones, which breaks any http
  // deployment — a local production run most of all, where it turned page
  // data fetches into SSL protocol errors. A deployment served over https has
  // nothing to upgrade, and HSTS below already forbids the downgrade.
].join("; ");

/**
 * Headers applied to every response.
 *
 * `frame-ancestors` in the CSP is what actually stops framing in modern
 * browsers; X-Frame-Options is kept for the ones that never learned it.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    // Nothing here uses a device. Denying the lot means a future dependency
    // cannot quietly start asking.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

/**
 * HSTS is set only in production. On localhost it would pin http://localhost
 * to https for six months in the developer's browser, which is a painful and
 * entirely self-inflicted outage.
 */
if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // the deployment target does not need the response header advertising Next
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  async redirects() {
    return [
      // "Launch App" points at /app; the console opens on its overview
      { source: "/app", destination: "/app/overview", permanent: false },
    ];
  },
};

export default nextConfig;
