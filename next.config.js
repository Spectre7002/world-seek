/** @type {import('next').NextConfig} */

// Google Maps / Street View pulls scripts, tiles, fonts and XHR from a set of
// google.com / gstatic.com / googleapis.com hosts. The policy below allows
// exactly those (plus ws:/wss: for the Socket.IO transport) and nothing else.
// `'unsafe-inline'`/`'unsafe-eval'` are required by the Maps JS bootstrap and
// Next's hydration scripts; there is no nonce pipeline in this app. This is a
// baseline, not a locked-down CSP — a reverse proxy can tighten it per deploy.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com https://*.googleapis.com https://*.ggpht.com",
  "connect-src 'self' ws: wss: https://maps.googleapis.com https://*.googleapis.com https://*.google.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
].join("; ");

// Baseline security headers. A CDN/reverse proxy (Cloudflare, Caddy) in front is
// still recommended — these are the app-level floor, applied to every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // HSTS: only meaningful over HTTPS (the proxy terminates TLS in production).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  // StrictMode double-invokes effects in development, which surfaces missing
  // cleanup (duplicate rAF loops, stacked Google Maps instances, leaked
  // listeners). It is a no-op in production builds.
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  allowedDevOrigins: ["*.ngrok-free.dev"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
