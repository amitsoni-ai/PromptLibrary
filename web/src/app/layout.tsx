import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { QueryProvider } from "@/components/QueryProvider";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Synottic Prompt Library",
  description: "Human-Centred AI — the Synottic prompt intelligence library.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#11171a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
