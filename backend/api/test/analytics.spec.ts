import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import { AnalyticsService, PENDING_VIEWS_HASH } from "../src/modules/analytics/analytics.service";
import { PublicViewController } from "../src/modules/analytics/public-view.controller";
import { OwnerAnalyticsController } from "../src/modules/analytics/owner-analytics.controller";
import type { AnalyticsRepository } from "../src/shared/tenancy/analytics-repository";
import type { PublicInvitationRepository } from "../src/shared/tenancy/public-invitation-repository";
import { NotFoundError, ValidationError } from "../src/http/errors";

describe("AnalyticsService (P4-09)", () => {
  it("increments redis pending hash for published invitation", async () => {
    const mockRedis = {
      hincrby: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const mockAnalyticsRepo = {
      recordBatch: vi.fn(),
      getViewSummary: vi.fn(),
    } as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {
      findPublishedBySlug: vi.fn().mockResolvedValue({
        invitation: { id: "inv-uuid-1", slug: "romeo-juliet" },
        version: { sections: [] },
      }),
    } as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    const result = await service.recordView("romeo-juliet");
    expect(result).toEqual({ recorded: true });
    expect(mockPublicInvitationRepo.findPublishedBySlug).toHaveBeenCalledWith("romeo-juliet");
    expect(mockRedis.hincrby).toHaveBeenCalledTimes(1);

    const callArgs = (mockRedis.hincrby as any).mock.calls[0];
    expect(callArgs[0]).toBe(PENDING_VIEWS_HASH);
    expect(callArgs[1]).toMatch(/^inv-uuid-1:\d{4}-\d{2}-\d{2}$/);
    expect(callArgs[2]).toBe(1);
  });

  it("throws NotFoundError when invitation is draft, unpublished, expired or missing", async () => {
    const mockRedis = {
      hincrby: vi.fn(),
    } as unknown as Redis;

    const mockAnalyticsRepo = {} as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {
      findPublishedBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    await expect(service.recordView("unpublished-slug")).rejects.toThrow(NotFoundError);
    expect(mockRedis.hincrby).not.toHaveBeenCalled();
  });

  it("fails open and returns { recorded: false } when Redis throws", async () => {
    const mockRedis = {
      hincrby: vi.fn().mockRejectedValue(new Error("Redis connection refused")),
    } as unknown as Redis;

    const mockAnalyticsRepo = {} as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {
      findPublishedBySlug: vi.fn().mockResolvedValue({
        invitation: { id: "inv-uuid-1", slug: "romeo-juliet" },
        version: { sections: [] },
      }),
    } as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    const result = await service.recordView("romeo-juliet");
    expect(result).toEqual({ recorded: false });
  });

  it("flushes accumulated view counts atomically from Redis to database", async () => {
    const mockRedis = {
      rename: vi.fn().mockResolvedValue("OK"),
      hgetall: vi.fn().mockResolvedValue({
        "inv-uuid-1:2026-10-19": "42",
        "inv-uuid-2:2026-10-19": "10",
      }),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const mockAnalyticsRepo = {
      recordBatch: vi.fn().mockResolvedValue(52),
    } as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {} as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    const result = await service.flushViewCounts();
    expect(result).toEqual({ flushed: 52, entries: 2 });
    expect(mockRedis.rename).toHaveBeenCalledTimes(1);
    expect(mockAnalyticsRepo.recordBatch).toHaveBeenCalledWith([
      { invitationId: "inv-uuid-1", viewDate: "2026-10-19", count: 42 },
      { invitationId: "inv-uuid-2", viewDate: "2026-10-19", count: 10 },
    ]);
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
  });

  it("handles empty pending hash during flush cleanly without DB writes", async () => {
    const mockRedis = {
      rename: vi.fn().mockRejectedValue(new Error("ERR no such key")),
      hgetall: vi.fn(),
      del: vi.fn(),
    } as unknown as Redis;

    const mockAnalyticsRepo = {
      recordBatch: vi.fn(),
    } as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {} as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    const result = await service.flushViewCounts();
    expect(result).toEqual({ flushed: 0, entries: 0 });
    expect(mockAnalyticsRepo.recordBatch).not.toHaveBeenCalled();
  });

  it("flush failure is best-effort and does not throw", async () => {
    const mockRedis = {
      rename: vi.fn().mockResolvedValue("OK"),
      hgetall: vi.fn().mockResolvedValue({ "inv-uuid-1:2026-10-19": "5" }),
      del: vi.fn(),
    } as unknown as Redis;

    const mockAnalyticsRepo = {
      recordBatch: vi.fn().mockRejectedValue(new Error("Postgres connection timeout")),
    } as unknown as AnalyticsRepository;

    const mockPublicInvitationRepo = {} as unknown as PublicInvitationRepository;

    const service = new AnalyticsService(
      mockRedis,
      {} as any,
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
      {} as any,
      {} as any,
    );

    const result = await service.flushViewCounts();
    expect(result).toEqual({ flushed: 0, entries: 0 });
  });
});

describe("PublicViewController (P4-09)", () => {
  it("records view for valid slug and empty payload", async () => {
    const mockService = {
      recordView: vi.fn().mockResolvedValue({ recorded: true }),
    } as unknown as AnalyticsService;

    const controller = new PublicViewController(mockService);
    const response = await controller.recordView("romeo-juliet", {});

    expect(response).toEqual({
      success: true,
      data: { recorded: true },
    });
    expect(mockService.recordView).toHaveBeenCalledWith("romeo-juliet");
  });

  it("rejects non-whitelisted payload fields with ValidationError", async () => {
    const mockService = {
      recordView: vi.fn(),
    } as unknown as AnalyticsService;

    const controller = new PublicViewController(mockService);
    await expect(
      controller.recordView("romeo-juliet", { malicious: "field" }),
    ).rejects.toThrow(ValidationError);
    expect(mockService.recordView).not.toHaveBeenCalled();
  });
});

describe("AnalyticsService - getAnalyticsSummary (P4-10)", () => {
  const scope = "user-alice" as any;

  it("returns cached summary on cache hit without querying repositories", async () => {
    const mockCache = {
      getJson: vi.fn().mockResolvedValue({
        views: { total: 100, daily: [] },
        rsvps: { total_responses: 5, attending: 4, not_attending: 1, maybe: 0, total_attending_guests: 6 },
        guestbook: { total: 3, pending: 1, approved: 2, rejected: 0 },
      }),
      setJson: vi.fn(),
    };

    const mockRsvpRepo = { ownsInvitation: vi.fn() };
    const mockAnalyticsRepo = { getViewSummary: vi.fn() };
    const mockGuestbookRepo = { getGuestbookSummaryForOwner: vi.fn() };

    const service = new AnalyticsService(
      {} as any,
      mockCache as any,
      mockAnalyticsRepo as any,
      {} as any,
      mockRsvpRepo as any,
      mockGuestbookRepo as any,
    );

    const summary = await service.getAnalyticsSummary(scope, "inv-1");
    expect(summary.views.total).toBe(100);
    expect(mockCache.getJson).toHaveBeenCalledWith("analytics", "inv-1");
    expect(mockRsvpRepo.ownsInvitation).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when caller is not the owner (IDOR safe)", async () => {
    const mockCache = {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn(),
    };

    const mockRsvpRepo = {
      ownsInvitation: vi.fn().mockResolvedValue(false),
    };

    const service = new AnalyticsService(
      {} as any,
      mockCache as any,
      {} as any,
      {} as any,
      mockRsvpRepo as any,
      {} as any,
    );

    await expect(service.getAnalyticsSummary(scope, "inv-stranger")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("aggregates views, rsvps, guestbook, and pending Redis views for owner", async () => {
    const mockCache = {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn(),
    };

    const mockRedis = {
      hget: vi.fn().mockResolvedValue("7"),
    };

    const mockRsvpRepo = {
      ownsInvitation: vi.fn().mockResolvedValue(true),
      getRsvpSummaryForOwner: vi.fn().mockResolvedValue({
        total_responses: 10,
        attending: 8,
        not_attending: 2,
        maybe: 0,
        total_attending_guests: 15,
      }),
    };

    const mockAnalyticsRepo = {
      getViewSummary: vi.fn().mockResolvedValue({
        totalViews: 50,
        dailyViews: [{ date: "2026-10-18", count: 50 }],
      }),
    };

    const mockGuestbookRepo = {
      getGuestbookSummaryForOwner: vi.fn().mockResolvedValue({
        total: 4,
        pending: 1,
        approved: 3,
        rejected: 0,
      }),
    };

    const service = new AnalyticsService(
      mockRedis as any,
      mockCache as any,
      mockAnalyticsRepo as any,
      {} as any,
      mockRsvpRepo as any,
      mockGuestbookRepo as any,
    );

    const result = await service.getAnalyticsSummary(scope, "inv-owner");

    expect(result.views.total).toBe(57); // 50 + 7 pending
    expect(result.rsvps.total_responses).toBe(10);
    expect(result.rsvps.total_attending_guests).toBe(15);
    expect(result.guestbook.total).toBe(4);
    expect(result.guestbook.approved).toBe(3);

    // Verify cached for 30s
    expect(mockCache.setJson).toHaveBeenCalledWith(
      "analytics",
      "inv-owner",
      result,
      30,
    );
  });
});

describe("OwnerAnalyticsController (P4-10)", () => {
  it("returns analytics summary inside standard envelope for authenticated owner", async () => {
    const mockService = {
      getAnalyticsSummary: vi.fn().mockResolvedValue({
        views: { total: 42, daily: [] },
        rsvps: { total_responses: 3, attending: 2, not_attending: 1, maybe: 0, total_attending_guests: 4 },
        guestbook: { total: 2, pending: 0, approved: 2, rejected: 0 },
      }),
    } as unknown as AnalyticsService;

    const controller = new OwnerAnalyticsController(mockService);

    const aliceId = "a11ce000-0000-4000-8000-000000000001";
    const response = await controller.getAnalytics("inv-123", {
      id: aliceId,
      scope: aliceId as any,
      email: "alice@example.com",
      fullName: "Alice",
      role: "user",
      emailVerified: true,
    });

    expect(response).toEqual({
      success: true,
      data: {
        views: { total: 42, daily: [] },
        rsvps: { total_responses: 3, attending: 2, not_attending: 1, maybe: 0, total_attending_guests: 4 },
        guestbook: { total: 2, pending: 0, approved: 2, rejected: 0 },
      },
    });
    expect(mockService.getAnalyticsSummary).toHaveBeenCalledWith(aliceId, "inv-123");
  });
});
