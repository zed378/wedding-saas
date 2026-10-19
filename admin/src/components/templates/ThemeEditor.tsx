import { evaluateWcagContrast } from "./contrast.js";
import type { Theme } from "@wi/schema";
import { Badge } from "@wi/ui";

interface ThemeEditorProps {
  theme: Theme;
  customizableThemeKeys: string[];
  onChangeTheme: (theme: Theme) => void;
  onChangeCustomizableKeys: (keys: string[]) => void;
  disabled?: boolean;
}

const HEADING_FONT_OPTIONS = [
  "Playfair Display",
  "Cinzel",
  "Cormorant Garamond",
  "Great Vibes",
  "Alex Brush",
  "Montserrat",
  "Merriweather",
  "Lora",
  "Prata",
  "Bodoni Moda",
];

const BODY_FONT_OPTIONS = [
  "Inter",
  "Plus Jakarta Sans",
  "Open Sans",
  "Lato",
  "Roboto",
  "Lora",
  "Merriweather",
  "Nunito Sans",
  "Work Sans",
];

const ALL_CUSTOMIZABLE_KEYS = [
  { key: "colors.primary", label: "Warna Utama (Primary)" },
  { key: "colors.secondary", label: "Warna Latar / Sekunder (Secondary)" },
  { key: "colors.accent", label: "Warna Aksen (Accent)" },
  { key: "colors.text", label: "Warna Teks (Text)" },
  { key: "typography.heading_font", label: "Font Judul (Heading Font)" },
  { key: "typography.body_font", label: "Font Isi (Body Font)" },
  { key: "typography.scale", label: "Skala Tipografi" },
  { key: "spacing", label: "Spasi Layout (Spacing)" },
  { key: "border_radius", label: "Sudut Lengkung (Border Radius)" },
];

