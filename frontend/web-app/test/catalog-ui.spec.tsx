import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { TemplateCard } from "../src/components/catalog/TemplateCard";
import { CatalogFilters } from "../src/components/catalog/CatalogFilters";
import { SectionPreviews } from "../src/components/catalog/SectionPreviews";

/**
 * `P2-11` — the catalogue's components.
 */

const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
}));

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TEMPLATE = {
  id: "t1",
  slug: "elegant-rose",
  name: "Elegant Rose",
  category: ["modern", "floral"],
  is_premium: true,
  thumbnail_url: "https://cdn.test/thumb.webp",
  supported_sections: ["hero", "couple", "gift"],
};

describe("TemplateCard", () => {
  it("is one link, named by the template", () => {
    render(
      <ul>
        <TemplateCard template={TEMPLATE} />
      </ul>,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    // The accessible name is the template's name, not a run-on of everything in the card.
    expect(links[0]).toHaveAccessibleName("Elegant Rose");
    expect(links[0]).toHaveAttribute("href", "/templates/elegant-rose");
  });

  it("shows section LABELS, never section keys", () => {
    // `supported_sections` is `["hero", …]`. An English identifier on an Indonesian page is
    // the rendering bug this guards; `sectionLabel` is the same table the editor uses.
    const { container } = render(
      <ul>
        <TemplateCard template={TEMPLATE} />
      </ul>,
    );

    expect(container.textContent).toContain("Sampul");
    expect(container.textContent).toContain("Mempelai");
    expect(container.textContent).not.toMatch(/\bhero\b|\bgift\b/);
  });

  it("marks a premium template in words, not only colour", () => {
    render(
      <ul>
        <TemplateCard template={TEMPLATE} />
      </ul>,
    );

    expect(screen.getByText("Premium")).toBeInTheDocument();
  });

  it("renders a placeholder rather than a broken image with no thumbnail", () => {
    const { container } = render(
      <ul>
        <TemplateCard template={{ ...TEMPLATE, thumbnail_url: null }} />
      </ul>,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ul>
        <TemplateCard template={TEMPLATE} />
      </ul>,
    );

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("CatalogFilters", () => {
  it("is a real GET form, so it works with JavaScript off", () => {
    render(<CatalogFilters query={{ page: 1 }} categories={["floral"]} />);

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/templates");
    expect(within(form).getByRole("searchbox")).toHaveAttribute(
      "name",
      "search",
    );
  });

  it("debounces search into the URL with replace, not push", async () => {
    // Every keystroke as a history entry would make Back step through "E", "El", "Ele".
    // `fireEvent` rather than `userEvent.type`: user-event awaits its own timers between
    // keystrokes, which deadlocks against fake timers. The behaviour under test is the
    // debounce, not keystroke simulation.
    vi.useFakeTimers();

    render(<CatalogFilters query={{ page: 3 }} categories={[]} />);
    const box = screen.getByRole("searchbox");
    for (const value of ["r", "ro", "ros", "rose"]) {
      fireEvent.change(box, { target: { value } });
      vi.advanceTimersByTime(100);
    }

    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toBe("/templates?search=rose");
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes a category change and resets to page one", async () => {
    render(
      <CatalogFilters query={{ page: 4 }} categories={["floral", "modern"]} />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Kategori"), "modern");

    expect(push).toHaveBeenCalledWith("/templates?category=modern");
  });

  it("clears the category with the empty option", async () => {
    render(
      <CatalogFilters
        query={{ page: 1, category: "floral" }}
        categories={["floral"]}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Kategori"), "");

    expect(push).toHaveBeenCalledWith("/templates");
  });

  it("maps the price filter onto premium", async () => {
    render(<CatalogFilters query={{ page: 1 }} categories={[]} />);

    await userEvent.selectOptions(screen.getByLabelText("Harga"), "false");

    expect(push).toHaveBeenCalledWith("/templates?premium=false");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CatalogFilters query={{ page: 1 }} categories={["floral"]} />,
    );

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("SectionPreviews", () => {
  const sections = [
    {
      section_key: "quote",
      component: "QuoteBanner",
      enabled_by_default: true,
      configurable: true,
      required_fields: ["quote.text"],
      optional_fields: [],
    },
    {
      section_key: "gift",
      component: "GiftAccountList",
      enabled_by_default: true,
      configurable: true,
      required_fields: ["gift.accounts.*.account_number"],
      optional_fields: [],
    },
  ];

  const data = {
    quote: { text: "Dan di antara tanda-tanda kekuasaan-Nya", source: null },
    gift: {
      accounts: [{ provider_name: "BCA", account_number: "1234567890" }],
    },
  };

  it("renders each enabled section through the real renderer, one per slide", () => {
    const { container } = render(
      <SectionPreviews
        sections={sections}
        theme={{}}
        customizableThemeKeys={[]}
        data={data}
        enabledSections={["quote", "gift"]}
      />,
    );

    // The renderer's own markers, which a mock would not produce.
    expect(container.querySelectorAll("[data-template-renderer]")).toHaveLength(
      2,
    );
    expect(container.textContent).toContain("Dan di antara tanda-tanda");
    // Each slide is captioned by its section's label (the rendered section may carry the
    // same word as its own heading, so the caption is read from the slide itself).
    const captions = [...container.querySelectorAll("li > p")].map(
      (p) => p.textContent,
    );
    expect(captions).toEqual(["Kutipan", "Hadiah"]);
  });

  it("leaves out a section the demo has turned off", () => {
    const { container } = render(
      <SectionPreviews
        sections={sections}
        theme={{}}
        customizableThemeKeys={[]}
        data={data}
        enabledSections={["quote"]}
      />,
    );

    expect(container.querySelectorAll("[data-template-renderer]")).toHaveLength(
      1,
    );
    expect(
      [...container.querySelectorAll("li > p")].map((p) => p.textContent),
    ).toEqual(["Kutipan"]);
  });

  it("makes the previews inert, so a visitor cannot tab into a demo's controls", () => {
    // The gift preview has a copy button. From the catalogue it must not be reachable.
    const { container } = render(
      <SectionPreviews
        sections={sections}
        theme={{}}
        customizableThemeKeys={[]}
        data={data}
        enabledSections={["gift"]}
      />,
    );

    const frame = container.querySelector("[inert]");
    expect(frame).not.toBeNull();
    expect(frame?.querySelector("button")).not.toBeNull();
  });

  it("keeps the carousel reachable by keyboard", () => {
    render(
      <SectionPreviews
        sections={sections}
        theme={{}}
        customizableThemeKeys={[]}
        data={data}
        enabledSections={["quote"]}
      />,
    );

    expect(
      screen.getByRole("list", { name: /pratinjau bagian/i }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("renders nothing when no section is enabled", () => {
    const { container } = render(
      <SectionPreviews
        sections={sections}
        theme={{}}
        customizableThemeKeys={[]}
        data={data}
        enabledSections={[]}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});
