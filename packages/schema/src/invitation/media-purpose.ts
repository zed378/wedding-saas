/**
 * The values `media.purpose` may take. `docs/API/05`, `docs/DATABASE/06`.
 *
 * Here, in the shared package, for two reasons.
 *
 * **One definition for both sides.** The API validates an upload's `purpose` against this
 * list and the editor sends it; two copies would disagree the first time a fourth value was
 * added, and the disagreement would surface as a 400 on a screen that looked correct.
 *
 * **It collides with a section key.** `gallery` is both a media purpose and a
 * `SECTION_KEYS` entry, and they mean different things — a purpose says which part of the
 * product uploaded a file, a section key says what a template renders.
 * `scripts/check-no-hardcoded-fields.mjs` cannot tell them apart in a string literal, and it
 * is right not to try: importing the value rather than typing it is better practice anyway,
 * and it keeps the guard strict.
 */
export const MEDIA_PURPOSES = ["cover", "gallery", "profile"] as const;

export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export function isMediaPurpose(value: unknown): value is MediaPurpose {
  return (
    typeof value === "string" &&
    (MEDIA_PURPOSES as readonly string[]).includes(value)
  );
}
