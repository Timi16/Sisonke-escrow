import type { NextConfig } from "next";
import { deployment } from "./lib/generated/deployment";

const isDev = process.env.NODE_ENV === "development";
const origin = (url: string) => new URL(url).origin;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.NEXT_PUBLIC_RPC_URL;
const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL ?? deployment.NEXT_PUBLIC_HORIZON_URL;

/**
 * Static CSP ("Without Nonces" in the Next docs): nonces would force dynamic
 * rendering of every page under Cache Components. The browser only talks to
 * this site, the Soroban RPC and Horizon. Wallet extensions talk to the page
 * through window.postMessage, which CSP doesn't restrict. If a wallet module
 * ever needs another origin, add exactly that origin here with a comment.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${origin(rpcUrl)} ${origin(horizonUrl)}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Albedo signs in a popup window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