export function ThemeEditor({
  theme,
  customizableThemeKeys,
  onChangeTheme,
  onChangeCustomizableKeys,
  disabled = false,
}: ThemeEditorProps) {
  // Check contrast between text and background (secondary)
  const contrastResult = evaluateWcagContrast(
    theme.colors.text,
    theme.colors.secondary,
  );

  const handleColorChange = (
    key: keyof Theme["colors"],
    value: string,
  ) => {
    onChangeTheme({
      ...theme,
      colors: {
        ...theme.colors,
        [key]: value,
      },
    });
  };

  const handleTypographyChange = <K extends keyof Theme["typography"]>(
    key: K,
    value: Theme["typography"][K],
  ) => {
    onChangeTheme({
      ...theme,
      typography: {
        ...theme.typography,
        [key]: value,
      },
    });
  };

  const toggleCustomizableKey = (key: string) => {
    if (customizableThemeKeys.includes(key)) {
      onChangeCustomizableKeys(customizableThemeKeys.filter((k) => k !== key));
    } else {
      onChangeCustomizableKeys([...customizableThemeKeys, key]);
    }
  };

  return (
    <div className="space-y-8">
      {/* WCAG Contrast Alert */}
      {!contrastResult.passesNormalText && (
        <div
          data-testid="contrast-warning"
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h4 className="font-semibold text-amber-900">
                Peringatan Aksesibilitas WCAG AA
              </h4>
              <p className="mt-1 text-sm text-amber-800">
                {contrastResult.warningMessage}
              </p>
              <div className="mt-2 text-xs font-mono text-amber-700">
                Teks: {theme.colors.text} | Latar: {theme.colors.secondary} (Rasio: {contrastResult.ratio}:1, Butuh &gt;= 4.5:1)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Colors Section */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <div>
          <h3 className="text-body-lg font-semibold">Palet Warna Tema</h3>
          <p className="text-body-sm text-text-muted">
            Warna dasar yang akan diinterpolasi menjadi CSS tokens pada renderer undangan
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Primary */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="text-body-sm font-medium block">
              Primary (Warna Utama)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.colors.primary}
                disabled={disabled}
                onChange={(e) => handleColorChange("primary", e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-border p-1 bg-surface"
                aria-label="Warna Primary"
              />
              <input
                type="text"
                value={theme.colors.primary}
                disabled={disabled}
                onChange={(e) => handleColorChange("primary", e.target.value)}
                className="flex-1 rounded border border-border px-2 py-1.5 font-mono text-sm"
              />
            </div>
            <div
              className="h-6 rounded text-xs flex items-center justify-center font-medium"
              style={{
                backgroundColor: theme.colors.primary,
                color: "#ffffff",
              }}
            >
              Pratinjau
            </div>
          </div>

          {/* Secondary (Background) */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="text-body-sm font-medium block">
              Secondary (Latar Belakang)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.colors.secondary}
                disabled={disabled}
                onChange={(e) => handleColorChange("secondary", e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-border p-1 bg-surface"
                aria-label="Warna Secondary"
              />
              <input
                type="text"
                value={theme.colors.secondary}
                disabled={disabled}
                onChange={(e) => handleColorChange("secondary", e.target.value)}
                className="flex-1 rounded border border-border px-2 py-1.5 font-mono text-sm"
              />
            </div>
            <div
              className="h-6 rounded text-xs flex items-center justify-center font-medium border border-border"
              style={{
                backgroundColor: theme.colors.secondary,
                color: theme.colors.text,
              }}
            >
              Latar & Teks
            </div>
          </div>

          {/* Accent */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="text-body-sm font-medium block">
              Accent (Aksen / Ornamen)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.colors.accent}
                disabled={disabled}
                onChange={(e) => handleColorChange("accent", e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-border p-1 bg-surface"
                aria-label="Warna Accent"
              />
              <input
                type="text"
                value={theme.colors.accent}
                disabled={disabled}
                onChange={(e) => handleColorChange("accent", e.target.value)}
                className="flex-1 rounded border border-border px-2 py-1.5 font-mono text-sm"
              />
            </div>
            <div
              className="h-6 rounded text-xs flex items-center justify-center font-medium"
              style={{
                backgroundColor: theme.colors.accent,
                color: "#ffffff",
              }}
            >
              Pratinjau
            </div>
          </div>

          {/* Text */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="text-body-sm font-medium block">
              Text (Warna Huruf)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.colors.text}
                disabled={disabled}
                onChange={(e) => handleColorChange("text", e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-border p-1 bg-surface"
                aria-label="Warna Text"
              />
              <input
                type="text"
                value={theme.colors.text}
                disabled={disabled}
                onChange={(e) => handleColorChange("text", e.target.value)}
                className="flex-1 rounded border border-border px-2 py-1.5 font-mono text-sm"
              />
            </div>
            <div
              className="h-6 rounded text-xs flex items-center justify-center font-medium"
              style={{
                backgroundColor: theme.colors.secondary,
                color: theme.colors.text,
              }}
            >
              Rasio {contrastResult.ratio}:1
            </div>
          </div>
        </div>
      </div>

      {/* Typography Section */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <div>
          <h3 className="text-body-lg font-semibold">Tipografi & Skala</h3>
          <p className="text-body-sm text-text-muted">
            Keluarga font untuk judul dan isi teks, beserta skala proporsi ukuran teks
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-body-sm font-medium block mb-1">
              Heading Font (Font Judul)
            </label>
            <select
              value={theme.typography.heading_font}
              disabled={disabled}
              onChange={(e) =>
                handleTypographyChange("heading_font", e.target.value)
              }
              className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
              aria-label="Heading Font"
            >
              {HEADING_FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-body-sm font-medium block mb-1">
              Body Font (Font Isi Teks)
            </label>
            <select
              value={theme.typography.body_font}
              disabled={disabled}
              onChange={(e) =>
                handleTypographyChange("body_font", e.target.value)
              }
              className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
              aria-label="Body Font"
            >
              {BODY_FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-body-sm font-medium block mb-1">
              Skala Tipografi
            </label>
            <select
              value={theme.typography.scale}
              disabled={disabled}
              onChange={(e) =>
                handleTypographyChange(
                  "scale",
                  e.target.value as Theme["typography"]["scale"],
                )
              }
              className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
              aria-label="Skala Tipografi"
            >
              <option value="compact">Compact (Padat)</option>
              <option value="default">Default (Standar)</option>
              <option value="large">Large (Besar & Elegan)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Layout & Shape Tokens */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <div>
          <h3 className="text-body-lg font-semibold">Spasi & Sudut Lengkung</h3>
          <p className="text-body-sm text-text-muted">
            Token layout global untuk jarak antarelemen dan radius sudut elemen UI
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-body-sm font-medium block mb-1">
              Spasi Antar Bagian (Spacing)
            </label>
            <select
              value={theme.spacing}
              disabled={disabled}
              onChange={(e) =>
                onChangeTheme({
                  ...theme,
                  spacing: e.target.value as Theme["spacing"],
                })
              }
              className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
              aria-label="Spacing"
            >
              <option value="compact">Compact (Ketat / Minimalis)</option>
              <option value="comfortable">Comfortable (Nyaman / Seimbang)</option>
              <option value="spacious">Spacious (Luas / Mewah)</option>
            </select>
          </div>

          <div>
            <label className="text-body-sm font-medium block mb-1">
              Radius Sudut (Border Radius)
            </label>
            <select
              value={theme.border_radius}
              disabled={disabled}
              onChange={(e) =>
                onChangeTheme({
                  ...theme,
                  border_radius: e.target.value as Theme["border_radius"],
                })
              }
              className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
              aria-label="Border Radius"
            >
              <option value="none">None (Siku Tajam 0px)</option>
              <option value="subtle">Subtle (Lengkung Halus 4px)</option>
              <option value="rounded">Rounded (Lengkung Standar 8px)</option>
              <option value="full">Full / Pill (Lengkung Penuh)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customizable Theme Keys for End-User */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-body-lg font-semibold">
              Kustomisasi yang Diizinkan untuk Pengguna
            </h3>
            <p className="text-body-sm text-text-muted">
              Pilih properti tema yang dapat diubah oleh calon pengantin saat mengedit undangan
            </p>
          </div>
          <Badge tone="info">{customizableThemeKeys.length} diizinkan</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {ALL_CUSTOMIZABLE_KEYS.map(({ key, label }) => {
            const isChecked = customizableThemeKeys.includes(key);
            return (
              <label
                key={key}
                className={`flex items-start gap-2.5 p-3 rounded-md border cursor-pointer transition-colors ${
                  isChecked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-surface-subtle"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={disabled}
                  onChange={() => toggleCustomizableKey(key)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-primary"
                />
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs font-mono text-text-muted">{key}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
