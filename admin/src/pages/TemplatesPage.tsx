import { useState, useEffect } from "react";
import {
  Button,
  Card,
  CardHeader,
  Badge,
  Input,
  Modal,
  Tabs,
} from "@wi/ui";
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
    component: "CoupleClassic",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["couple.groom.name", "couple.bride.name"],
    optional_fields: [],
  },
  {
    section_key: "event",
    component: "EventCards",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["events.akad.date", "events.resepsi.date"],
    optional_fields: [],
  },
  {
    section_key: "rsvp",
    component: "RsvpStandard",
    enabled_by_default: true,
    configurable: false,
    required_fields: [],
    optional_fields: [],
  },
];

const INITIAL_MOCK_TEMPLATES: TemplateRecord[] = [
  {
    id: "tpl-javanese-classic",
    slug: "javanese-classic",
    name: "Javanese Classic Elegance",
    category: ["traditional", "javanese", "floral"],
    isPremium: true,
    thumbnailUrl: "https://images.unsplash.com/photo-1519741497674-611481863552?w=400",
    status: "published",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    versions: [
      {
        id: "ver-100",
        templateId: "tpl-javanese-classic",
        version: "1.0.0",
        sections: DEFAULT_SECTIONS,
        theme: DEFAULT_THEME,
        customizableThemeKeys: ["colors.primary", "colors.secondary", "spacing"],
        changelog: "Rilis publik pertama templat Jawa Klasik",
        status: "published",
        releasedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        invitation_count: 12,
      },
      {
        id: "ver-110",
        templateId: "tpl-javanese-classic",
        version: "1.1.0-draft",
        sections: DEFAULT_SECTIONS,
        theme: {
          ...DEFAULT_THEME,
          colors: { ...DEFAULT_THEME.colors, accent: "#D4AF37" },
        },
        customizableThemeKeys: ["colors.primary", "colors.secondary"],
        changelog: "Penambahan ornamen emas dan optimasi tipografi",
        status: "draft",
        createdAt: new Date().toISOString(),
        invitation_count: 0,
      },
    ],
  },
  {
    id: "tpl-sundanese-romantic",
    slug: "sundanese-romantic",
    name: "Sundanese Romantic Garden",
    category: ["traditional", "sundanese", "botanical"],
    isPremium: false,
    thumbnailUrl: "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=400",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    versions: [
      {
        id: "ver-090",
        templateId: "tpl-sundanese-romantic",
        version: "0.9.0",
        sections: DEFAULT_SECTIONS,
        theme: {
          ...DEFAULT_THEME,
          colors: {
            primary: "#2E5A44",
            secondary: "#F2F7F4",
            accent: "#8FAF9B",
            text: "#1C2E24",
          },
        },
        customizableThemeKeys: ["colors.primary", "colors.accent"],
        changelog: "Versi draf internal untuk pengujian",
        status: "draft",
        createdAt: new Date().toISOString(),
        invitation_count: 0,
      },
    ],
  },
];

