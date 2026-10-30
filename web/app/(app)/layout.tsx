import { AppShell } from "@/components/shell/AppShell";

/** Every app route: the dark sidebar on desktop, top bar and dock on phones. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
