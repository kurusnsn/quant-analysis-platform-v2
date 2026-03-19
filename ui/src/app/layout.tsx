import type { Metadata } from "next";
import Script from "next/script";
import { Space_Mono } from "next/font/google"; // Switch to Space Mono
import "./globals.css";
import { Suspense } from "react";

import { PHProvider } from "@/providers/PostHogProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { DevAuthBridge } from "@/components/DevAuthBridge";
import QueryProvider from "@/providers/QueryProvider";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { Footer } from "@/components/Footer";
import { StructuredData, orgSchema, websiteSchema } from "@/components/StructuredData";
import { siteConfig, defaultOGImage } from "@/lib/seo";


const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [defaultOGImage],
  },
  twitter: {
    card: "summary_large_image",
    site: siteConfig.twitterHandle,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [defaultOGImage.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/logo-dark-mode.png",
    shortcut: "/logo-dark-mode.png",
    apple: "/logo-dark-mode.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${spaceMono.variable} antialiased bg-background text-foreground font-mono`}
      >
        <StructuredData data={orgSchema()} />
        <StructuredData data={websiteSchema()} />
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
              <PHProvider>
                <Suspense fallback={null}>
                  <DevAuthBridge />
                </Suspense>
                <div className="min-h-screen flex flex-col">
                  <div className="flex-1">
                    {children}
                  </div>
                  <Footer />
                </div>
                <CookieConsentBanner />
              </PHProvider>
            </QueryProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
