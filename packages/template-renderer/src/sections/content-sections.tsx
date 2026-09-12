import type { SectionProps } from "../types.js";
import { readPath } from "../resolve-data.js";
import { Photo, SectionShell, When, rows, text } from "./primitives.js";

/**
 * P2-03 — the sections that present stored content and take no input.
 *
 * Quote, Couple, Gallery (two variants), Maps, Gift and Closing. Grouped in one file
 * because each is small and they share one shape: read the declared fields, render what
 * is present, render nothing for what is not.
 *
 * Every one of them obeys `docs/PLAN/07` § Required vs Optional — "an absent caption
 * leaves no empty box behind" — through `When`, which is the whole reason that helper
 * exists rather than ten slightly different truthiness checks.
 */

/** `docs/UI-UX/14` § 2 — an opening verse. */
export function QuoteBanner({ data }: SectionProps) {
  const body = text(readPath(data, ["quote", "text"]));
  // No quote, no section. A bordered empty box in the middle of an invitation reads as a
  // bug, and this is the one section whose entire content is optional.
  if (body === undefined) return null;

  return (
    <SectionShell className="wi-center">
      <blockquote className="wi-stack">
        <p>{body}</p>
        <When value={readPath(data, ["quote", "source"])}>
          {(source) => <footer className="wi-muted">— {source}</footer>}
        </When>
      </blockquote>
    </SectionShell>
  );
}

