import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixly — share the light you find",
  description: "Pixly is a demo photo app and the reference integration for ConsentOS.",
  // The same declaration the SDK's announceService() adds at runtime, present before hydration too.
  other: { "consentos-service": "pixly" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
