"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  sectionLabel,
  timezoneForCoordinates,
  timezoneForRegionCode,
} from "@wi/schema";

import { getAtPath, type TemplateSectionDefinition } from "./store";
import { useEditor, useEditorContext } from "./EditorProvider";
import { CollectionEditor } from "./fields/CollectionEditor";
import { FieldControl } from "./fields/FieldControl";
import {
  COLLECTION_PATHS,
  collectionPathOf,
  fieldMeta,
  zonePathBeside,
} from "./fields/registry";
import { useAuth } from "../lib/auth";
import { locateRegion } from "../lib/regions";
import { validateField } from "./fields/validate";
import { GalleryManager } from "./media/GalleryManager";
import { MapPicker } from "./media/MapPicker";
import { COLLECTIONS } from "./transport";

/**
 * P1-23 step 2 — the properties panel. `docs/FRONTEND/03`, `docs/UI-UX/12` § Properties Panel.
 *
 * ## The whole panel is a loop over the template's own lists
 *
 * The active section names `required_fields` and `optional_fields`; each path is resolved to
 * a control through the registry. There is no switch on a section key anywhere, and there is
 * no component named after a section. Adding a field to a template's `required_fields`
 * changes the rendered form with **no frontend change at all** — which is the card's first
 * definition-of-done item and the reason the template system exists (`docs/PLAN/07`).
 *
 * ## Collections are rows (`P2-15`)
 *
 * A template names a collection's fields by pattern — `events.*.title`. Until `P2-15` the panel
 * rendered one control per pattern, bound to the literal path `events.*.title`, which no data
 * has: the fields were always empty and an edit never reached the API. The patterns of one
 * collection are now gathered into a `CollectionEditor`, which draws them once per row,
 * addressed by the row's id, with add and delete. Which collections exist is read from the
 * registry and the transport, never named here.
 *
 * ## Required is marked; optional is explained
 *
 * `docs/UI-UX/12` § Properties Panel. A field a couple must fill before publishing is worth
 * distinguishing from one they may skip, because BR-4.2 will block the publish and they will
 * want to know which is which before they get there.
 *
 * ## Unknown paths are listed, not swallowed
 *
 * A template version can reference a path this build does not recognise — it was written
 * against a later registry, or a field was removed. Rendering nothing would show a section
 * that is silently missing a control. It says so instead, quietly, where somebody can see it.
 */

interface Entry {
  readonly path: string;
  readonly required: boolean;
}

