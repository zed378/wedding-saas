import { Injectable } from "@nestjs/common";

import { NotFoundError } from "../../http/errors";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { requireOwned, requireOwnership } from "../../shared/auth-middleware";
import type { EventDto } from "./invitation.dto";
import type { InvitationEventRow } from "../../shared/tenancy/invitation-repository";

/**
 * P1-12 — events. `docs/API/04` § Events, `docs/DATABASE/05`.
 *
 * ## `:event_id` is checked against `:id`, not on its own
 *
 * `docs/SECURITY/05` § 7's two-step rule. Owning the invitation in the path is necessary
 * and not sufficient: a caller who owns invitation A and passes the id of an event
 * belonging to invitation B must get a 404, and the only reliable way to guarantee that is
 * to make **both** conditions part of one query. `findOwnedChild` does that — the event's
 * `invitation_id` and the invitation's `owner_id` in a single statement, so there is no
 * moment at which one has been checked and the other has not.
 *
 * The table itself is never imported here. `findOwnedEvent` and `findOwnedEvents` are named
 * wrappers in the tenancy layer, because `scripts/check-tenant-scope.mjs` refuses a direct
 * import of a tenant-owned table anywhere else -- and a file with the table in scope is one
 * edit away from querying it without a predicate.
 *
 * Two separate reads would work and would be a trap: the second is the one somebody
 * deletes while "simplifying".
 */

/**
 * `undefined` is spelled out on every optional field, not implied.
 *
 * Under `exactOptionalPropertyTypes` a `?:` field and a field that may be `undefined` are
 * different types, and the controller builds its argument with conditional spreads that
 * can produce either. Writing both is what lets "absent" and "explicitly cleared" stay
 * distinguishable all the way down -- `undefined` means leave it alone, `null` means clear
 * it, and collapsing the two would make a PATCH that omits a field wipe it.
 */
export interface EventInput {
  readonly type: string;
  readonly title: string;
  readonly eventDate: string;
  readonly startTime: string;
  readonly endTime?: string | null | undefined;
  readonly venueName: string;
  readonly address: string;
  readonly latitude?: string | null | undefined;
  readonly longitude?: string | null | undefined;
  readonly mapsUrl?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly displayOrder?: number | undefined;
}

export type EventPatch = Partial<EventInput>;

/**
 * A Google Maps link from coordinates. `docs/DATABASE/05` § Notes asks for this at the
 * service layer when `maps_url` is left empty.
 *
 * `?q=lat,lng` rather than a `maps/place` path, because it is the form that works without
 * a place id and degrades to a pin at the coordinates. The public page uses a static image
 * plus this deep link and loads no map SDK (`docs/PLAN/00` § Maps), so this string is the
 * entire navigation feature — worth getting right and worth not inventing twice.
 */
export function buildMapsUrl(
  latitude: string | null | undefined,
  longitude: string | null | undefined,
): string | null {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined
  ) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function toDto(row: InvitationEventRow): EventDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    event_date: row.eventDate,
    start_time: row.startTime,
    end_time: row.endTime,
    venue_name: row.venueName,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description,
    display_order: row.displayOrder,
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly repository: InvitationRepository) {}

  async list(scope: TenantScope, invitationId: string): Promise<EventDto[]> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const rows = await this.repository.findOwnedEvents(invitationId, scope);

    return [...rows].sort((a, b) => a.displayOrder - b.displayOrder).map(toDto);
  }

  async create(
    scope: TenantScope,
    invitationId: string,
    input: EventInput,
  ): Promise<EventDto> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const row = await this.repository.createEvent(invitationId, scope, {
      ...input,
      // Step 4. Only when the caller left it empty: a user who supplied their own link --
      // a shared Google Maps short URL, say -- must keep it.
      mapsUrl:
        input.mapsUrl !== undefined && input.mapsUrl !== null
          ? input.mapsUrl
          : buildMapsUrl(input.latitude, input.longitude),
      // Step 5. Appended by default, so a new event does not silently jump to the front of
      // a deliberately ordered list.
      displayOrder:
        input.displayOrder ??
        (await this.repository.nextEventOrder(invitationId, scope)),
    });

    if (row === null) throw new NotFoundError();
    return toDto(row);
  }

  /**
   * Update one event of one invitation.
   *
   * The ownership check is `findOwnedChild`, which is the two-step rule in one query. The
   * `null` it returns for "not this invitation's event" is indistinguishable from "no such
   * event", which is what makes the 404 honest.
   */
  async update(
    scope: TenantScope,
    invitationId: string,
    eventId: string,
    changes: EventPatch,
  ): Promise<EventDto> {
    const existing = await requireOwnership(
      () => this.repository.findOwnedEvent(eventId, invitationId, scope),
      { scope, resourceType: "invitation_event", resourceId: eventId },
    );

    // Recomputed from whatever the coordinates will BE after this patch, not from what
    // they were. Moving a venue and leaving a link pointing at the old one is the failure
    // this avoids, and it is silent -- the guest is simply sent to the wrong place.
    const nextLatitude =
      changes.latitude !== undefined ? changes.latitude : existing.latitude;
    const nextLongitude =
      changes.longitude !== undefined ? changes.longitude : existing.longitude;

    const coordinatesChanged =
      changes.latitude !== undefined || changes.longitude !== undefined;

    const mapsUrl =
      changes.mapsUrl !== undefined
        ? // An explicit value wins, including `null` to clear it.
          changes.mapsUrl
        : coordinatesChanged
          ? buildMapsUrl(nextLatitude, nextLongitude)
          : undefined;

    const row = await this.repository.updateEvent(
      eventId,
      invitationId,
      scope,
      { ...changes, ...(mapsUrl !== undefined ? { mapsUrl } : {}) },
    );

    if (row === null) throw new NotFoundError();
    return toDto(row);
  }

  async remove(
    scope: TenantScope,
    invitationId: string,
    eventId: string,
  ): Promise<void> {
    await requireOwnership(
      () => this.repository.findOwnedEvent(eventId, invitationId, scope),
      { scope, resourceType: "invitation_event", resourceId: eventId },
    );

    // A hard delete. An event is not a published artefact in its own right and there is no
    // `deleted_at` on the table -- `docs/DATABASE/05` gives it none, so removing one is
    // removing it. The invitation's own soft delete is what preserves history.
    await this.repository.deleteEvent(eventId, invitationId, scope);
  }
}
