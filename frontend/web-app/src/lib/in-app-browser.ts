/**
 * P3-14 — in-app browser detection. `docs/UI-UX/13` § Confirmation & Payment Page.
 *
 * WhatsApp and Instagram wrap a Chromium WebView that blocks third-party redirects and
 * Midtrans's own Snap.js in some configurations. Detecting it allows the payment page to
 * offer "open in external browser" instead of silently failing.
 *
 * The detection is heuristic and best-effort — there is no guaranteed API. The patterns
 * here cover the two browsers that cause the most support tickets in Indonesia: Facebook
 * in-app (shared WebView with WhatsApp) and Instagram in-app.
 *
 * This is **never used as a security gate** — it is purely a UX nudge.
 */

/** `true` if the current environment looks like a social-media in-app browser. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || ("vendor" in navigator ? (navigator as { vendor?: string }).vendor ?? "" : "");
  return /FBAN|FBAV|Instagram|Line\//.test(ua);
}

/**
 * The name of the detected in-app browser, for a user-visible string.
 * `undefined` when the current browser is not a detected in-app browser.
 */
export function getBrowserName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent || "";
  if (/Instagram/.test(ua)) return "Instagram";
  if (/FBAN|FBAV/.test(ua)) return "Facebook";
  if (/Line\//.test(ua)) return "LINE";
  return undefined;
}
