import type {
  InvitationAggregate,
  InvitationRow,
} from "../../shared/tenancy/invitation-repository";

/**
 * `P3-09` — the invitation as the **canonical** document (`docs/PLAN/08`), for BR-4.2 completeness.
 *
 * A template's `required_fields` are canonical paths: `events.*.date`, `gift.accounts.*.account_number`,
 * `gallery.photos`, `couple.groom.photo`. Until `P3-09` the publish check and the change-template check
 * resolved those paths against the editor API's detail DTO, which names the same data `event_date`,
 * `bank_accounts` and a flat `gallery` list. So every one of those paths was **always missing**: no
 * invitation on the reference template could pass the publish check, whatever the couple entered. The
 * P2-06 suite did not notice because its only list-shaped requirement was tested while empty. The
 * publish E2E found it.
 *
 * This builds exactly the shape the public payload (`public-invitation.dto.ts`) serves and the editor's
 * `toEditorDocument` holds, without filtering by section — completeness asks "is it filled in", not
 * "is it shown". Only presence matters here, so a photo is its media id rather than a URL.
 */
export function toCompletenessDocument(
  row: InvitationRow,
  aggregate: InvitationAggregate,
): Record<string, unknown> {
  const person = (role: string) => {
    const found = aggregate.people.find((p) => p.role === role);
    if (found === undefined) return null;
    return {
      full_name: found.fullName,
      nickname: found.nickname,
      instagram: found.instagram,
      father_name: found.fatherName,
      mother_name: found.motherName,
      child_order: found.childOrder,
      photo: found.photoMediaId,
    };
  };

  const byOrder = <T extends { displayOrder: number }>(
    rows: readonly T[],
  ): T[] => [...rows].sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    slug: row.slug,
    couple: { groom: person("groom"), bride: person("bride") },
    events: byOrder(aggregate.events).map((e) => ({
      type: e.type,
      title: e.title,
      date: e.eventDate,
      start_time: e.startTime,
      end_time: e.endTime,
      timezone: e.timezone,
      venue_name: e.venueName,
      address: e.address,
      latitude: e.latitude,
      longitude: e.longitude,
      maps_url: e.mapsUrl,
      description: e.description,
    })),
    gallery: {
      photos: byOrder(aggregate.gallery).map((g) => ({
        media: g.mediaId,
        caption: g.caption,
        is_cover: g.isCover,
      })),
    },
    gift: {
      accounts: byOrder(aggregate.bankAccounts).map((b) => ({
        type: b.type,
        provider_name: b.providerName,
        account_number: b.accountNumber,
        account_holder: b.accountHolder,
      })),
    },
    quote: {
      text: aggregate.quote?.text ?? null,
      source: aggregate.quote?.source ?? null,
    },
    settings: {
      enabled_sections: [...(aggregate.settings?.enabledSections ?? [])],
      rsvp_enabled: aggregate.settings?.rsvpEnabled ?? true,
      guestbook_enabled: aggregate.settings?.guestbookEnabled ?? true,
    },
  };
}
