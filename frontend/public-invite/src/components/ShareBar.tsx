"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `P2-10` step 4 — share to WhatsApp, and copy the link. `docs/UI-UX/14` § Key Interactions.
 *
 * ## The canonical URL, from the server
 *
 * The address shared is the invitation's **canonical** one, passed in as a prop, not the
 * one in the guest's address bar. A guest may be on a forwarded link carrying `?to=`, and
 * sharing that would pass somebody else's personalization on to the next person — which
 * is exactly the thing a guest would not notice doing.
 *
 * Taking it as a prop also means the WhatsApp link is a real `href` in the server-rendered
 * HTML, so it works with JavaScript disabled. The first version read
 * `window.location` in an effect and produced `href="#"` until hydration; the value does
 * not vary per visitor, so there was never a reason for it to be client-side. Only the
 * clipboard needs the browser.
 *
 * ## The feedback is announced, not just shown
 *
 * `docs/UI-UX/16` asks for brief "Copied!" feedback. A visual-only confirmation is
 * invisible to a screen-reader user, who is the person least able to verify the clipboard
 * another way — so the message lives in a polite live region that is always in the
 * document, and the text changes rather than the element appearing.
 */
export function ShareBar({
  coupleNames,
  url,
}: {
  readonly coupleNames: string | undefined;
  /** The invitation's canonical address. Never the guest's current one. */
  readonly url: string;
}) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const announce = (text: string) => {
    setMessage(text);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMessage("");
    }, 4000);
  };

  const copy = () => {
    // `navigator.clipboard` is absent on an insecure origin and can reject when the
    // document is not focused. Both are ordinary, so neither may throw into the page.
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        announce("Tautan undangan disalin.");
      })
      .catch(() => {
        announce("Tautan tidak bisa disalin. Silakan salin dari bilah alamat.");
      });
  };

  const invite =
    coupleNames === undefined
      ? "Kami mengundang Anda ke pernikahan kami."
      : `Kami, ${coupleNames}, mengundang Anda ke pernikahan kami.`;

  // `wa.me` rather than `whatsapp://`: it works on a desktop browser, on a phone without
  // the app, and it is the address WhatsApp itself documents for a share link.
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${invite}\n\n${url}`)}`;

  return (
    <div
      data-share-bar="true"
      className="flex flex-col items-center gap-3 px-4 py-8 text-center"
    >
      <p className="text-sm text-neutral-600">Bagikan undangan ini</p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {/*
         * An anchor, not a button with a handler. A share target is a navigation: a guest
         * expects to be able to long-press it, open it in another tab, or copy the address
         * — all of which a scripted button takes away.
         */}
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-11 rounded-full border border-neutral-300 px-5 py-2 text-sm font-medium text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
        >
          Bagikan ke WhatsApp
        </a>

        <button
          type="button"
          onClick={copy}
          className="min-h-11 rounded-full border border-neutral-300 px-5 py-2 text-sm font-medium text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none disabled:opacity-50"
        >
          Salin tautan
        </button>
      </div>

      {/*
       * Always present, empty until there is something to say. A live region added to the
       * document at the moment it gains content is frequently not announced at all — the
       * screen reader has to be observing it beforehand.
       */}
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-xs text-neutral-600"
      >
        {message}
      </p>
    </div>
  );
}
