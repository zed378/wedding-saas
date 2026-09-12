"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@wi/ui";

/**
 * P1-24 step 6 — the map picker. `docs/PLAN/04` § F5, ADR-014 (MapLibre GL over OSM tiles).
 *
 * ## The coordinates are the contract; the map is the convenience
 *
 * What this component owes the form is a latitude and a longitude the events endpoint
 * accepts. The map makes that pleasant on a phone at eleven at night; the two number inputs
 * beneath it make it **possible** without WebGL, without a tile server, and with a keyboard.
 *
 * That ordering is not politeness. MapLibre needs WebGL, which jsdom does not have and some
 * corporate browsers disable — so a picker that existed only as a map would be a field a
 * subset of users simply could not fill in, and no test in this repository could exercise it.
 * The inputs are the control; the map writes into them.
 *
 * ## The public page loads no map at all
 *
 * Worth saying here because this is the file somebody would copy. `docs/PLAN/04` § F5 and the
 * card are explicit: the invitation page gets a **static image plus a deep link** (`P2-03`).
 * A map SDK on a page hundreds of guests open on mobile data is a JS budget and a per-load
 * cost for something nobody interacts with.
 */

export interface MapPickerProps {
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
  readonly onChange: (position: {
    latitude: number;
    longitude: number;
  }) => void;
  readonly label?: string;
}

/** Jakarta. Somewhere is better than the middle of the Atlantic at zoom 0. */
const DEFAULT_CENTER = { lat: -6.2088, lng: 106.8456 };

export function MapPicker({
  latitude,
  longitude,
  onChange,
  label = "Lokasi acara",
}: MapPickerProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (container.current === null) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        // Imported lazily, and this is the reason: MapLibre is several hundred kilobytes and
        // the editor's other panels have no use for it. A static import would put it in the
        // bundle of every screen that renders the editor shell.
        const maplibre = await import("maplibre-gl");
        if (cancelled || container.current === null) return;

        const map = new maplibre.Map({
          container: container.current,
          // A demo tile source. `docs/DEVOPS/02` will want a configured one before launch —
          // recorded as a follow-up rather than a key checked into the repository.
          style: "https://demotiles.maplibre.org/style.json",
          center: [
            longitude ?? DEFAULT_CENTER.lng,
            latitude ?? DEFAULT_CENTER.lat,
          ],
          zoom: latitude === undefined ? 9 : 14,
        });

        const marker = new maplibre.Marker({ draggable: true })
          .setLngLat([
            longitude ?? DEFAULT_CENTER.lng,
            latitude ?? DEFAULT_CENTER.lat,
          ])
          .addTo(map);

        marker.on("dragend", () => {
          const { lat, lng } = marker.getLngLat();
          onChange({ latitude: round(lat), longitude: round(lng) });
        });

        map.on("click", (event) => {
          marker.setLngLat(event.lngLat);
          onChange({
            latitude: round(event.lngLat.lat),
            longitude: round(event.lngLat.lng),
          });
        });

        cleanup = () => {
          map.remove();
        };
      } catch {
        // No WebGL, no network, a blocked tile host. The inputs below still work, and saying
        // so is better than an empty grey box somebody assumes is loading.
        if (!cancelled) setMapFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Deliberately once: re-creating the map on every coordinate change would fight the user
    // as they drag. The marker is moved by the drag itself, and typing into the inputs is
    // not expected to recentre the map mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-text">{label}</legend>

      <div
        ref={container}
        // Not `aria-hidden`: it is decorative only in the sense that everything it does is
        // also achievable through the inputs. A screen-reader user is told what it is and
        // that the fields below are the way in.
        role="application"
        aria-label="Peta untuk memilih lokasi. Gunakan kolom lintang dan bujur di bawah sebagai alternatif."
        className="h-56 w-full rounded-md border border-border bg-surface-sunken"
      />

      {mapFailed && (
        <p role="status" className="text-sm text-text-muted">
          Peta tidak dapat dimuat. Isi koordinat secara manual di bawah.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Lintang (latitude)"
          type="number"
          step="0.000001"
          name="latitude"
          value={latitude === undefined ? "" : String(latitude)}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (!Number.isNaN(value)) {
              onChange({ latitude: value, longitude: longitude ?? 0 });
            }
          }}
        />
        <Input
          label="Bujur (longitude)"
          type="number"
          step="0.000001"
          name="longitude"
          value={longitude === undefined ? "" : String(longitude)}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (!Number.isNaN(value)) {
              onChange({ latitude: latitude ?? 0, longitude: value });
            }
          }}
        />
      </div>
    </fieldset>
  );
}

/**
 * Six decimal places, which is what `DECIMAL(9,6)` stores.
 *
 * Sending more would be silently truncated by the database, so the value the user sees and
 * the value that comes back would differ — and `docs/DATABASE/05` chose the precision
 * deliberately: six places is about 0.1 metres, which is finer than any wedding venue needs.
 */
export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
