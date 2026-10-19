import { useState } from "react";
import { Button, Dropzone, Badge } from "@wi/ui";

export interface TemplateAssetItem {
  id?: string;
  asset_name: string;
  purpose: "background" | "icon" | "demo-photo";
  file?: File;
  preview_url?: string;
}

interface AssetUploaderProps {
  assets: TemplateAssetItem[];
  onChange: (assets: TemplateAssetItem[]) => void;
  disabled?: boolean;
}

const PURPOSE_OPTIONS: { value: TemplateAssetItem["purpose"]; label: string }[] = [
  { value: "background", label: "Background (Latar Belakang)" },
  { value: "icon", label: "Icon / Ornamen Dekorasi" },
  { value: "demo-photo", label: "Demo Photo (Foto Contoh)" },
];

export function AssetUploader({
  assets,
  onChange,
  disabled = false,
}: AssetUploaderProps) {
  const [selectedPurpose, setSelectedPurpose] =
    useState<TemplateAssetItem["purpose"]>("background");
  const [customName, setCustomName] = useState("");

  const handleFilesDropped = (files: File[]) => {
    if (files.length === 0) return;
    const newAssets: TemplateAssetItem[] = files.map((file) => ({
      asset_name: customName.trim() || file.name,
      purpose: selectedPurpose,
      file,
      preview_url: URL.createObjectURL(file),
    }));

    onChange([...assets, ...newAssets]);
    setCustomName("");
  };

  const handleRemoveAsset = (index: number) => {
    const assetToRemove = assets[index];
    if (assetToRemove?.preview_url?.startsWith("blob:")) {
      URL.revokeObjectURL(assetToRemove.preview_url);
    }
    onChange(assets.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body-lg font-semibold">Aset Grafis & Media Templat</h3>
        <p className="text-body-sm text-text-muted">
          Unggah elemen dekoratif, tekstur latar, dan foto sampel melalui pipeline media tervalidasi
        </p>
      </div>

      {!disabled && (
        <div className="rounded-lg border border-border bg-surface-subtle p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-body-sm font-medium block mb-1">
                Kategori Aset (Purpose)
              </label>
              <select
                value={selectedPurpose}
                onChange={(e) =>
                  setSelectedPurpose(
                    e.target.value as TemplateAssetItem["purpose"],
                  )
                }
                className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
                aria-label="Kategori Aset"
              >
                {PURPOSE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-body-sm font-medium block mb-1">
                Nama Khusus Aset (Opsional)
              </label>
              <input
                type="text"
                value={customName}
                placeholder="misal: hero-ornament.png (kosongkan untuk nama asli)"
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full rounded border border-border px-3 py-2 text-sm bg-surface"
                aria-label="Nama Khusus Aset"
              />
            </div>
          </div>

          <Dropzone
            label="Tarik file gambar templat ke sini atau klik untuk memilih"
            helperText="PNG, JPEG, WebP, atau SVG hingga 5MB. EXIF dibersihkan dan malware dipindai secara otomatis."
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onFiles={(files) => handleFilesDropped([...files])}
            disabled={disabled}
          />
        </div>
      )}

      {/* Assets List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-body font-semibold">Daftar Aset Terlampir</h4>
          <Badge tone="neutral">{assets.length} aset</Badge>
        </div>

        {assets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-text-muted text-sm">
            Belum ada aset grafis yang diunggah untuk versi templat ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assets.map((asset, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {asset.preview_url ? (
                    <img
                      src={asset.preview_url}
                      alt={asset.asset_name}
                      className="w-12 h-12 object-cover rounded border border-border bg-surface-subtle"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded border border-border bg-surface-subtle flex items-center justify-center text-lg">
                      🖼️
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">
                      {asset.asset_name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge tone="info">
                        {asset.purpose}
                      </Badge>
                      {asset.file && (
                        <span className="text-xs text-text-muted font-mono">
                          {(asset.file.size / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {!disabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveAsset(idx)}
                    aria-label={`Hapus aset ${asset.asset_name}`}
                  >
                    🗑️
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