export function PropertiesPanel() {
  const invitationId = useEditor((s) => s.invitationId);
  const definition = useEditor((s) => s.templateDefinition);
  const activeKey = useEditor((s) => s.activeSectionKey);
  const data = useEditor((s) => s.data);
  const { edit, store } = useEditorContext();
  const { api } = useAuth();

  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  /*
   * `P2-17`. A pin moved: once it has been still for a moment, ask the API which province's real
   * boundary contains it. That answer replaces the instant coordinate rule's zone, and fills the
   * region when the couple has not chosen one — or has chosen one in a different province, which a
   * moved pin has just contradicted. A region they chose inside the same province is left alone.
   */
  const locateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(locateTimer.current), []);
  const refineFromBoundary = (
    pinPath: string,
    latitude: number,
    longitude: number,
  ) => {
    clearTimeout(locateTimer.current);
    locateTimer.current = setTimeout(() => {
      void locateRegion(api, latitude, longitude).then((located) => {
        if (located === undefined) return;
        edit(zonePathBeside(pinPath), located.timezone);
        const regionPath = regionPathBeside(pinPath);
        const current = getAtPath(store.getState().data, regionPath);
        const chosen = typeof current === "string" ? current : "";
        if (chosen === "" || !chosen.startsWith(located.province.code)) {
          edit(regionPath, located.regency?.code ?? located.province.code);
        }
      });
    }, LOCATE_DELAY_MS);
  };

  const section = useMemo(
    () => definition?.sections.find((s) => s.section_key === activeKey),
    [definition, activeKey],
  );

  if (definition === undefined) {
    return (
      <p className="text-sm text-text-muted">
        Definisi template belum tersedia.
      </p>
    );
  }

  if (section === undefined) {
    return (
      <p className="text-sm text-text-muted">
        Pilih salah satu bagian untuk mulai mengisi.
      </p>
    );
  }

  const required = section.required_fields ?? [];
  const optional = readOptional(section);

  const entries: Entry[] = [
    ...required.map((path) => ({ path, required: true })),
    ...optional.map((path) => ({ path, required: false })),
  ];

  // A template may list both halves of a coordinate pair. The picker is rendered once.
  const seenMapPicker = new Set<string>();

  /** One control for one concrete path — a scalar, or one field of one row. */
  const renderField = (path: string, isRequired: boolean): ReactNode => {
    const meta = fieldMeta(path);
    if (meta === undefined) {
      return (
        <p key={path} className="text-sm text-text-muted">
          Isian ini belum dikenali oleh versi aplikasi ini.
        </p>
      );
    }

    // Latitude and longitude are one control, and the picker writes both. Rendering it
    // once -- on whichever of the pair comes first -- avoids two maps on one screen
    // fighting over the same coordinates.
    if (meta.type === "map-picker") {
      if (seenMapPicker.has(siblingKey(path))) return null;
      seenMapPicker.add(siblingKey(path));

      const lat = asNumber(getAtPath(data, latitudePath(path)));
      const lng = asNumber(getAtPath(data, longitudePath(path)));

      return (
        <MapPicker
          key={path}
          latitude={lat}
          longitude={lng}
          label={meta.label}
          onChange={(next) => {
            edit(latitudePath(path), next.latitude);
            edit(longitudePath(path), next.longitude);
            // `P2-16`, ADR-070 (`OQ-27`): the pin decides the event's zone — at once by the
            // coordinate rule, then exactly by the province boundary (`P2-17`). The zone field
            // stays editable for a wedding abroad.
            const zone = timezoneForCoordinates(next.latitude, next.longitude);
            if (zone !== undefined) edit(zonePathBeside(path), zone);
            refineFromBoundary(path, next.latitude, next.longitude);
          }}
        />
      );
    }

    const value = getAtPath(data, path);
    const error = touched.has(path)
      ? validateField(meta, path, value)
      : undefined;

    return (
      <FieldControl
        key={path}
        path={path}
        meta={meta}
        value={value}
        required={isRequired}
        {...(error !== undefined ? { error } : {})}
        onChange={(next) => {
          // Touched on first change, not on mount: a form that shows errors before
          // anybody has typed is a form that shouts at people for arriving.
          setTouched((current) =>
            current.has(path) ? current : new Set(current).add(path),
          );
          edit(path, next);
          // `P2-17`: a chosen region decides the zone from its province, exactly.
          if (meta.type === "region" && typeof next === "string") {
            const zone = timezoneForRegionCode(next);
            if (zone !== undefined) edit(zonePathBeside(path), zone);
          }
        }}
      />
    );
  };

  // Gather each collection's patterns in the order the template lists them, and draw the
  // collection where its first pattern appears.
  const rendered: ReactNode[] = [];
  const drawnCollections = new Set<string>();

  for (const { path } of entries) {
    const collectionPath = collectionPathOf(path);
    const collection = COLLECTIONS.find((c) => c.path === collectionPath);

    if (collectionPath !== undefined && collection !== undefined) {
      if (drawnCollections.has(collectionPath)) continue;
      drawnCollections.add(collectionPath);

      const fields = entries
        .filter(
          (entry) =>
            entry.path === collectionPath ||
            entry.path.startsWith(`${collectionPath}.*.`),
        )
        .map((entry) => ({
          name:
            entry.path === collectionPath
              ? undefined
              : entry.path.slice(collectionPath.length + 3),
          required: entry.required,
        }));

      rendered.push(
        <CollectionEditor
          key={collectionPath}
          collection={collection}
          // A bare container path (`events`) means "the section shows this list": every
          // field of a row is offered. Patterns narrow it to what the template draws.
          fields={fields.flatMap((f) =>
            f.name === undefined
              ? []
              : [{ name: f.name, required: f.required }],
          )}
          allFields={fields.some((f) => f.name === undefined)}
          renderField={renderField}
        />,
      );
      continue;
    }

    if (collectionPath !== undefined && path !== collectionPath) {
      // A field of a collection that has its own manager (the photos: caption, cover and
      // order are edited inside it). A control bound to the pattern itself would edit nothing.
      continue;
    }

    if (COLLECTION_PATHS[path] !== undefined) {
      // A container the transport has no row endpoint for. The photo collection has its own
      // manager, which uploads through `docs/API/05`.
      rendered.push(
        isPhotoCollection(path) ? (
          <GalleryManager key={path} invitationId={invitationId} />
        ) : (
          <p key={path} className="text-sm text-text-muted">
            Daftar untuk bagian ini belum dapat diubah dari sini.
          </p>
        ),
      );
      continue;
    }

    rendered.push(
      renderField(path, entries.find((e) => e.path === path)!.required),
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-text">
        {sectionLabel(section.section_key)}
      </h2>

      {entries.length === 0 && (
        <p className="text-sm text-text-muted">
          Bagian ini tidak memiliki isian.
        </p>
      )}

      <div className="space-y-4">{rendered}</div>
    </div>
  );
}

/**
 * `optional_fields`, tolerating a definition that predates it.
 *
 * `sectionSchema` defaults it to `[]`, so a validated definition always has one — but the
 * store holds whatever the API returned, and a row written before the default existed would
 * not. Reading it defensively costs a line and avoids a blank panel.
 */
function readOptional(section: TemplateSectionDefinition): string[] {
  const value: unknown = section.optional_fields;
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * The two coordinate paths of one event, derived from either of them.
 *
 * The suffix is what distinguishes them, so a path is rewritten rather than matched against a
 * literal — `scripts/check-no-hardcoded-fields.mjs` refuses a canonical path in a component,
 * and it is right to: a component that named `events.*.latitude` would be a component that
 * knew about events.
 */
const LATITUDE_SUFFIX = "latitude";
const REGION_SUFFIX = "region_code";

/** How long a pin must be still before the boundary lookup runs. */
const LOCATE_DELAY_MS = 600;
const LONGITUDE_SUFFIX = "longitude";

function siblingKey(path: string): string {
  return path.replace(/\.(latitude|longitude)$/, "");
}

function latitudePath(path: string): string {
  return `${siblingKey(path)}.${LATITUDE_SUFFIX}`;
}

function regionPathBeside(path: string): string {
  return `${siblingKey(path)}.${REGION_SUFFIX}`;
}

function longitudePath(path: string): string {
  return `${siblingKey(path)}.${LONGITUDE_SUFFIX}`;
}

/** The photo collection, recognised by its own registry entry rather than by its name. */
function isPhotoCollection(path: string): boolean {
  return fieldMeta(`${path}.*.media_id`)?.type === "photo-multi";
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
