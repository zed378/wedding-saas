import { useState, useEffect, useMemo } from "react";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { Button, Card, Badge, Input, Modal } from "@wi/ui";
import { SectionEditor } from "../components/templates/SectionEditor.js";
import { ThemeEditor } from "../components/templates/ThemeEditor.js";
import { TemplatePreview } from "../components/templates/TemplatePreview.js";
import {
  AssetUploader,
  type TemplateAssetItem,
} from "../components/templates/AssetUploader.js";
import type { SectionDefinition, Theme } from "@wi/schema";

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  version: string;
  sections: SectionDefinition[];
  theme: Theme;
  customizableThemeKeys: string[];
  changelog?: string | null | undefined;
  status: "draft" | "published" | "deprecated";
  releasedAt?: string | null | undefined;
  createdAt: string;
  invitation_count: number;
}

export interface TemplateRecord {
  id: string;
  slug: string;
  name: string;
  category: string[];
  isPremium: boolean;
  thumbnailUrl?: string | null | undefined;
  status: "draft" | "published" | "deprecated";
  createdAt: string;
  updatedAt: string;
  versions: TemplateVersionRecord[];
}

const DEFAULT_THEME: Theme = {
  colors: {
    primary: "#8B5E3C",
    secondary: "#F4EDE4",
    accent: "#C9A876",
    text: "#2B2B2B",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Inter",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

const DEFAULT_SECTIONS: SectionDefinition[] = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
    optional_fields: [],
  },
  {
    section_key: "couple",
    component: "CoupleProfile",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["couple.groom.full_name", "couple.bride.full_name"],
    optional_fields: [],
  },
  {
    section_key: "event",
    component: "EventCardDouble",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["events.*.date"],
    optional_fields: ["events.*.timezone"],
  },
  {
    section_key: "rsvp",
    component: "RsvpForm",
    enabled_by_default: true,
    configurable: false,
    required_fields: [],
    optional_fields: [],
  },
];

