"use client";

import { useEffect, useRef } from "react";

/**
 * `P4-09` — client beacon tracking public page views.
 *
 * Emits a fire-and-forget beacon to `/public/i/:slug/view` on initial mount.
 * Uses `navigator.sendBeacon` with `fetch(..., { keepalive: true })` fallback.
 * Strictly adheres to zero PII / no visitor fingerprinting.
 */
export function PageViewTracker({ slug }: { readonly slug: string }) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!slug || sentRef.current) return;
    sentRef.current = true;

    const url = `/public/i/${encodeURIComponent(slug)}/view`;
    try {
      const sent =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(
          url,
          new Blob(["{}"], { type: "application/json" }),
        );

      if (!sent) {
        void fetch(url, {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {
      // Analytics must never disrupt the visitor's page.
    }
  }, [slug]);

  return null;
}
