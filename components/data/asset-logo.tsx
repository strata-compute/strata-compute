"use client";

import * as React from "react";
import { resolveAssetLogo, type LogoSubject } from "@/lib/asset-logo";
import { cn } from "@/lib/utils";

/**
 * ASSET LOGO
 *
 * Renders provider-published artwork when it exists and a typographic
 * monogram when it does not. Both states occupy identical space, so a logo
 * that arrives late — or fails — never moves the row it sits in.
 *
 * The monogram is not hidden behind the image; it is painted underneath it.
 * That gives the loading state something meaningful to show, and makes a
 * broken image degrade by simply revealing what was already there.
 */

export type AssetLogoSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Pixel dimensions are explicit so the <img> reserves its box up front. */
const SIZES: Record<AssetLogoSize, { px: number; box: string; text: string; radius: string }> = {
  xs: { px: 20, box: "size-5", text: "text-[7.5px]", radius: "rounded-[4px]" },
  sm: { px: 28, box: "size-7", text: "text-[9.5px]", radius: "rounded-[5px]" },
  md: { px: 36, box: "size-9", text: "text-[11px]", radius: "rounded-md" },
  lg: { px: 48, box: "size-12", text: "text-[13.5px]", radius: "rounded-lg" },
  xl: { px: 64, box: "size-16", text: "text-[17px]", radius: "rounded-lg" },
};

export function AssetLogo({
  asset,
  size = "md",
  className,
}: {
  asset: LogoSubject;
  size?: AssetLogoSize;
  className?: string;
}) {
  const { src, monogram, alt, fallbackLabel } = resolveAssetLogo(asset);
  const dimensions = SIZES[size];

  // a failed load falls back for the rest of the session; re-keyed per URL so
  // a different asset in a recycled row starts clean
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const imageRef = React.useRef<HTMLImageElement | null>(null);

  React.useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  /**
   * These rows are server-rendered, so the browser usually finishes fetching
   * the image before React hydrates. `onLoad` fires against the DOM element,
   * not the component, so by the time the handler is attached the event has
   * already happened and it never fires — leaving the monogram sitting on top
   * of a perfectly good logo.
   *
   * Reconciling against the element's own state on mount is what closes that
   * gap. `complete` with a zero natural width means the fetch finished and
   * failed, which is the same outcome as onError.
   */
  React.useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (!image.complete) return;
    if (image.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, [src]);

  const showImage = src !== null && !failed;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-border",
        dimensions.box,
        dimensions.radius,
        // the plate only appears behind real artwork: many issuer logos are
        // transparent PNGs drawn in near-black, which would vanish on the
        // dark theme without it
        showImage ? "bg-logo-bg" : "bg-surface-2",
        className,
      )}
      // the monogram is decorative when artwork is present
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : fallbackLabel}
    >
      <span
        aria-hidden
        className={cn(
          "select-none font-mono font-medium tracking-tight text-muted",
          dimensions.text,
          // hidden the moment real artwork has painted
          showImage && loaded && "opacity-0",
        )}
      >
        {monogram}
      </span>

      {showImage ? (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          width={dimensions.px}
          height={dimensions.px}
          loading="lazy"
          decoding="async"
          // issuer CDNs have no reason to receive our routes
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 size-full object-contain p-[12%] transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
