import type { SectionProps } from "../types.js";
import { readPath } from "../resolve-data.js";
import { SectionShell, When, rows, text } from "./primitives.js";

/**
 * P2-03 step 6 — RSVP and Guestbook as presentational shells.
 *
 * Their submission wiring is **Phase 4**. What exists here is the markup, the labels and
 * the keyboard behaviour, so that `P2-13`'s performance baseline and `P2-08`'s page
 * measure the real layout rather than a placeholder that will be replaced.
 *
 * ## A shell that cannot submit is better than one that silently does nothing
 *
 * Both forms are disabled and say why. The alternative — a live-looking form whose submit
 * handler is missing — is the failure mode where a guest types a message, presses send,
 * sees nothing happen, and concludes the invitation is broken. `docs/FRONTEND/04`
 * § Mode Differences already requires submissions to be inert in `live` and `demo`; until
 * Phase 4 they are inert in `public` too, and the notice is how that stays honest.
 */

const PENDING_NOTICE = "Formulir ini akan aktif sebentar lagi.";

/** `docs/UI-UX/14` § 8 — attendance confirmation. */
export function RsvpForm({ mode }: SectionProps) {
  return (
    <SectionShell title="Konfirmasi Kehadiran">
      <form
        className="wi-stack"
        // Phase 4 replaces this. Until then the form cannot navigate away: a real submit
        // would reload the page and lose the guest's place in a long scroll.
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="wi-field">
          <label htmlFor="wi-rsvp-name">Nama</label>
          <input
            className="wi-input"
            id="wi-rsvp-name"
            name="guest_name"
            type="text"
            autoComplete="name"
            disabled
          />
        </div>

        <fieldset className="wi-field">
          <legend>Kehadiran</legend>
          {[
            ["attending", "Hadir"],
            ["not_attending", "Tidak hadir"],
          ].map(([value, label]) => (
            <label key={value} htmlFor={`wi-rsvp-${value}`}>
              <input
                id={`wi-rsvp-${value}`}
                type="radio"
                name="attendance"
                value={value}
                disabled
              />{" "}
              {label}
            </label>
          ))}
        </fieldset>

        <div className="wi-field">
          <label htmlFor="wi-rsvp-message">Ucapan (opsional)</label>
          <textarea
            className="wi-input"
            id="wi-rsvp-message"
            name="message"
            rows={3}
            disabled
          />
        </div>

        <button className="wi-button" type="submit" disabled>
          Kirim
        </button>
        {/* Not `aria-live`: this is present from first paint rather than announced on a
            change, so a live region would say nothing useful and interrupt at load. */}
        <p className="wi-muted" data-mode={mode}>
          {PENDING_NOTICE}
        </p>
      </form>
    </SectionShell>
  );
}

/**
 * `docs/UI-UX/14` § 9 — messages, and a form to add one.
 *
 * The list renders whatever the caller supplies. Nothing is fetched: `docs/FRONTEND/04`
 * keeps the renderer free of network calls, so Phase 4's public API supplies entries the
 * same way every other section gets its data.
 */
export function GuestbookWall({ data }: SectionProps) {
  const entries = rows(readPath(data, ["guestbook", "entries"]));

  return (
    <SectionShell title="Buku Tamu">
      {entries.length > 0 && (
        <ul className="wi-stack">
          {entries.map((entry, index) => (
            <li key={index} className="wi-card">
              <p>{text(entry["message"]) ?? ""}</p>
              <When value={entry["guest_name"]}>
                {(name) => <p className="wi-muted">— {name}</p>}
              </When>
            </li>
          ))}
        </ul>
      )}

      <form
        className="wi-stack"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="wi-field">
          <label htmlFor="wi-guestbook-name">Nama</label>
          <input
            className="wi-input"
            id="wi-guestbook-name"
            name="guest_name"
            type="text"
            autoComplete="name"
            disabled
          />
        </div>
        <div className="wi-field">
          <label htmlFor="wi-guestbook-message">Ucapan</label>
          <textarea
            className="wi-input"
            id="wi-guestbook-message"
            name="message"
            rows={3}
            disabled
          />
        </div>
        <button className="wi-button" type="submit" disabled>
          Kirim ucapan
        </button>
        <p className="wi-muted">{PENDING_NOTICE}</p>
      </form>
    </SectionShell>
  );
}
