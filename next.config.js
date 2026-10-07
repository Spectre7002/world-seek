/** @type {import('next').NextConfig} */

// Baseline security headers. A CDN/reverse proxy (Cloudflare, Caddy) in front is
// still recommended — these are the app-level floor, applied to every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=()" },
  // HSTS: only meaningful over HTTPS (the proxy terminates TLS in production).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: false,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  allowedDevOrigins: ["*.ngrok-free.dev"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
