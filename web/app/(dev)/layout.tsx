import { AppShell } from "@/components/shell/AppShell";

/** Dev-only previews use the app shell, so notices look as they do in the app. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