export function TemplatesPage() {
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl:
          window.location.hostname === "localhost"
            ? "http://localhost:3000"
            : window.location.origin,
        tokenStore: accessTokenStore,
      }),
    [],
  );
  const [templatesList, setTemplatesList] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<
    "sections" | "theme" | "assets" | "preview"
  >("sections");

  // Modals state
  const [isNewTemplateModalOpen, setIsNewTemplateModalOpen] = useState(false);
  const [isNewVersionModalOpen, setIsNewVersionModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isDeprecateModalOpen, setIsDeprecateModalOpen] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // New Template form state
  const [newTplSlug, setNewTplSlug] = useState("");
  const [newTplName, setNewTplName] = useState("");
  const [newTplCategories, setNewTplCategories] = useState(
    "traditional, elegant",
  );
  const [newTplIsPremium, setNewTplIsPremium] = useState(false);
  const [newTplThumbnail, setNewTplThumbnail] = useState("");

  // New Version form state
  const [newVersionNumber, setNewVersionNumber] = useState("1.0.0");
  const [newVersionChangelog, setNewVersionChangelog] = useState("");

  // Version edit working state
  const [workingSections, setWorkingSections] =
    useState<SectionDefinition[]>(DEFAULT_SECTIONS);
  const [workingTheme, setWorkingTheme] = useState<Theme>(DEFAULT_THEME);
  const [workingCustomizableKeys, setWorkingCustomizableKeys] = useState<
    string[]
  >(["colors.primary", "colors.secondary"]);
  const [workingAssets, setWorkingAssets] = useState<TemplateAssetItem[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(false);
    client
      .get<TemplateRecord[]>("/api/v1/admin/templates", {
        signal: abort.signal,
      })
      .then((result) => {
        if (!abort.signal.aborted) setTemplatesList(result.data);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, reload]);

  const selectedTemplate = templatesList.find(
    (t) => t.id === selectedTemplateId,
  );

  const selectedVersion =
    selectedTemplate?.versions.find((v) => v.id === selectedVersionId) ||
    selectedTemplate?.versions[0];

  // Update working buffers when selected version changes
  useEffect(() => {
    if (selectedVersion) {
      setWorkingSections(selectedVersion.sections || DEFAULT_SECTIONS);
      setWorkingTheme(selectedVersion.theme || DEFAULT_THEME);
      setWorkingCustomizableKeys(
        selectedVersion.customizableThemeKeys || ["colors.primary"],
      );
      setSelectedVersionId(selectedVersion.id);
    }
  }, [selectedTemplateId, selectedVersionId]);

  // Filter templates list
  const filteredTemplates = templatesList.filter((tpl) => {
    const matchesSearch =
      tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ? true : tpl.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleCreateTemplate = async () => {
    setActionError(null);
    if (!newTplSlug.trim() || !newTplName.trim()) {
      setActionError("Slug dan Nama Templat wajib diisi.");
      return;
    }
    if (actionReason.trim().length < 5) {
      setActionError("Alasan audit wajib diisi minimal 5 karakter.");
      return;
    }

    const categoriesArray = newTplCategories
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const result = await client.post<TemplateRecord>(
        "/api/v1/admin/templates",
        {
          slug: newTplSlug.trim(),
          name: newTplName.trim(),
          category: categoriesArray,
          is_premium: newTplIsPremium,
          thumbnail_url: newTplThumbnail.trim() || undefined,
          reason: actionReason.trim(),
        },
      );
      const created = { ...result.data, versions: [] };
      setTemplatesList((current) => [created, ...current]);
      setSelectedTemplateId(created.id);
      setSelectedVersionId(null);
      setWorkingSections(DEFAULT_SECTIONS);
      setWorkingTheme(DEFAULT_THEME);
      setWorkingCustomizableKeys(["colors.primary", "colors.secondary"]);
      setIsNewTemplateModalOpen(false);
      setActionReason("");
    } catch {
      setActionError("Templat gagal dibuat. Periksa data lalu coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateVersion = async () => {
    setActionError(null);
    if (
      !selectedTemplateId ||
      !newVersionNumber.trim() ||
      actionReason.trim().length < 5
    ) {
      setActionError(
        "Nomor versi dan alasan audit minimal 5 karakter wajib diisi.",
      );
      return;
    }
    setSaving(true);
    try {
      const result = await client.post<TemplateVersionRecord>(
        "/api/v1/admin/templates/" + selectedTemplateId + "/versions",
        {
          version: newVersionNumber.trim(),
          sections: workingSections,
          theme: workingTheme,
          customizable_theme_keys: workingCustomizableKeys,
          changelog: newVersionChangelog.trim() || undefined,
          reason: actionReason.trim(),
        },
      );
      const version = { ...result.data, invitation_count: 0 };
      setTemplatesList((current) =>
        current.map((t) =>
          t.id === selectedTemplateId
            ? { ...t, versions: [version, ...t.versions] }
            : t,
        ),
      );
      setSelectedVersionId(version.id);
      setIsNewVersionModalOpen(false);
      setActionReason("");
    } catch {
      setActionError(
        "Versi gagal dibuat. Periksa nomor versi dan definisinya.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVersion = async () => {
    if (
      !selectedTemplate ||
      !selectedVersion ||
      selectedVersion.status !== "draft" ||
      saveReason.trim().length < 5
    )
      return;
    setSaving(true);
    setSaveMessage("");
    try {
      const result = await client.patch<TemplateVersionRecord>(
        "/api/v1/admin/templates/" +
          selectedTemplate.id +
          "/versions/" +
          selectedVersion.id,
        {
          sections: workingSections,
          theme: workingTheme,
          customizable_theme_keys: workingCustomizableKeys,
          reason: saveReason.trim(),
        },
      );
      setTemplatesList((current) =>
        current.map((t) =>
          t.id === selectedTemplate.id
            ? {
                ...t,
                versions: t.versions.map((v) =>
                  v.id === selectedVersion.id
                    ? { ...result.data, invitation_count: v.invitation_count }
                    : v,
                ),
              }
            : t,
        ),
      );
      setSaveMessage("Draf versi tersimpan.");
    } catch {
      setSaveMessage("Draf gagal disimpan. Perubahan lokal belum tersimpan.");
    } finally {
      setSaving(false);
    }
  };

  const changeVersionStatus = async (action: "publish" | "deprecate") => {
    if (!selectedTemplate || !selectedVersion) return;
    if (actionReason.trim().length < 5) {
      setActionError("Alasan audit wajib diisi minimal 5 karakter.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await client.post(
        "/api/v1/admin/templates/" +
          selectedTemplate.id +
          "/versions/" +
          selectedVersion.id +
          "/" +
          action,
        { reason: actionReason.trim() },
      );
      const result = await client.get<TemplateRecord>(
        "/api/v1/admin/templates/" + selectedTemplate.id,
      );
      setTemplatesList((current) =>
        current.map((t) => (t.id === result.data.id ? result.data : t)),
      );
      setIsPublishModalOpen(false);
      setIsDeprecateModalOpen(false);
      setActionReason("");
    } catch {
      setActionError(
        "Status versi gagal diperbarui. Periksa kondisi versi lalu coba lagi.",
      );
    } finally {
      setSaving(false);
    }
  };
  const handlePublishVersion = () => changeVersionStatus("publish");
  const handleDeprecateVersion = () => changeVersionStatus("deprecate");

  const isSelectedVersionImmutable =
    selectedVersion?.status === "published" ||
    selectedVersion?.status === "deprecated";

  if (loading) return <p role="status">Memuat katalog templat…</p>;
  if (loadError)
    return (
      <div role="alert">
        <p>Katalog templat gagal dimuat.</p>
        <Button onClick={() => setReload((value) => value + 1)}>
          Coba lagi
        </Button>
      </div>
    );

  // Catalog View
  if (!selectedTemplate) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-display font-bold">Katalog Templat</h1>
            <p className="mt-1 text-body text-text-muted">
              Manajemen templat data-driven, skema versi JSONB, dan rilis tanpa
              deploy
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setIsNewTemplateModalOpen(true);
              setActionError(null);
            }}
          >
            + Tambah Templat Baru
          </Button>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface border border-border p-4">
          <div className="w-full sm:w-72">
            <Input
              label="Cari templat atau slug"
              labelHidden
              type="search"
              placeholder="Cari templat atau slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Cari templat"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-body-sm text-text-muted">Status:</span>
            {(["all", "published", "draft", "deprecated"] as const).map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                    statusFilter === st
                      ? "bg-primary text-white"
                      : "bg-surface-subtle text-text-muted hover:bg-surface border border-border"
                  }`}
                >
                  {st === "all" ? "Semua" : st}
                </button>
              ),
            )}
          </div>
        </div>

        {filteredTemplates.length === 0 && (
          <p>Belum ada templat yang sesuai.</p>
        )}
        {/* Templates Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((tpl) => (
            <Card key={tpl.id} className="flex flex-col overflow-hidden">
              <div className="h-44 bg-surface-subtle overflow-hidden relative border-b border-border">
                {tpl.thumbnailUrl ? (
                  <img
                    src={tpl.thumbnailUrl}
                    alt={tpl.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl text-text-muted">
                    💌
                  </div>
                )}
                <div className="absolute top-3 left-3 flex gap-2">
                  <Badge
                    tone={
                      tpl.status === "published"
                        ? "success"
                        : tpl.status === "draft"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {tpl.status}
                  </Badge>
                  {tpl.isPremium && <Badge tone="info">Premium</Badge>}
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="font-bold text-body-lg text-text">
                    {tpl.name}
                  </h3>
                  <p className="text-body-xs font-mono text-text-muted mt-0.5">
                    slug: {tpl.slug}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {tpl.category.map((cat) => (
                      <span
                        key={cat}
                        className="text-xs bg-surface-subtle border border-border px-2 py-0.5 rounded text-text-muted"
                      >
                        #{cat}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-body-xs text-text-muted">
                    {tpl.versions.length} Versi Terdaftar
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setSelectedTemplateId(tpl.id);
                      if (tpl.versions[0]) {
                        setSelectedVersionId(tpl.versions[0].id);
                      }
                    }}
                  >
                    Kelola Templat &rarr;
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Modal New Template */}
        {isNewTemplateModalOpen && (
          <Modal
            open={isNewTemplateModalOpen}
            onClose={() => setIsNewTemplateModalOpen(false)}
            title="Tambah Templat Baru"
            size="form"
          >
            <div className="space-y-4">
              {actionError && (
                <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                  {actionError}
                </div>
              )}

              <div>
                <Input
                  label="Nama Templat *"
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  placeholder="misal: Javanese Classic Elegance"
                />
              </div>

              <div>
                <Input
                  label="Slug *"
                  value={newTplSlug}
                  onChange={(e) => setNewTplSlug(e.target.value)}
                  placeholder="misal: javanese-classic"
                />
              </div>

              <div>
                <Input
                  label="Kategori (pisahkan dengan koma)"
                  value={newTplCategories}
                  onChange={(e) => setNewTplCategories(e.target.value)}
                  placeholder="traditional, floral, modern"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="newTplIsPremium"
                  checked={newTplIsPremium}
                  onChange={(e) => setNewTplIsPremium(e.target.checked)}
                  className="rounded border-border"
                />
                <label
                  htmlFor="newTplIsPremium"
                  className="text-sm font-medium"
                >
                  Templat Berbayar / Premium
                </label>
              </div>

              <div>
                <Input
                  label="URL Thumbnail Sampul"
                  value={newTplThumbnail}
                  onChange={(e) => setNewTplThumbnail(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div>
                <Input
                  label="Alasan Pembuatan (Audit Log) *"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Alasan wajib minimal 5 karakter..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border">
                <Button
                  variant="ghost"
                  onClick={() => setIsNewTemplateModalOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateTemplate}
                  disabled={saving}
                >
                  Buat Templat
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // Template Detail & Editor View
  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedTemplateId(null)}
          >
            &larr; Kembali ke Katalog
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-h2 font-bold">{selectedTemplate.name}</h1>
              <Badge
                tone={
                  selectedTemplate.status === "published"
                    ? "success"
                    : "warning"
                }
              >
                {selectedTemplate.status}
              </Badge>
              {selectedTemplate.isPremium && <Badge tone="info">Premium</Badge>}
            </div>
            <p className="text-body-xs font-mono text-text-muted mt-0.5">
              slug: {selectedTemplate.slug} | ID: {selectedTemplate.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIsNewVersionModalOpen(true);
              setActionError(null);
            }}
          >
            + Rilis Versi Baru
          </Button>
        </div>
      </div>

      {/* Version Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface border border-border p-4">
        <div className="flex items-center gap-3">
          <span className="text-body-sm font-semibold">Pilih Versi:</span>
          <div className="flex flex-wrap gap-2">
            {selectedTemplate.versions.map((ver) => (
              <button
                key={ver.id}
                onClick={() => setSelectedVersionId(ver.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedVersion?.id === ver.id
                    ? "border-primary bg-primary/10 text-primary font-bold"
                    : "border-border bg-surface-subtle hover:bg-surface text-text-muted"
                }`}
              >
                <span>v{ver.version}</span>
                <Badge
                  tone={
                    ver.status === "published"
                      ? "success"
                      : ver.status === "draft"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {ver.status}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Version Operational State & Action Buttons */}
        {selectedVersion && (
          <div className="flex items-center gap-3">
            {/* Affected Invitations Count (DoD: Deprecation shows affected count first) */}
            <div
              data-testid="version-affected-count"
              className="text-xs bg-surface-subtle px-3 py-1.5 rounded border border-border flex items-center gap-1.5"
            >
              <span>📊 Digunakan oleh:</span>
              <span className="font-bold text-text">
                {selectedVersion.invitation_count} Undangan
              </span>
            </div>

            {selectedVersion.status === "draft" && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setIsPublishModalOpen(true);
                  setActionError(null);
                }}
              >
                🚀 Publikasikan Versi Ini
              </Button>
            )}

            {selectedVersion.status === "published" && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setIsDeprecateModalOpen(true);
                  setActionError(null);
                }}
              >
                ⚠️ Depresiasi Versi
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Immutability Alert Banner */}
      {isSelectedVersionImmutable && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-900 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <span>
              Versi ini berstatus <strong>{selectedVersion?.status}</strong> dan
              bersifat <strong>immutable (permanen)</strong> per aturan BR-3.1.
              Perubahan hanya dapat dilakukan dengan membuat versi rilis baru.
            </span>
          </div>
          <Badge tone="info">Read Only</Badge>
        </div>
      )}

      {selectedVersion?.status === "draft" && (
        <Card>
          <Input
            label="Alasan penyimpanan draf"
            value={saveReason}
            onChange={(event) => setSaveReason(event.target.value)}
            maxLength={500}
          />
          <Button
            onClick={handleSaveVersion}
            disabled={saving || saveReason.trim().length < 5}
          >
            Simpan Draf Versi
          </Button>
          {saveMessage && <p role="status">{saveMessage}</p>}
        </Card>
      )}
      {/* Editor Tabs */}
      <div className="border-b border-border flex gap-4">
        <button
          onClick={() => setActiveTab("sections")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "sections"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          🧩 Bagian Undangan (Sections)
        </button>
        <button
          onClick={() => setActiveTab("theme")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "theme"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          🎨 Tema & Kontras (Theme)
        </button>
        <button
          onClick={() => setActiveTab("assets")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "assets"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          📁 Aset Media (Assets)
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "preview"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          📱 Pratinjau Nyata (Live Demo)
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === "sections" && (
        <SectionEditor
          sections={workingSections}
          onChange={setWorkingSections}
          disabled={isSelectedVersionImmutable}
        />
      )}

      {activeTab === "theme" && (
        <ThemeEditor
          theme={workingTheme}
          customizableThemeKeys={workingCustomizableKeys}
          onChangeTheme={setWorkingTheme}
          onChangeCustomizableKeys={setWorkingCustomizableKeys}
          disabled={isSelectedVersionImmutable}
        />
      )}

      {activeTab === "assets" && (
        <AssetUploader
          assets={workingAssets}
          onChange={setWorkingAssets}
          disabled={isSelectedVersionImmutable}
        />
      )}

      {activeTab === "preview" && (
        <TemplatePreview
          sections={workingSections}
          theme={workingTheme}
          customizableThemeKeys={workingCustomizableKeys}
        />
      )}

      {/* Modal Publish Confirmation (Immutable warning per BR-3.1) */}
      {isPublishModalOpen && (
        <Modal
          open={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          title="Konfirmasi Publikasi Versi Templat"
          size="confirmation"
        >
          <div className="space-y-4">
            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                {actionError}
              </div>
            )}

            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-sm space-y-2">
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠️ Peringatan Ketetapan Versi (BR-3.1):</span>
              </div>
              <p>
                Setelah versi ini dipublikasikan, statusnya akan terkunci secara
                permanen (<strong>immutable</strong>) dan tidak dapat diedit
                kembali untuk menjamin konsistensi render undangan pengguna.
              </p>
            </div>

            <div>
              <Input
                label="Alasan Publikasi (Audit Log) *"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="misal: Rilis versi 1.0.0 siap pakai untuk publik"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => setIsPublishModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                disabled={saving}
                onClick={handlePublishVersion}
              >
                Ya, Publikasikan Sekarang
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Deprecate Confirmation (Shows affected invitation count first) */}
      {isDeprecateModalOpen && (
        <Modal
          open={isDeprecateModalOpen}
          onClose={() => setIsDeprecateModalOpen(false)}
          title="Konfirmasi Depresiasi Versi Templat"
          size="confirmation"
        >
          <div className="space-y-4">
            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                {actionError}
              </div>
            )}

            <div className="p-4 bg-red-50 rounded-lg border border-red-200 text-red-900 text-sm space-y-2">
              <div className="font-bold">
                Dampak terhadap Undangan yang Ada:
              </div>
              <p data-testid="deprecate-affected-notice">
                Terdapat{" "}
                <strong className="text-red-950 font-bold underline">
                  {selectedVersion?.invitation_count || 0} undangan aktif
                </strong>{" "}
                yang saat ini mengunci ke versi ini.
              </p>
              <p className="text-xs text-red-800">
                Sesuai aturan BR-3.3, undangan yang sudah ada akan tetap dapat
                dirender dengan baik, namun versi ini akan dihapus dari katalog
                publik dan tidak dapat dipilih lagi untuk pembuatan undangan
                baru.
              </p>
            </div>

            <div>
              <Input
                label="Alasan Depresiasi (Audit Log) *"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="misal: Desain kuno, digantikan oleh v2.0"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => setIsDeprecateModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                disabled={saving}
                onClick={handleDeprecateVersion}
              >
                Konfirmasi Depresiasi
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal New Version */}
      {isNewVersionModalOpen && (
        <Modal
          open={isNewVersionModalOpen}
          onClose={() => setIsNewVersionModalOpen(false)}
          title="Rilis Versi Baru Templat"
          size="form"
        >
          <div className="space-y-4">
            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                {actionError}
              </div>
            )}

            <div>
              <Input
                label="Nomor Versi Semver *"
                value={newVersionNumber}
                onChange={(e) => setNewVersionNumber(e.target.value)}
                placeholder="misal: 1.1.0 atau 2.0.0"
              />
            </div>

            <div>
              <Input
                label="Catatan Perubahan (Changelog)"
                value={newVersionChangelog}
                onChange={(e) => setNewVersionChangelog(e.target.value)}
                placeholder="misal: Menambahkan varian layout baru pada bagian acara"
              />
            </div>

            <div>
              <Input
                label="Alasan Pembuatan Versi (Audit Log) *"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Alasan wajib minimal 5 karakter..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => setIsNewVersionModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateVersion}
                disabled={saving}
              >
                Buat Versi Draf
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
