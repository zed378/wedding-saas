"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * `P2-13` step 5 — real-user Core Web Vitals from a guest's phone. `docs/FRONTEND/09`
 * § Monitoring.
 *
 * Lab numbers describe a laptop on a throttled link; a guest is on a mid-range Android phone
 * on a crowded network at a reception venue. This reports what they actually got.
 *
 * ## What leaves the page
 *
 * The metric, its value, its rating, and the **kind** of page — never the URL. A preview URL
 * contains a credential (`P2-12`) and an invitation URL names a couple; neither belongs in a
 * metrics pipeline. The kind is decided by the page that mounts this, not parsed from
 * `location`, so there is no code path that could send a path by accident.
 *
 * ## `sendBeacon`, same origin
 *
 * A beacon survives the page being closed — which is when CLS and INP are final — and does
 * not delay unload. It goes to `/public/rum` on this host, which forwards to the API
 * (`app/public/rum/route.ts`), so no third-party origin sees a guest's browser.
 */

export type PageKind = "invitation" | "preview" | "not_found";

const REPORTED = new Set(["LCP", "CLS", "INP", "FCP", "TTFB"]);

export function WebVitals({ pageKind }: { readonly pageKind: PageKind }) {
  useReportWebVitals((metric) => {
    if (!REPORTED.has(metric.name)) return;

    const body = JSON.stringify({
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      page_kind: pageKind,
    });

    // `sendBeacon` is absent in some embedded browsers (WhatsApp's in-app browser on older
    // Android). `keepalive` fetch is the same guarantee by another name; neither may throw.
    try {
      const sent =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(
          "/public/rum",
          new Blob([body], { type: "application/json" }),
        );
      if (!sent) {
        void fetch("/public/rum", {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {
      // Monitoring must never break the page it monitors.
    }
  });

  return null;
}
