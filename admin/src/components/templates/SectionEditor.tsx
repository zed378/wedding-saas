import { useState } from "react";
import {
  SECTION_KEYS,
  componentsForSection,
  FIELD_LABELS,
  type SectionKey,
  type SectionDefinition,
} from "@wi/schema";
import { Button, Card, CardHeader, Input, Badge } from "@wi/ui";

interface SectionEditorProps {
  sections: SectionDefinition[];
  onChange: (sections: SectionDefinition[]) => void;
  disabled?: boolean;
}

const AVAILABLE_FIELDS = Object.keys(FIELD_LABELS);

export function SectionEditor({
  sections,
  onChange,
  disabled = false,
}: SectionEditorProps) {
  const [selectedKeyToAdd, setSelectedKeyToAdd] = useState<SectionKey>("hero");

  const handleAddSection = () => {
    const availableComponents = componentsForSection(selectedKeyToAdd);
    const defaultComponent = availableComponents[0] || "HeroClassic";

    const newSection: SectionDefinition = {
      section_key: selectedKeyToAdd,
      component: defaultComponent,
      enabled_by_default: true,
      configurable: true,
      required_fields: [],
      optional_fields: [],
    };

    onChange([...sections, newSection]);
  };

  const handleRemoveSection = (index: number) => {
    const updated = sections.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...sections];
    const temp = updated[index - 1]!;
    updated[index - 1] = updated[index]!;
    updated[index] = temp;
    onChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index >= sections.length - 1) return;
    const updated = [...sections];
    const temp = updated[index + 1]!;
    updated[index + 1] = updated[index]!;
    updated[index] = temp;
    onChange(updated);
  };

  const handleUpdateSection = (
    index: number,
    patch: Partial<SectionDefinition>,
  ) => {
    const updated = sections.map((sec, i) =>
      i === index ? { ...sec, ...patch } : sec,
    );
    onChange(updated);
  };

  const toggleField = (
    index: number,
    type: "required_fields" | "optional_fields",
    fieldPath: string,
  ) => {
    const sec = sections[index];
    if (!sec) return;
    const currentList = (sec[type] as string[]) || [];
    const exists = currentList.includes(fieldPath);
    const updatedList = exists
      ? currentList.filter((f) => f !== fieldPath)
      : [...currentList, fieldPath];

    handleUpdateSection(index, { [type]: updatedList });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-subtle p-4 border border-border">
        <div>
          <h3 className="text-body-lg font-semibold">Struktur & Bagian Undangan</h3>
          <p className="text-body-sm text-text-muted">
            Atur urutan bagian, komponen renderer resmi, serta pemetaan field data kanonikal
          </p>
        </div>

        {!disabled && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Pilih jenis bagian untuk ditambahkan"
              value={selectedKeyToAdd}
              onChange={(e) => setSelectedKeyToAdd(e.target.value as SectionKey)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-body-sm focus:border-primary focus:outline-none"
            >
              {SECTION_KEYS.map((key) => (
                <option key={key} value={key}>
                  Bagian: {key}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={handleAddSection}>
              + Tambah Bagian
            </Button>
          </div>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">
          Belum ada bagian yang dikonfigurasi. Pilih jenis bagian di atas dan klik Tambah Bagian.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((sec, idx) => {
            const availableComponents = componentsForSection(
              sec.section_key as SectionKey,
            );
            const reqFields = (sec.required_fields as string[]) || [];
            const optFields = (sec.optional_fields as string[]) || [];

            return (
              <Card key={`${sec.section_key}-${idx}`} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-subtle text-body-xs font-semibold text-text-muted">
                      {idx + 1}
                    </span>
                    <span className="text-body-base font-bold capitalize">
                      {sec.section_key}
                    </span>
                    <Badge tone="primary">{sec.component}</Badge>
                  </div>

                  {!disabled && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMoveUp(idx)}
                        disabled={idx === 0}
                        title="Pindahkan ke atas"
                      >
                        ▲
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMoveDown(idx)}
                        disabled={idx === sections.length - 1}
                        title="Pindahkan ke bawah"
                      >
                        ▼
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleRemoveSection(idx)}
                      >
                        Hapus
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-body-xs font-semibold text-text-muted block mb-1">
                      Komponen Renderer
                    </label>
                    <select
                      value={sec.component}
                      disabled={disabled}
                      onChange={(e) =>
                        handleUpdateSection(idx, { component: e.target.value })
                      }
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-body-sm focus:border-primary focus:outline-none"
                    >
                      {availableComponents.map((comp) => (
                        <option key={comp} value={comp}>
                          {comp}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Input
                      label="Layout Variant (opsional)"
                      value={sec.layout_variant ?? ""}
                      disabled={disabled}
                      placeholder="e.g. grid-3col, carousel"
                      onChange={(e) =>
                        handleUpdateSection(idx, {
                          layout_variant: e.target.value || undefined,
                        })
                      }
                    />
                  </div>

                  <div>
                    <Input
                      label="Max Items (opsional)"
                      type="number"
                      value={sec.max_items !== undefined ? String(sec.max_items) : ""}
                      disabled={disabled}
                      placeholder="e.g. 20"
                      onChange={(e) =>
                        handleUpdateSection(idx, {
                          max_items: e.target.value
                            ? Number.parseInt(e.target.value, 10)
                            : undefined,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-6">
                  <label className="flex items-center gap-2 text-body-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sec.enabled_by_default ?? true}
                      disabled={disabled}
                      onChange={(e) =>
                        handleUpdateSection(idx, {
                          enabled_by_default: e.target.checked,
                        })
                      }
                      className="rounded border-border text-primary"
                    />
                    <span>Aktif secara default</span>
                  </label>

                  <label className="flex items-center gap-2 text-body-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sec.configurable ?? true}
                      disabled={disabled}
                      onChange={(e) =>
                        handleUpdateSection(idx, {
                          configurable: e.target.checked,
                        })
                      }
                      className="rounded border-border text-primary"
                    />
                    <span>Dapat diubah pengguna (configurable)</span>
                  </label>
                </div>

                {/* Field mappings selected from canonical registry */}
                <div className="mt-4 border-t border-border pt-3">
                  <div className="text-body-xs font-semibold text-text-muted mb-2">
                    Pemetaan Field Kanonikal (Dipilih dari daftar resmi, bukan teks bebas)
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-md border border-border p-3 bg-surface-subtle">
                      <div className="text-body-xs font-semibold mb-1.5 flex items-center justify-between">
                        <span>Wajib Diisi (Required Fields)</span>
                        <span className="text-text-muted">{reqFields.length} dipilih</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                        {AVAILABLE_FIELDS.filter((f) =>
                          f.startsWith(sec.section_key) ||
                          (sec.section_key === "event" && f.startsWith("events")) ||
                          (sec.section_key === "closing" && f.startsWith("couple")),
                        ).map((fieldPath) => {
                          const checked = reqFields.includes(fieldPath);
                          return (
                            <label
                              key={fieldPath}
                              className="flex items-center gap-2 text-body-xs hover:bg-surface p-1 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() =>
                                  toggleField(idx, "required_fields", fieldPath)
                                }
                                className="rounded text-primary"
                              />
                              <span className="font-mono text-text">{fieldPath}</span>
                              <span className="text-text-muted ml-auto truncate">
                                {FIELD_LABELS[fieldPath as keyof typeof FIELD_LABELS]}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-md border border-border p-3 bg-surface-subtle">
                      <div className="text-body-xs font-semibold mb-1.5 flex items-center justify-between">
                        <span>Opsional (Optional Fields)</span>
                        <span className="text-text-muted">{optFields.length} dipilih</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                        {AVAILABLE_FIELDS.filter((f) =>
                          f.startsWith(sec.section_key) ||
                          (sec.section_key === "event" && f.startsWith("events")) ||
                          (sec.section_key === "closing" && f.startsWith("couple")),
                        ).map((fieldPath) => {
                          const checked = optFields.includes(fieldPath);
                          return (
                            <label
                              key={fieldPath}
                              className="flex items-center gap-2 text-body-xs hover:bg-surface p-1 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() =>
                                  toggleField(idx, "optional_fields", fieldPath)
                                }
                                className="rounded text-primary"
                              />
                              <span className="font-mono text-text">{fieldPath}</span>
                              <span className="text-text-muted ml-auto truncate">
                                {FIELD_LABELS[fieldPath as keyof typeof FIELD_LABELS]}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