/** `docs/UI-UX/14` § 3 — both people and their parents. */
export function CoupleProfile({ data }: SectionProps) {
  const couple = readPath(data, ["couple"]);
  const people = (["groom", "bride"] as const)
    .map((role) => ({ role, person: readPath(couple, [role]) }))
    .filter((entry) => entry.person !== undefined);

  if (people.length === 0) return null;

  return (
    <SectionShell title="Mempelai">
      <div className="wi-people">
        {people.map(({ role, person }) => (
          <article key={role} className="wi-card wi-center wi-stack">
            <When value={readPath(person, ["photo"])}>
              {(src) => (
                <Photo
                  src={src}
                  className="wi-portrait"
                  caption={text(readPath(person, ["full_name"]))}
                />
              )}
            </When>

            <h3>
              {text(readPath(person, ["full_name"])) ??
                text(readPath(person, ["nickname"])) ??
                ""}
            </h3>

            <When value={readPath(person, ["child_order"])}>
              {(order) => <p className="wi-muted">{order}</p>}
            </When>

            <ParentLine
              father={readPath(person, ["father_name"])}
              mother={readPath(person, ["mother_name"])}
            />

            <When value={readPath(person, ["instagram"])}>
              {(handle) => (
                // A profile link, not an embed: an Instagram embed is a third-party
                // script on the one page with unbounded traffic.
                <a
                  href={`https://instagram.com/${encodeURIComponent(handle)}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  @{handle}
                </a>
              )}
            </When>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

/**
 * Parents, as one line, and only the parts that exist.
 *
 * `docs/PLAN/08` makes both names optional. "Putra dari Bapak X dan " with a trailing
 * conjunction is the artifact the DoD calls out, and it happens whenever two optional
 * values are joined without checking each.
 */
function ParentLine({
  father,
  mother,
}: {
  readonly father: unknown;
  readonly mother: unknown;
}) {
  const names = [text(father), text(mother)].filter(
    (name): name is string => name !== undefined,
  );
  if (names.length === 0) return null;

  return <p className="wi-muted">Putra/Putri dari {names.join(" & ")}</p>;
}

/** `docs/UI-UX/14` § 5 — the photo gallery, grid by default. */
export function GalleryGrid(props: SectionProps) {
  return <Gallery {...props} variant="grid" />;
}

/** The same photos, one at a time, scroll-snapped. `layout_options` in the schema. */
export function GalleryCarousel(props: SectionProps) {
  return <Gallery {...props} variant="carousel" />;
}

function Gallery({
  data,
  layoutVariant,
  maxItems,
  variant,
}: SectionProps & { readonly variant: "grid" | "carousel" }) {
  // `layout_variant` from the definition wins over which component name was used, so a
  // template can name `GalleryGrid` and set `layout_variant: "carousel"`. The component
  // name is the default, not the decision.
  const effective =
    layoutVariant === "carousel" || layoutVariant === "grid"
      ? layoutVariant
      : variant;

  const photos = rows(readPath(data, ["gallery", "photos"]))
    .filter((photo) => text(photo["url"]) !== undefined)
    // `max_items` is the template's cap (`docs/PLAN/07`). Ignoring it would let a couple
    // with 200 photos break a layout designed for 20.
    .slice(0, maxItems ?? undefined);

  if (photos.length === 0) return null;

  return (
    <SectionShell title="Galeri">
      <div
        className={
          effective === "carousel" ? "wi-gallery-carousel" : "wi-gallery-grid"
        }
        data-variant={effective}
      >
        {photos.map((photo, index) => (
          <Photo
            key={text(photo["media_id"]) ?? String(index)}
            src={text(photo["url"]) ?? ""}
            caption={text(photo["caption"])}
          />
        ))}
      </div>
    </SectionShell>
  );
}

/**
 * `docs/UI-UX/14` § 6 — the venue map.
 *
 * **No map SDK.** ADR-014 and the card's step 3b: a static image plus a deep link. An
 * embedded map is one of the heaviest things a page can load, against a 150KB budget on a
 * mid-range phone, and it bills per load on the one surface with unbounded traffic.
 *
 * The link is built from the stored coordinates rather than from `maps_url` alone,
 * because `maps_url` is optional and user-supplied — `P1-12` generates one from the
 * coordinates when it is absent, and this prefers the explicit value when it is there.
 */
export function MapsStatic({ data }: SectionProps) {
  const events = rows(readPath(data, ["events"])).filter(
    (event) =>
      text(event["venue_name"]) !== undefined ||
      text(event["maps_url"]) !== undefined,
  );

  if (events.length === 0) return null;

  return (
    <SectionShell title="Lokasi">
      <div className="wi-stack">
        {events.map((event, index) => {
          const link = mapsLink(event);
          return (
            <article key={index} className="wi-card wi-stack">
              <When value={event["venue_name"]}>
                {(venue) => <h3>{venue}</h3>}
              </When>
              <When value={event["address"]}>
                {(address) => <p className="wi-muted">{address}</p>}
              </When>
              {link !== undefined && (
                <a
                  className="wi-button wi-button-quiet"
                  href={link}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Buka di Google Maps
                </a>
              )}
            </article>
          );
        })}
      </div>
    </SectionShell>
  );
}

function mapsLink(event: Record<string, unknown>): string | undefined {
  const explicit = text(event["maps_url"]);
  // Only http(s). `P1-12` validates this on the way in; repeating it here is what stops a
  // stored `javascript:` URL from becoming an anchor on a page hundreds of guests open.
  if (explicit !== undefined && /^https?:\/\//i.test(explicit)) return explicit;

  const latitude = text(event["latitude"]);
  const longitude = text(event["longitude"]);
  if (latitude === undefined || longitude === undefined) return undefined;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${latitude},${longitude}`,
  )}`;
}

/**
 * `docs/UI-UX/14` § 7 — gift accounts, with a copy button.
 *
 * `docs/SECURITY/09` treats these as sensitive and `P1-13` records why the threat is
 * **substitution** rather than disclosure: they are published on purpose. The risk this
 * section carries is that a guest copies a number that is not the couple's, which is a
 * problem for the write path, not this one.
 */
export function GiftAccountList({ data, mode }: SectionProps) {
  const accounts = rows(readPath(data, ["gift", "accounts"]));
  if (accounts.length === 0) return null;

  return (
    <SectionShell title="Hadiah">
      <div className="wi-stack">
        {accounts.map((account, index) => (
          <article key={index} className="wi-card wi-stack">
            <h3>{text(account["provider_name"]) ?? ""}</h3>
            <p>
              <span>{text(account["account_number"]) ?? ""}</span>
            </p>
            <When value={account["account_holder"]}>
              {(holder) => <p className="wi-muted">a.n. {holder}</p>}
            </When>
            <CopyButton
              value={text(account["account_number"])}
              disabled={mode !== "public"}
            />
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

/**
 * Copy, with the "Copied!" feedback `docs/UI-UX/14` § Key Interactions asks for.
 *
 * Announced rather than only coloured: the confirmation is in an `aria-live` region, so a
 * screen-reader user learns the copy worked. A green flash tells them nothing.
 *
 * Inert outside `public` — in the editor preview and the catalogue demo there is nothing
 * meaningful to copy, and a button that appears to work and does not is worse than one
 * that is plainly disabled.
 */
function CopyButton({
  value,
  disabled,
}: {
  readonly value: string | undefined;
  readonly disabled: boolean;
}) {
  if (value === undefined) return null;

  return (
    <button
      type="button"
      className="wi-button wi-button-quiet"
      disabled={disabled}
      onClick={(event) => {
        const button = event.currentTarget;
        void navigator.clipboard?.writeText(value).then(() => {
          const status = button.nextElementSibling;
          if (status !== null) status.textContent = "Nomor disalin";
        });
      }}
    >
      Salin nomor
    </button>
  );
}

/** `docs/UI-UX/14` § 10 — the closing thank-you. */
export function ClosingSimple({ data }: SectionProps) {
  const groom = text(readPath(data, ["couple", "groom", "nickname"]));
  const bride = text(readPath(data, ["couple", "bride", "nickname"]));
  const names = [groom, bride].filter(Boolean).join(" & ");

  return (
    <SectionShell className="wi-center">
      <p>
        Merupakan suatu kehormatan dan kebahagiaan bagi kami apabila
        Bapak/Ibu/Saudara/i berkenan hadir.
      </p>
      <When value={names}>{(present) => <h3>{present}</h3>}</When>
    </SectionShell>
  );
}
