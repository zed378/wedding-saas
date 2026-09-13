/**
 * `P2-15` — a time of day as the API accepts it: `HH:MM`.
 *
 * `invitation_events.start_time` is a Postgres `time`, which reads back as `HH:MM:SS`. The
 * write schema accepts only `HH:MM` (`docs/API/04` § Events, "Gunakan format HH:MM"), so a
 * value served as-is could not be sent back: the editor read `08:00:00`, and the PATCH it
 * built from that was refused. It also put `08:00:00` on published invitations.
 *
 * Every place an event time leaves the API goes through this, so the read shape and the write
 * shape are the same shape. Seconds are dropped, never rounded: the write schema cannot
 * produce them, so any seconds present are Postgres's formatting, not data.
 */
export function toClockTime(value: string): string;
export function toClockTime(value: string | null): string | null;
export function toClockTime(
  value: string | null | undefined,
): string | null | undefined;
export function toClockTime(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  const match = /^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  return match === null ? value : match[1]!;
}
