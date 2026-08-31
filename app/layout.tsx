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

export const metadata: Metadata = {
  title: {
    default: "Strata Compute — One computation layer. Every market.",
    template: "%s · Strata Compute",
  },
  description:
    "Strata Compute turns fragmented market, stock, crypto and onchain data into one comparable intelligence layer.",
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
 * their own chrome: `app/(marketing)` for the public site, `app/app` for the
 * console.
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
