import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import { AnalyticsService, PENDING_VIEWS_HASH } from "../src/modules/analytics/analytics.service";
import { PublicViewController } from "../src/modules/analytics/public-view.controller";
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
      mockAnalyticsRepo,
      mockPublicInvitationRepo,
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
