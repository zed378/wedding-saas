import { useState } from "react";
import { TemplateRenderer } from "@wi/template-renderer";
import { DUMMY_INVITATION_DATA } from "./dummy-data.js";
import type { SectionDefinition, Theme } from "@wi/schema";
import type { SectionDefinition as RendererSectionDefinition } from "@wi/template-renderer";
import { Button } from "@wi/ui";

interface TemplatePreviewProps {
  sections: SectionDefinition[];
  theme: Theme;
  customizableThemeKeys?: string[];
  data?: Record<string, unknown>;
}

export function TemplatePreview({
  sections,
  theme,
  customizableThemeKeys,
  data = DUMMY_INVITATION_DATA,
}: TemplatePreviewProps) {
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");

  const sanitizedSections: RendererSectionDefinition[] = sections.map((s) => {
    const item: Record<string, unknown> = {
      section_key: s.section_key,
      component: s.component,
      enabled_by_default: s.enabled_by_default,
      configurable: s.configurable,
    };
    if (s.max_items !== undefined) item.max_items = s.max_items;
    if (s.required_fields !== undefined) item.required_fields = s.required_fields;
    if (s.optional_fields !== undefined) item.optional_fields = s.optional_fields;
    if (s.layout_variant !== undefined) item.layout_variant = s.layout_variant;
    if (s.layout_options !== undefined) item.layout_options = s.layout_options;
    return item as unknown as RendererSectionDefinition;
  });

  const templateVersion = {
    sections: sanitizedSections,
    theme: theme as unknown as Record<string, unknown>,
    ...(customizableThemeKeys !== undefined
      ? { customizable_theme_keys: customizableThemeKeys }
      : {}),
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Viewport Toolbar */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-medium text-text-muted">
            Pratinjau Renderer Nyata (Mode Demo):
          </span>
          <span className="text-xs font-mono bg-surface-subtle px-2 py-0.5 rounded border border-border">
            {sections.length} Bagian Terdefinisi
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-surface-subtle p-1 rounded-lg border border-border">
          <Button
            size="sm"
            variant={viewport === "mobile" ? "primary" : "ghost"}
            onClick={() => setViewport("mobile")}
            aria-label="Tampilan Mobile"
          >
            📱 Mobile (375px)
          </Button>
          <Button
            size="sm"
            variant={viewport === "desktop" ? "primary" : "ghost"}
            onClick={() => setViewport("desktop")}
            aria-label="Tampilan Desktop"
          >
            💻 Desktop
          </Button>
        </div>
      </div>

      {/* Preview Canvas Container */}
      <div className="flex-1 overflow-auto bg-surface-subtle/50 p-4 rounded-xl border border-border flex justify-center items-start min-h-[600px]">
        {viewport === "mobile" ? (
          <div
            data-testid="preview-mobile-frame"
            className="w-[375px] min-h-[667px] bg-white rounded-[2.5rem] shadow-2xl border-[10px] border-neutral-800 overflow-hidden relative flex flex-col"
          >
            {/* Phone Notch/Island */}
            <div className="h-6 bg-neutral-800 w-full flex justify-center items-center">
              <div className="w-20 h-3.5 bg-black rounded-b-xl" />
            </div>

            {/* Inner Content */}
            <div className="flex-1 overflow-y-auto w-full">
              <TemplateRenderer
                templateVersion={templateVersion}
                invitationData={data}
                mode="demo"
              />
            </div>

            {/* Home Indicator */}
            <div className="h-4 bg-white w-full flex justify-center items-center">
              <div className="w-28 h-1 bg-neutral-300 rounded-full" />
            </div>
          </div>
        ) : (
          <div
            data-testid="preview-desktop-frame"
            className="w-full max-w-4xl min-h-[600px] bg-white rounded-lg shadow-lg border border-border overflow-hidden"
          >
            <TemplateRenderer
              templateVersion={templateVersion}
              invitationData={data}
              mode="demo"
            />
          </div>
        )}
      </div>
    </div>
  );
}
