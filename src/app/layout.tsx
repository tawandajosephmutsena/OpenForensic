import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerGuard — Local financial forensics",
  description: "A local-first workspace to inspect bank statements, review potential discrepancies, and prepare evidence-led reports.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
