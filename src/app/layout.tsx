import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { GlobalWorkflowNav } from "@/components/GlobalWorkflowNav";

import { prisma } from "@/lib/prisma";
import { getLatestVisibleReportSurface } from "@/lib/read-models";

export const metadata: Metadata = {
  title: "Portfolio Watchtower",
  description: "Track and analyze your portfolio.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await prisma.user.findFirst({
    select: { id: true },
  });
  const latestVisibleReport = user
    ? await getLatestVisibleReportSurface(user.id)
    : null;

  return (
    <html lang="en" className="dark">
      <body
        suppressHydrationWarning
        className="min-h-screen bg-slate-950 text-slate-50 antialiased"
        style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
      >
        <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
          <div className="container mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-bold text-base tracking-tight bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex-shrink-0">
              Portfolio Watchtower
            </Link>
            <div className="flex-1 overflow-x-auto no-scrollbar py-2">
              <GlobalWorkflowNav latestReportId={latestVisibleReport?.reportLinkId} />
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-5">
          {children}
        </main>
      </body>
    </html>
  );
}
