"use client";

import React from "react";

type BrandLogoProps = {
  /**
   * Height in pixels. Width will auto-scale based on the image aspect ratio.
   */
  height?: number;
  className?: string;
  alt?: string;
};

export function BrandLogo({
  height = 34,
  className = "",
  alt = "",
}: BrandLogoProps) {
  return (
    <span className={`brand-logo inline-flex items-center ${className}`.trim()}>
      <img
        src="/logo-light-mode.png"
        className="brand-logo__img brand-logo__img--light"
        alt={alt}
        style={{ height }}
        draggable={false}
      />
      <img
        src="/logo-dark-mode.png"
        className="brand-logo__img brand-logo__img--dark"
        alt={alt}
        style={{ height }}
        draggable={false}
      />
    </span>
  );
}
