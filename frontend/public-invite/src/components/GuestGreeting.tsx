"use client";

import { useEffect, useState } from "react";

import { readGuestName } from "../lib/guest-name";

/**
 * `P2-10` step 2 — "Kepada Bapak/Ibu/Saudara/i {nama}". `docs/UI-UX/14` § Key Interactions.
 *
 * ## Read after hydration, never on the server
 *
 * `docs/ARCHITECTURE/06` § Cache Segmentation is the reason, and it is an architectural
 * one rather than a preference: a server-rendered guest name produces **one cache entry
 * per guest**. A couple sends four hundred personalized links; the page is then four
 * hundred distinct documents, the hit ratio collapses, and every guest waits for a cold
 * render on the morning of the wedding.
 *
 * So this reads `window.location.search` in an effect. The consequence is that the
 * greeting is absent from the initial HTML and appears a frame later —
 * `docs/FRONTEND/07` § Personalization accepts that explicitly: *"the related element is
 * rendered as part that's allowed to flash/update post-hydration (an acceptable
 * trade-off, a small non-critical part for SEO)"*.
 *
 * It also means a link preview never carries a guest's name, which is a privacy
 * improvement nobody asked for: a forwarded card in a group chat would otherwise show who
 * the link was addressed to.
 *
 * ## Nothing is rendered until there is something to say
 *
 * No placeholder, no skeleton, no reserved space. The greeting is absent for every guest
 * who opens the bare address, and a box that says nothing is worse than no box. The space
 * it occupies when present is a single line at the top of the page, above the cover, so
 * its appearance does not move the invitation.
 */
export function GuestGreeting() {
  const [name, setName] = useState<string | undefined>(undefined);

  useEffect(() => {
    setName(readGuestName(window.location.search));
  }, []);

  if (name === undefined) return null;

  return (
    <div
      data-guest-greeting="true"
      className="px-4 pt-4 text-center text-sm text-neutral-600"
    >
      <p>
        Kepada Bapak/Ibu/Saudara/i
        {/*
         * `{name}` as a React child, which React escapes. Markup in the query string
         * therefore renders as the characters somebody typed — never as HTML — and
         * `guest-name.spec.ts` asserts it against a real payload rather than trusting the
         * sentence.
         */}
        <br />
        <strong className="font-medium text-neutral-900">{name}</strong>
      </p>
    </div>
  );
}
