import { useEffect, useState } from "react";

import type { SectionProps } from "../types.js";
import { readPath } from "../resolve-data.js";
import { SectionShell, When, rows, text } from "./primitives.js";

/**
 * P2-03 — the events, with a countdown. `docs/UI-UX/14` § Section Order 4.
 *
 * ## "Double" is the component's name, not a limit
 *
 * `EventCardDouble` is named for the common case — akad and reception — and
 * `docs/PLAN/08` is explicit that an invitation has 1..N events. It renders every event
 * it is given. A component that rendered exactly two would break the moment somebody
 * added a third, and the fix would be a new template rather than a new row.
 *
 * ## The countdown runs toward the nearest event that has not passed
 *
 * `docs/UI-UX/14` § Key Interactions, in those words. Not the first event in the list: a
 * guest opening the invitation the morning of the reception should see a countdown to the
 * reception, not a negative number counting up from the akad.
 */
export function EventCardDouble({ data, mode }: SectionProps) {
  const events = rows(readPath(data, ["events"]));
  if (events.length === 0) return null;

  return (
    <SectionShell title="Acara">
      <Countdown events={events} live={mode !== "demo"} />

      <div className="wi-stack">
        {events.map((event, index) => (
          <article key={index} className="wi-card wi-stack">
            <h3>{text(event["title"]) ?? ""}</h3>
            <When value={event["date"]}>
              {(date) => (
                <p>
                  <time dateTime={date}>{date}</time>
                  <When value={event["start_time"]}>
                    {(start) => (
                      <>
                        {" · "}
                        {start}
                        <When value={event["end_time"]}>
                          {(end) => <> – {end}</>}
                        </When>
                        {" WIB"}
                      </>
                    )}
                  </When>
                </p>
              )}
            </When>
            <When value={event["venue_name"]}>{(venue) => <p>{venue}</p>}</When>
            <When value={event["address"]}>
              {(address) => <p className="wi-muted">{address}</p>}
            </When>
            <When value={event["description"]}>
              {(description) => <p className="wi-muted">{description}</p>}
            </When>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

/**
 * The countdown.
 *
 * ## It renders a static value first, then starts ticking
 *
 * The first render must not depend on the clock. This component runs under SSR on the
 * public page, and a server-rendered second count is guaranteed to disagree with the
 * client's by the time hydration happens — React reports that as a hydration mismatch and
 * replaces the subtree. Computing on mount instead means the server emits the labels and
 * the browser fills in the numbers.
 *
 * ## It stops when there is nothing to count
 *
 * An interval that keeps firing after the wedding is a timer running forever on a page
 * people leave open. When every event has passed the section says so and the interval is
 * never started.
 */
function Countdown({
  events,
  live,
}: {
  readonly events: readonly Record<string, unknown>[];
  readonly live: boolean;
}) {
  const target = nearestUpcoming(events);
  const [remaining, setRemaining] = useState<Remaining | undefined>(undefined);

  useEffect(() => {
    if (!live || target === undefined) return undefined;

    const tick = () => {
      setRemaining(remainingUntil(target, Date.now()));
    };
    tick();

    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [target, live]);

  if (target === undefined) return null;

  const parts: [string, number | undefined][] = [
    ["Hari", remaining?.days],
    ["Jam", remaining?.hours],
    ["Menit", remaining?.minutes],
    ["Detik", remaining?.seconds],
  ];

  return (
    <ul className="wi-countdown" aria-label="Hitung mundur menuju acara">
      {parts.map(([label, value]) => (
        <li key={label}>
          {/* An em dash until the client has a number: the label is the part that must
              be identical on the server and the client. */}
          <b>{value === undefined ? "—" : String(value)}</b>
          <span className="wi-muted">{label}</span>
        </li>
      ))}
    </ul>
  );
}

interface Remaining {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

export function remainingUntil(target: number, now: number): Remaining {
  const delta = Math.max(0, target - now);
  const seconds = Math.floor(delta / 1000);

  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

/**
 * The nearest event that has not started, as a timestamp.
 *
 * ## The timezone is the interesting part
 *
 * `event_date` is a date and `start_time` is `HH:MM`, both stored without a zone
 * (`docs/DATABASE/05`). The product is Indonesian and `worker-cron` already runs in
 * `Asia/Jakarta` for the same reason — so an event at 08:00 means 08:00 WIB, which is
 * `+07:00`, and appending that is what stops a guest in another timezone seeing a
 * countdown seven hours out.
 *
 * Returning `undefined` when everything has passed is what stops the interval starting.
 */
export function nearestUpcoming(
  events: readonly Record<string, unknown>[],
  now: number = Date.now(),
): number | undefined {
  const upcoming = events
    .map((event) => toTimestamp(event))
    .filter((at): at is number => at !== undefined && at > now)
    .sort((a, b) => a - b);

  return upcoming[0];
}

function toTimestamp(event: Record<string, unknown>): number | undefined {
  const date = text(event["date"]);
  if (date === undefined) return undefined;

  const start = text(event["start_time"]) ?? "00:00";
  const at = Date.parse(`${date}T${start}:00+07:00`);
  return Number.isFinite(at) ? at : undefined;
}
