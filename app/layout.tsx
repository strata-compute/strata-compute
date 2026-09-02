import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-src",
  display: "swap",
});

/**
 * `metadataBase` is what makes every relative Open Graph and canonical URL
 * resolve to the real origin instead of the deployment's own hostname, which
 * changes on every build.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://stratacompute.app"),
  title: {
    default: "Strata Compute — Every market on one scale",
    template: "%s · Strata Compute",
  },
  description:
    "A computation and intelligence layer for tokenised equities, crypto and onchain markets. Seven components, published weights, one comparable measure of strength. Built on Robinhood Chain.",
  applicationName: "Strata Compute",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Strata Compute",
    url: "https://stratacompute.app",
    title: "Strata Compute — Every market on one scale",
    description:
      "Tokenised equities, crypto and onchain markets normalised onto one schema and computed into one comparable measure of strength. Built on Robinhood Chain.",
  },
  twitter: {
    card: "summary_large_image",
    site: "@StrataCompute",
    creator: "@StrataCompute",
    title: "Strata Compute — Every market on one scale",
    description:
      "A computation and intelligence layer for tokenised equities, crypto and onchain markets.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  /**
   * Domain ownership proofs.
   *
   * Declared here rather than as raw markup in the layout body so they travel
   * with the rest of the metadata — a tag hand-written into <head> is the kind
   * that disappears the next time the layout is refactored, and it disappears
   * silently.
   */
  verification: {
    other: {
      "virtual-protocol-site-verification": "e747d327db971c9aedbc7d825932ea49",
    },
  },
};

export const viewport: Viewport = {
  // matched to the dark background the server renders; the theme provider
  // rewrites this tag when the reader switches
  themeColor: "#080A09",
  // both themes ship, and dark is the default
  colorScheme: "dark light",
};

/**
 * Root shell only owns the document, fonts and tokens. The two products get
 * their own chrome: `app/(marketing)` for the public site, `app/terminal` for
 * the Terminal.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `data-theme` is written here so a reader with no stored preference —
    // or no JavaScript — gets dark exactly as designed. ThemeScript may
    // narrow it to light before paint, which is why hydration warnings are
    // suppressed on this element only.
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${mono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:border focus:border-green-ink/40 focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:text-text"
        >
          Skip to content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
