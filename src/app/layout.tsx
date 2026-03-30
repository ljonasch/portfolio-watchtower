import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { GlobalWorkflowNav } from "@/components/GlobalWorkflowNav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Portfolio Watchtower",
  description: "Track and analyze your portfolio.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className={`${inter.className} min-h-screen bg-slate-950 text-slate-50 antialiased`}>
        <nav className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
          <div className="container mx-auto px-4 h-12 flex items-center gap-6">
            <Link href="/" className="font-bold text-base tracking-tight bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex-shrink-0">
              Portfolio Watchtower
            </Link>
            <div className="flex-1 overflow-x-auto">
              <GlobalWorkflowNav />
            </div>
          </div>
        </nav>
        <main className="container mx-auto px-4 py-5">
          {children}
        </main>
      </body>
    </html>
  );
}
