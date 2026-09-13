"use client";

import { useEffect, useState } from "react";

import { Select } from "@wi/ui";

import { useAuth } from "../../lib/auth";
import { listRegions, type Region } from "../../lib/regions";

/**
 * `P2-17` — choosing where an event is, from Indonesia's administrative regions: province,
 * regency or city, district, village. `MEMORY/specs/P2-17-regions.md`.
 *
 * ## Four selects, each loaded from the one above
 *
 * The full list is 91,599 regions; a district has at most a few dozen villages. Each level is
 * fetched when its parent is chosen (`GET /regions?parent=`), and the API caches every answer for a
 * day. Choosing a higher level clears the levels below it — a village in the old regency is not in
 * the new one.
 *
 * ## The value is the most specific choice
 *
 * The stored `region_code` is whatever the couple chose last, at any depth: a province alone is a
 * valid answer for "where", and the one that decides the timezone. The ancestors of a stored code
 * are read off its own segments (`51.71.01.1001` → `51`, `51.71`, `51.71.01`), so an existing value
 * reopens with every level selected and no extra request.
 */

const LEVELS = [
  { label: "Provinsi", placeholder: "Pilih provinsi" },
  { label: "Kabupaten/Kota", placeholder: "Pilih kabupaten atau kota" },
  { label: "Kecamatan", placeholder: "Pilih kecamatan" },
  { label: "Kelurahan/Desa", placeholder: "Pilih kelurahan atau desa" },
] as const;

export interface RegionPickerProps {
  readonly label: string;
  readonly value: string | null | undefined;
  readonly onChange: (code: string | null) => void;
}

/** `51.71.01` → `["51", "51.71", "51.71.01"]`. */
export function selectedChain(code: string | null | undefined): string[] {
  if (code === null || code === undefined || code === "") return [];
  const parts = code.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

export function RegionPicker({ label, value, onChange }: RegionPickerProps) {
  const { api } = useAuth();
  const chain = selectedChain(value);
  const [options, setOptions] = useState<readonly (readonly Region[])[]>([]);
  const [problem, setProblem] = useState("");

  // Load the provinces, and the children of every selected level — one request per level, run
  // again whenever the chain changes.
  const chainKey = chain.join("|");
  useEffect(() => {
    let cancelled = false;
    const parents = [undefined, ...chain].slice(0, LEVELS.length);
    Promise.all(parents.map((parent) => listRegions(api, parent)))
      .then((lists) => {
        if (!cancelled) {
          setOptions(lists);
          setProblem("");
        }
      })
      .catch(() => {
        if (!cancelled)
          setProblem("Daftar wilayah tidak bisa dimuat. Coba lagi nanti.");
      });
    return () => {
      cancelled = true;
    };
    // `chainKey` stands for `chain`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, chainKey]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-text">{label}</legend>
      {LEVELS.map((level, depth) => {
        const list = options[depth] ?? [];
        // A level shows once its parent is chosen, and not at all when the parent has no
        // children (a village is the last level).
        if (depth > 0 && chain[depth - 1] === undefined) return null;
        if (depth > 0 && options[depth] !== undefined && list.length === 0)
          return null;
        return (
          <Select
            key={level.label}
            label={level.label}
            placeholder={level.placeholder}
            searchable={list.length > 12}
            searchLabel={`Cari ${level.label.toLowerCase()}`}
            value={chain[depth] ?? ""}
            options={list.map((region) => ({
              value: region.code,
              label: region.name,
            }))}
            onChange={(e) => {
              const code = e.target.value;
              // Choosing nothing at a level falls back to the level above.
              onChange(code === "" ? (chain[depth - 1] ?? null) : code);
            }}
          />
        );
      })}
      {problem !== "" && (
        <p role="status" className="text-sm text-text-muted">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
