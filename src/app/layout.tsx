import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/site-footer";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

async function readInitialWalletAddress(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const session = await verifySessionToken(token);
    return session?.addr ?? null;
  } catch {
    return null;
  }
}

// Only weights we actually render. font-semibold (600) is synthesized from
// the 700 file by the browser's CSS font-matching algorithm. font-light /
// font-black were loaded but never referenced — drop saves ~200KB.
const neueHaas = localFont({
  variable: "--font-sans",
  display: "swap",
  preload: true,
  src: [
    { path: "../../public/fonts/NeueHaasDisplayMedium.woff2",       weight: "500", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplayMediumItalic.woff2", weight: "500", style: "italic" },
    { path: "../../public/fonts/NeueHaasDisplayBold.woff2",         weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Nova Consortium · Celestia Validator Notifications",
  description:
    "Configure real-time alerts for Celestia validators across Discord, Telegram, Slack, PagerDuty, and email.",
  icons: {
    icon: "/nova.png",
    apple: "/nova.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const initialWalletAddress = await readInitialWalletAddress();
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${neueHaas.variable} ${GeistMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <Providers initialWalletAddress={initialWalletAddress}>
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </Providers>
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  );
}
