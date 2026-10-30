import { padId } from "@/lib/format";

export const HOME = "/overview";

export const NAV = [
  { href: "/overview", label: "Overview", short: "Overview" },
  { href: "/escrows", label: "Escrows", short: "Escrows" },
  { href: "/find", label: "Find an escrow", short: "Find" },
] as const;

export const TOOLS = [{ href: "/setup", label: "Test funds", short: "Funds" }] as const;

export type NavHref = (typeof NAV)[number]["href"] | (typeof TOOLS)[number]["href"] | "/new";

/** Which nav item a path belongs to (an escrow page sits under Escrows). */
export function activeOf(path: string | null): NavHref | null {
  if (!path) return null;
  if (path === "/escrows" || path.startsWith("/escrow/")) return "/escrows";
  for (const href of ["/overview", "/find", "/setup", "/new"] as const) if (path === href) return href;
  return null;
}

/** The breadcrumb's last part. */
export function crumbOf(path: string | null): string {
  if (!path) return "";
  const escrow = /^\/escrow\/([^/]+)$/.exec(path);
  if (escrow) return /^\d{1,15}$/.test(escrow[1]) ? `Escrow ${padId(escrow[1])}` : "Escrow";
  const names: Record<string, string> = {
    "/overview": "Overview",
    "/escrows": "Escrows",
    "/find": "Find an escrow",
    "/new": "New escrow",
    "/setup": "Test funds",
    "/dev/notices": "Contract notices",
  };
  return names[path] ?? "";
}
