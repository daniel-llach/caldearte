import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const title = "Caldearte";
const description = "Calendario de inauguraciones de arte en Chile.";

export const metadata: Metadata = {
  metadataBase: new URL("https://caldearte.com"),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: title,
    locale: "es_CL",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

// Next.js doesn't inject this by default — without it, mobile browsers
// assume a ~980px desktop layout and scale the whole page down to fit,
// which is exactly the "everything looks zoomed out" symptom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
