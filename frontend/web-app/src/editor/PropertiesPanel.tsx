"use client";

import { useMemo, useState } from "react";

import { getAtPath, type TemplateSectionDefinition } from "./store";
import { useEditor, useEditorContext } from "./EditorProvider";
import { FieldControl } from "./fields/FieldControl";
import { COLLECTION_PATHS, fieldMeta } from "./fields/registry";
import { validateField } from "./fields/validate";
import { GalleryManager } from "./media/GalleryManager";
import { MapPicker } from "./media/MapPicker";

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

export function PropertiesPanel() {
  const invitationId = useEditor((s) => s.invitationId);
  const definition = useEditor((s) => s.templateDefinition);
  const activeKey = useEditor((s) => s.activeSectionKey);
  const data = useEditor((s) => s.data);
  const { edit } = useEditorContext();

  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

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

  const entries = [
    ...required.map((path) => ({ path, required: true })),
    ...optional.map((path) => ({ path, required: false })),
  ];

  // A template may list both halves of a coordinate pair. The picker is rendered once.
  const seenMapPicker = new Set<string>();

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-text">
        {section.section_key}
      </h2>

      {entries.length === 0 && (
        <p className="text-sm text-text-muted">
          Bagian ini tidak memiliki isian.
        </p>
      )}

      <div className="space-y-4">
        {entries.map(({ path, required: isRequired }) => {
          const collectionReason = COLLECTION_PATHS[path];
          if (collectionReason !== undefined) {
            // A container, not a control. Rendering a text box for one would ask somebody to
            // type a list. The photo collection has a manager; the others do not yet.
            return isPhotoCollection(path) ? (
              <GalleryManager key={path} invitationId={invitationId} />
            ) : (
              <p key={path} className="text-sm text-text-muted">
                Daftar untuk bagian ini belum dapat diubah dari sini.
              </p>
            );
          }

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
              }}
            />
          );
        })}
      </div>
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
const LONGITUDE_SUFFIX = "longitude";

function siblingKey(path: string): string {
  return path.replace(/\.(latitude|longitude)$/, "");
}

function latitudePath(path: string): string {
  return `${siblingKey(path)}.${LATITUDE_SUFFIX}`;
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
