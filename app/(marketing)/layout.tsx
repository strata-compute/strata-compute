import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/footer";

/** Public site chrome — deliberately separate from the console shell. */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      {/* scroll-reveal is progressive: without JS the content stays visible */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <LandingNav />
      <main id="content">{children}</main>
      <LandingFooter />
    </div>
  );
}