export function TemplatesPage() {
  const [templatesList, setTemplatesList] = useState<TemplateRecord[]>(
    INITIAL_MOCK_TEMPLATES,
  );
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
  const [newTplCategories, setNewTplCategories] = useState("traditional, elegant");
  const [newTplIsPremium, setNewTplIsPremium] = useState(false);
  const [newTplThumbnail, setNewTplThumbnail] = useState("");

  // New Version form state
  const [newVersionNumber, setNewVersionNumber] = useState("1.0.0");
  const [newVersionChangelog, setNewVersionChangelog] = useState("");

  // Version edit working state
  const [workingSections, setWorkingSections] = useState<SectionDefinition[]>(
    DEFAULT_SECTIONS,
  );
  const [workingTheme, setWorkingTheme] = useState<Theme>(DEFAULT_THEME);
  const [workingCustomizableKeys, setWorkingCustomizableKeys] = useState<
    string[]
  >(["colors.primary", "colors.secondary"]);
  const [workingAssets, setWorkingAssets] = useState<TemplateAssetItem[]>([]);

  // Fetch real templates if API is active
  useEffect(() => {
    let isMounted = true;
    async function loadTemplates() {
      try {
        const res = await fetch("/api/v1/admin/templates");
        if (res.ok) {
          const json = await res.json();
          if (isMounted && Array.isArray(json?.data)) {
            setTemplatesList(json.data);
          }
        }
      } catch {
        // Keep initial mock templates for demo/standalone test environments
      }
    }
    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

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

    try {
      const res = await fetch("/api/v1/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: newTplSlug.trim(),
          name: newTplName.trim(),
          category: categoriesArray,
          is_premium: newTplIsPremium,
          thumbnail_url: newTplThumbnail.trim() || undefined,
          reason: actionReason.trim(),
        }),
      });

      if (res.ok) {
        const body = await res.json();
        const created: TemplateRecord = {
          ...body.data,
          versions: [],
        };
        setTemplatesList([created, ...templatesList]);
        setSelectedTemplateId(created.id);
        setIsNewTemplateModalOpen(false);
        setActionReason("");
        return;
      }
    } catch {
      // Local fallback
    }

    const localNewTpl: TemplateRecord = {
      id: `tpl-${Date.now()}`,
      slug: newTplSlug.trim(),
      name: newTplName.trim(),
      category: categoriesArray,
      isPremium: newTplIsPremium,
      thumbnailUrl: newTplThumbnail.trim() || undefined,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [
        {
          id: `ver-${Date.now()}`,
          templateId: `tpl-${Date.now()}`,
          version: "1.0.0-draft",
          sections: DEFAULT_SECTIONS,
          theme: DEFAULT_THEME,
          customizableThemeKeys: ["colors.primary", "colors.secondary"],
          status: "draft",
          createdAt: new Date().toISOString(),
          invitation_count: 0,
        },
      ],
    };

    setTemplatesList([localNewTpl, ...templatesList]);
    setSelectedTemplateId(localNewTpl.id);
    setSelectedVersionId(localNewTpl.versions[0]!.id);
    setIsNewTemplateModalOpen(false);
    setActionReason("");
  };

  const handleCreateVersion = async () => {
    setActionError(null);
    if (!newVersionNumber.trim()) {
      setActionError("Nomor versi semver wajib diisi (misal: 1.1.0).");
      return;
    }
    if (actionReason.trim().length < 5) {
      setActionError("Alasan audit wajib diisi minimal 5 karakter.");
      return;
    }

    const payload = {
      version: newVersionNumber.trim(),
      sections: workingSections,
      theme: workingTheme,
      customizable_theme_keys: workingCustomizableKeys,
      changelog: newVersionChangelog.trim() || undefined,
      reason: actionReason.trim(),
    };

    try {
      const res = await fetch(
        `/api/v1/admin/templates/${selectedTemplateId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (res.ok) {
        const body = await res.json();
        const newVer: TemplateVersionRecord = {
          ...body.data,
          invitation_count: 0,
        };
        const updatedList = templatesList.map((t) =>
          t.id === selectedTemplateId
            ? { ...t, versions: [newVer, ...t.versions] }
            : t,
        );
        setTemplatesList(updatedList);
        setSelectedVersionId(newVer.id);
        setIsNewVersionModalOpen(false);
        setActionReason("");
        return;
      }
    } catch {
      // Local fallback
    }

    const localVer: TemplateVersionRecord = {
      id: `ver-${Date.now()}`,
      templateId: selectedTemplateId!,
      version: newVersionNumber.trim(),
      sections: workingSections,
      theme: workingTheme,
      customizableThemeKeys: workingCustomizableKeys,
      changelog: newVersionChangelog.trim() || undefined,
      status: "draft",
      createdAt: new Date().toISOString(),
      invitation_count: 0,
    };

    const updated = templatesList.map((t) =>
      t.id === selectedTemplateId
        ? { ...t, versions: [localVer, ...t.versions] }
        : t,
    );
    setTemplatesList(updated);
    setSelectedVersionId(localVer.id);
    setIsNewVersionModalOpen(false);
    setActionReason("");
  };

  const handlePublishVersion = async () => {
    if (!selectedTemplate || !selectedVersion) return;
    if (actionReason.trim().length < 5) {
      setActionError("Alasan audit wajib diisi minimal 5 karakter.");
      return;
    }

    try {
      await fetch(
        `/api/v1/admin/templates/${selectedTemplate.id}/versions/${selectedVersion.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: actionReason.trim() }),
        },
      );
    } catch {
      // Local state fallback
    }

    const updated = templatesList.map((t) => {
      if (t.id !== selectedTemplate.id) return t;
      return {
        ...t,
        status: "published" as const,
        versions: t.versions.map((v) =>
          v.id === selectedVersion.id
            ? {
                ...v,
                status: "published" as const,
                releasedAt: new Date().toISOString(),
              }
            : v,
        ),
      };
    });
    setTemplatesList(updated);
    setIsPublishModalOpen(false);
    setActionReason("");
  };

  const handleDeprecateVersion = async () => {
    if (!selectedTemplate || !selectedVersion) return;
    if (actionReason.trim().length < 5) {
      setActionError("Alasan audit wajib diisi minimal 5 karakter.");
      return;
    }

    try {
      await fetch(
        `/api/v1/admin/templates/${selectedTemplate.id}/versions/${selectedVersion.id}/deprecate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: actionReason.trim() }),
        },
      );
    } catch {
      // Local state fallback
    }

    const updated = templatesList.map((t) => {
      if (t.id !== selectedTemplate.id) return t;
      return {
        ...t,
        versions: t.versions.map((v) =>
          v.id === selectedVersion.id
            ? { ...v, status: "deprecated" as const }
            : v,
        ),
      };
    });
    setTemplatesList(updated);
    setIsDeprecateModalOpen(false);
    setActionReason("");
  };

  const isSelectedVersionImmutable =
    selectedVersion?.status === "published" ||
    selectedVersion?.status === "deprecated";

  // Catalog View
  if (!selectedTemplate) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-display font-bold">Katalog Templat</h1>
            <p className="mt-1 text-body text-text-muted">
              Manajemen templat data-driven, skema versi JSONB, dan rilis tanpa deploy
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
                  <h3 className="font-bold text-body-lg text-text">{tpl.name}</h3>
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
                <label htmlFor="newTplIsPremium" className="text-sm font-medium">
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
                <Button variant="primary" onClick={handleCreateTemplate}>
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
              <Button variant="primary" onClick={handlePublishVersion}>
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
                publik dan tidak dapat dipilih lagi untuk pembuatan undangan baru.
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
              <Button variant="danger" onClick={handleDeprecateVersion}>
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
              <Button variant="primary" onClick={handleCreateVersion}>
                Buat Versi Draf
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
