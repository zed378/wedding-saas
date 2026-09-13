import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, buttonClassName } from "@wi/ui";
import { sectionLabel } from "@wi/schema";

import { SectionPreviews } from "../../../components/catalog/SectionPreviews";
import {
  fetchDemoInvitation,
  fetchTemplate,
  readCatalogConfig,
} from "../../../lib/catalog-api";
import { chooseTemplateHref } from "../../../lib/catalog-query";

/**
 * `P2-11` steps 2 to 4 — `/templates/:slug`. `docs/UI-UX/11` § Template Detail Page.
 *
 * ## "Use This Template" is a link to a protected route, and that is the whole login flow
 *
 * The button goes to `/dashboard/new?template={id}`. For a visitor who is signed in that
 * is the create wizard with the template preselected. For one who is not, `RequireAuth`
 * sends them to `/login` carrying the whole intended URL — query string included (`P1-20`)
 * — and they come back to the same wizard with the same template after authenticating.
 *
 * `docs/UI-UX/11`: *"save the template choice in temporary state (query param/local state),
 * redirect to login/register, and automatically continue the flow after successful auth"*.
 * The query parameter is the state. Nothing is written to storage, so there is nothing to
 * clear and nothing a shared computer remembers.
 *
 * ## "View Live Demo" is a real invitation
 *
 * It opens the seeded demo on the public invitation host — the production renderer reading
 * the production payload (`docs/PLAN/07` § Demo Data). The card's DoD: *"the demo renders
 * through the shared renderer with no separate mock page"*. There is no demo route in this
 * application to be a mock. When no demo is seeded the button is absent rather than linking
 * to a not-found page.
 */

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const template = await fetchTemplate(slug);

  if (template === null) {
    return { title: "Template tidak ditemukan", robots: { index: false } };
  }

  const description = `Template undangan pernikahan ${template.name}${
    template.category.length > 0 ? ` — ${template.category.join(", ")}` : ""
  }. Lihat demo langsung dan gunakan untuk undangan Anda.`;

  return {
    title: template.name,
    description,
    alternates: { canonical: `/templates/${template.slug}` },
    // `docs/PLAN/15` § Marketing Pages: "template detail pages as a target for long-tail
    // keywords". The deliberate exception to the application's `noindex`.
    robots: { index: true, follow: true },
    openGraph: {
      title: template.name,
      description,
      type: "website",
      ...(template.thumbnail_url === null
        ? {}
        : { images: [{ url: template.thumbnail_url }] }),
    },
  };
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const template = await fetchTemplate(slug);
  if (template === null) notFound();

  const config = readCatalogConfig();
  const demo =
    template.demo_slug === null
      ? null
      : await fetchDemoInvitation(template.demo_slug, config);

  const useHref = chooseTemplateHref(template.id);
  const demoHref =
    template.demo_slug === null
      ? undefined
      : `${config.publicInviteOrigin}/${encodeURIComponent(template.demo_slug)}`;

  return (
    <main
      id="main"
      // Bottom padding on small screens so the sticky action bar never covers the last
      // line of content.
      className="mx-auto flex max-w-page flex-col gap-8 p-4 pb-28 md:p-6 md:pb-6"
    >
      <nav aria-label="Remah roti">
        <Link
          href="/templates"
          className="focus-ring rounded-md px-1 text-sm text-text-muted underline"
        >
          Semua template
        </Link>
      </nav>

      <header className="flex flex-col gap-6 md:flex-row">
        {template.thumbnail_url !== null && (
          <img
            src={template.thumbnail_url}
            alt={`Tampilan template ${template.name}`}
            className="w-full rounded-lg border border-border object-cover md:w-72"
          />
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-text">
              {template.name}
            </h1>
            {template.is_premium && <Badge tone="premium">Premium</Badge>}
          </div>

          {template.category.length > 0 && (
            <ul aria-label="Kategori" className="flex flex-wrap gap-2">
              {template.category.map((category) => (
                <li key={category}>
                  <Link
                    href={`/templates?category=${encodeURIComponent(category)}`}
                    className="focus-ring rounded-md"
                  >
                    <Badge tone="neutral">{category}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-text-muted">
            Versi {template.current_version.version}
          </p>

          {/*
           * The primary action. Inline on a wide screen; on a phone the same action is
           * repeated in a sticky bar below, because `docs/UI-UX/11` wants it "always
           * visible while scrolling" and a long carousel pushes this one off the screen.
           */}
          <div className="hidden flex-wrap gap-3 md:flex">
            <Link
              href={useHref}
              className={buttonClassName({ variant: "primary" })}
            >
              Gunakan template ini
            </Link>
            {demoHref !== undefined && (
              <a
                href={demoHref}
                target="_blank"
                rel="noopener"
                className={buttonClassName({ variant: "secondary" })}
              >
                Lihat demo langsung
                <span className="sr-only"> (membuka tab baru)</span>
              </a>
            )}
          </div>

          <section aria-labelledby="supported-sections">
            <h2
              id="supported-sections"
              className="mb-2 text-sm font-medium text-text"
            >
              Bagian yang tersedia
            </h2>
            <ul className="flex flex-wrap gap-2">
              {template.supported_sections.map((key) => (
                <li key={key}>
                  <Badge tone="info">{sectionLabel(key)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </header>

      {demo !== null && (
        <SectionPreviews
          sections={demo.template.sections}
          theme={demo.template.theme}
          customizableThemeKeys={demo.template.customizable_theme_keys ?? []}
          data={demo.invitation}
          enabledSections={demo.invitation.settings.enabled_sections}
        />
      )}

      <div
        data-sticky-actions="true"
        className="fixed inset-x-0 bottom-0 z-10 flex gap-3 border-t border-border bg-surface p-4 md:hidden"
      >
        <Link
          href={useHref}
          className={`${buttonClassName({ variant: "primary" })} flex-1 justify-center`}
        >
          Gunakan template ini
        </Link>
        {demoHref !== undefined && (
          <a
            href={demoHref}
            target="_blank"
            rel="noopener"
            className={buttonClassName({ variant: "secondary" })}
          >
            Demo
            <span className="sr-only"> langsung (membuka tab baru)</span>
          </a>
        )}
      </div>
    </main>
  );
}
