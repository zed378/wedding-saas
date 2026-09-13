import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TemplateRenderer } from "./TemplateRenderer.js";
import type { SectionProps, TemplateVersionDefinition } from "./types.js";

/**
 * `P2-08` — the `resolve` prop.
 *
 * `docs/FRONTEND/09` § Budget: "section components loaded only for the active template,
 * not bundling every possible template". The public page satisfies that by resolving each
 * name through `next/dynamic`, which only works if the renderer will take a resolver.
 */

const version: TemplateVersionDefinition = {
  sections: [
    {
      section_key: "hero",
      component: "HeroClassic",
      enabled_by_default: true,
      configurable: false,
      required_fields: [],
      optional_fields: [],
    },
  ],
  theme: {},
};

describe("a caller may supply its own component resolver", () => {
  it("renders what the resolver returns instead of the registry's component", () => {
    const Stub = ({ mode }: SectionProps) => <p>stub in {mode} mode</p>;

    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{}}
        resolve={() => Stub}
      />,
    );

    expect(screen.getByText("stub in public mode")).toBeInTheDocument();
  });

  it("is asked for the component NAME the definition holds", () => {
    const resolve = vi.fn(() => undefined);

    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{}}
        resolve={resolve}
      />,
    );

    expect(resolve).toHaveBeenCalledWith("HeroClassic");
  });

  it("treats a resolver that returns nothing exactly like an unregistered component", () => {
    // The failure mode a lazy resolver introduces: a chunk that will not load. It must
    // degrade the way `docs/PLAN/18` R5 already requires -- the section is skipped, the
    // caller is told, and the rest of the invitation renders.
    const onSectionIssue = vi.fn();

    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{}}
        resolve={() => undefined}
        onSectionIssue={onSectionIssue}
      />,
    );

    expect(onSectionIssue).toHaveBeenCalledWith({
      sectionKey: "hero",
      component: "HeroClassic",
      reason: "unregistered_component",
    });
  });

  it("falls back to the static registry when no resolver is given", () => {
    // The editor and the demo pass nothing, and must keep working unchanged.
    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{ couple: { groom: { nickname: "Budi" } } }}
      />,
    );

    expect(
      document.querySelector('[data-component="HeroClassic"]'),
    ).not.toBeNull();
  });
});
