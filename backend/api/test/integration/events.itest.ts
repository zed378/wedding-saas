import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  EventsService,
  buildMapsUrl,
} from "../../src/modules/invitation/events.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { invitationEvents } from "../../src/infra/db/schema/invitations";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { createTwoTenants, expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-12 — events.
 *
 * The test that matters most is the one the DoD names first: **an event id belonging to
 * another invitation returns 404 even when the path's invitation is owned by the caller.**
 * That is `docs/SECURITY/05` § 7, and it is the sub-resource hole — owning the parent is
 * necessary and not sufficient, and a naive implementation that checks only the parent
 * looks completely correct.
 */

const EVENT = {
  type: "akad",
  title: "Akad Nikah",
  eventDate: "2027-06-12",
  startTime: "08:00",
  venueName: "Masjid Agung",
  address: "Jl. Merdeka No. 1, Jakarta",
} as const;

describe("events sub-resource", () => {
  let harness: Harness;
  let service: EventsService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new EventsService(repository);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const withInvitation = async (): Promise<{
    user: TestUser;
    invitationId: string;
  }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    return { user, invitationId: invitation.id };
  };

  describe("the two-step rule (the DoD's first item, docs/SECURITY/05 § 7)", () => {
    it("an event id from another invitation is 404, even though the path invitation is mine", async () => {
      // THE sub-resource hole. Mallory owns the invitation in the path. The event id
      // belongs to Alice. An implementation that checks only the parent passes every
      // ownership test and still leaks.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      const alicesEvent = await service.create(
        alice.user.scope,
        alice.invitation.id,
        { ...EVENT, title: "Alice's akad" },
      );

      const error = await rejection(() =>
        service.update(
          mallory.user.scope,
          mallory.invitation.id,
          alicesEvent.id,
          { title: "Hijacked" },
        ),
      );

      expect(error.status).toBe(404);
      expect(JSON.stringify(error)).not.toContain("Alice");

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, alicesEvent.id));
      expect(row!.title).toBe("Alice's akad");
    });

    it("deleting another invitation's event is 404 and deletes nothing", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const alicesEvent = await service.create(
        alice.user.scope,
        alice.invitation.id,
        EVENT,
      );

      await expect(
        service.remove(
          mallory.user.scope,
          mallory.invitation.id,
          alicesEvent.id,
        ),
      ).rejects.toMatchObject({ status: 404 });

      const rows = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, alicesEvent.id));
      expect(rows).toHaveLength(1);
    });

    it("an event of MY other invitation is also 404 on the wrong parent", async () => {
      // Same owner, wrong parent. Narrower than a cross-tenant case and just as wrong:
      // the event does not belong to the invitation being addressed.
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });

      const event = await service.create(user.scope, a.id, EVENT);

      await expect(
        service.update(user.scope, b.id, event.id, { title: "Moved" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("another user cannot list or create", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        service.list(mallory.user.scope, alice.invitation.id),
      );
      await expectServiceIdorSafe(() =>
        service.create(mallory.user.scope, alice.invitation.id, EVENT),
      );

      expect(
        await harness.db
          .select()
          .from(invitationEvents)
          .where(eq(invitationEvents.invitationId, alice.invitation.id)),
      ).toHaveLength(0);
    });
  });

  /**
   * The service's two defences mask each other, so each is tested on its own here.
   *
   * Found by mutation, and it is worth spelling out because every sub-resource task after
   * this one has the same shape:
   *
   *   dropping `eq(table.invitationId, invitationId)` from `findOwnedChild` broke nothing,
   *   because the WRITE still refuses a wrong parent and the service 404s anyway;
   *
   *   dropping the owner `EXISTS` from `updateEvent` broke nothing, because the READ
   *   already 404d first.
   *
   * Both layers were therefore unverified while every service test passed. These call the
   * repository directly, where there is nothing else to catch the mistake.
   */
  describe("each layer's own predicate (found by mutation)", () => {
    it("findOwnedChild refuses a child of MY OTHER invitation", async () => {
      // Same owner, wrong parent. The service-level version of this test passes even with
      // the parent predicate deleted, because the write refuses it afterwards.
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });
      const event = await service.create(user.scope, a.id, EVENT);

      expect(
        await repository.findOwnedChild(
          invitationEvents,
          event.id,
          b.id,
          user.scope,
        ),
      ).toBeNull();

      // ...and finds it on the right parent, so this is not passing by refusing everything.
      expect(
        await repository.findOwnedChild(
          invitationEvents,
          event.id,
          a.id,
          user.scope,
        ),
      ).not.toBeNull();
    });

    it("findOwnedChild refuses another tenant's child", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const event = await service.create(
        alice.user.scope,
        alice.invitation.id,
        EVENT,
      );

      expect(
        await repository.findOwnedChild(
          invitationEvents,
          event.id,
          alice.invitation.id,
          mallory.user.scope,
        ),
      ).toBeNull();
    });

    it("updateEvent writes nothing for a scope that does not own the invitation", async () => {
      // The write's own predicate, isolated. Through the service this is unreachable
      // because the read 404s first -- which is exactly why deleting it broke no test.
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const event = await service.create(
        alice.user.scope,
        alice.invitation.id,
        { ...EVENT, title: "Alice's akad" },
      );

      expect(
        await repository.updateEvent(
          event.id,
          alice.invitation.id,
          mallory.user.scope,
          { title: "Hijacked" },
        ),
      ).toBeNull();

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, event.id));
      expect(row!.title).toBe("Alice's akad");
    });

    it("deleteEvent deletes nothing for a scope that does not own the invitation", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const event = await service.create(
        alice.user.scope,
        alice.invitation.id,
        EVENT,
      );

      await repository.deleteEvent(
        event.id,
        alice.invitation.id,
        mallory.user.scope,
      );

      expect(
        await harness.db
          .select()
          .from(invitationEvents)
          .where(eq(invitationEvents.id, event.id)),
      ).toHaveLength(1);
    });

    it("createEvent writes nothing for a scope that does not own the invitation", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      expect(
        await repository.createEvent(
          alice.invitation.id,
          mallory.user.scope,
          EVENT,
        ),
      ).toBeNull();

      expect(
        await harness.db
          .select()
          .from(invitationEvents)
          .where(eq(invitationEvents.invitationId, alice.invitation.id)),
      ).toHaveLength(0);
    });
  });

  describe("CRUD", () => {
    it("creates and lists", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      const list = await service.list(user.scope, invitationId);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(created.id);
      expect(list[0]!.title).toBe("Akad Nikah");
    });

    it("supports N events per invitation", async () => {
      // docs/DATABASE/05 § Notes: "invitation_events supports N events per invitation".
      const { user, invitationId } = await withInvitation();

      await service.create(user.scope, invitationId, EVENT);
      await service.create(user.scope, invitationId, {
        ...EVENT,
        type: "reception",
        title: "Resepsi",
      });
      await service.create(user.scope, invitationId, {
        ...EVENT,
        type: "custom",
        title: "Ngunduh Mantu",
      });

      expect(await service.list(user.scope, invitationId)).toHaveLength(3);
    });

    it("updates partially", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      const updated = await service.update(
        user.scope,
        invitationId,
        created.id,
        { title: "Akad Nikah (revisi)" },
      );

      expect(updated.title).toBe("Akad Nikah (revisi)");
      expect(updated.venue_name).toBe("Masjid Agung");
    });

    it("deletes", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      await service.remove(user.scope, invitationId, created.id);

      expect(await service.list(user.scope, invitationId)).toHaveLength(0);
    });

    it("a deleted event is 404 on a second delete", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);
      await service.remove(user.scope, invitationId, created.id);

      await expect(
        service.remove(user.scope, invitationId, created.id),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("an empty patch reads without writing", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      const result = await service.update(
        user.scope,
        invitationId,
        created.id,
        {},
      );
      expect(result.title).toBe("Akad Nikah");
    });
  });

  describe("maps_url generation (the DoD's second item)", () => {
    it("is generated when coordinates are present and it was left empty", async () => {
      // docs/DATABASE/05 § Notes, at the service layer.
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, {
        ...EVENT,
        latitude: "-6.175392",
        longitude: "106.827153",
      });

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));

      expect(row!.mapsUrl).toBe(
        "https://www.google.com/maps/search/?api=1&query=-6.175392,106.827153",
      );
    });

    it("is null when there are no coordinates", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));
      expect(row!.mapsUrl).toBeNull();
    });

    it("a caller's own link is NOT overwritten", async () => {
      // Somebody who pasted a Google Maps short link, or a link with a place id, must keep
      // it -- theirs is better than a generated pin.
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, {
        ...EVENT,
        latitude: "-6.175392",
        longitude: "106.827153",
        mapsUrl: "https://maps.app.goo.gl/abcdef",
      });

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));
      expect(row!.mapsUrl).toBe("https://maps.app.goo.gl/abcdef");
    });

    it("is regenerated when the coordinates change", async () => {
      // The silent failure this avoids: a venue moves, the link still points at the old
      // place, and the guest is simply sent somewhere else.
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, {
        ...EVENT,
        latitude: "-6.175392",
        longitude: "106.827153",
      });

      await service.update(user.scope, invitationId, created.id, {
        latitude: "-7.250445",
      });

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));
      expect(row!.mapsUrl).toContain("-7.250445,106.827153");
    });

    it("is not touched when the coordinates are unchanged", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, {
        ...EVENT,
        mapsUrl: "https://maps.app.goo.gl/abcdef",
      });

      await service.update(user.scope, invitationId, created.id, {
        title: "Renamed",
      });

      const [row] = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));
      expect(row!.mapsUrl).toBe("https://maps.app.goo.gl/abcdef");
    });

    it("buildMapsUrl needs both coordinates", () => {
      expect(buildMapsUrl(null, "106.8")).toBeNull();
      expect(buildMapsUrl("-6.1", null)).toBeNull();
      expect(buildMapsUrl(undefined, undefined)).toBeNull();
      expect(buildMapsUrl("-6.1", "106.8")).toContain("-6.1,106.8");
    });
  });

  describe("display_order (step 5)", () => {
    it("appends rather than prepending", async () => {
      // A new event must not silently jump to the front of a list the couple ordered on
      // purpose.
      const { user, invitationId } = await withInvitation();

      const first = await service.create(user.scope, invitationId, EVENT);
      const second = await service.create(user.scope, invitationId, {
        ...EVENT,
        title: "Resepsi",
      });

      expect(first.display_order).toBe(0);
      expect(second.display_order).toBe(1);
    });

    it("lists in display order, not insertion order", async () => {
      const { user, invitationId } = await withInvitation();
      const first = await service.create(user.scope, invitationId, EVENT);
      const second = await service.create(user.scope, invitationId, {
        ...EVENT,
        title: "Resepsi",
      });

      await service.update(user.scope, invitationId, second.id, {
        displayOrder: 0,
      });
      await service.update(user.scope, invitationId, first.id, {
        displayOrder: 1,
      });

      const list = await service.list(user.scope, invitationId);
      expect(list.map((e) => e.title)).toEqual(["Resepsi", "Akad Nikah"]);
    });

    it("an explicit order is respected on create", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, {
        ...EVENT,
        displayOrder: 7,
      });
      expect(created.display_order).toBe(7);
    });

    it("the next order does not count another invitation's events", async () => {
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });

      await service.create(user.scope, a.id, EVENT);
      await service.create(user.scope, a.id, EVENT);

      const firstOnB = await service.create(user.scope, b.id, EVENT);
      expect(firstOnB.display_order).toBe(0);
    });
  });

  describe("cascade (the DoD's fourth item)", () => {
    it("deleting the invitation row deletes its events", async () => {
      // `ON DELETE CASCADE` on `invitation_events.invitation_id`. Asserted against a HARD
      // delete, because that is what the constraint governs -- the product's own delete is
      // a soft one, which leaves the events in place by design.
      const { user, invitationId } = await withInvitation();
      await service.create(user.scope, invitationId, EVENT);
      await service.create(user.scope, invitationId, EVENT);

      await harness.pool.query("DELETE FROM invitations WHERE id = $1", [
        invitationId,
      ]);

      const rows = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.invitationId, invitationId));
      expect(rows).toHaveLength(0);
    });

    it("a soft-deleted invitation hides its events without deleting them", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await service.create(user.scope, invitationId, EVENT);

      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      await expect(
        service.list(user.scope, invitationId),
      ).rejects.toMatchObject({ status: 404 });

      const rows = await harness.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.id, created.id));
      expect(rows).toHaveLength(1);
    });
  });
});
