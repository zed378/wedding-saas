import { beforeEach, describe, expect, it, vi } from "vitest";

const { QueueMock } = vi.hoisted(() => ({
  QueueMock: vi.fn(),
}));

vi.mock("bullmq", () => ({ Queue: QueueMock }));

import type { Env } from "../../config/env.schema";
import { EmailBounceService } from "./email-bounce.service";
import { DlqMonitorService } from "./dlq-monitor.service";

describe("DlqMonitorService", () => {
  const bounceService = {
    recordDeadLetter: vi.fn(),
  } as unknown as EmailBounceService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts queued jobs and records only critical notification templates", async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({
        wait: 1,
        delayed: 2,
        failed: 3,
        completed: 20,
      }),
      getJobs: vi.fn().mockResolvedValue([
        {
          id: "job-order",
          attemptsMade: 4,
          data: {
            job_name: "order-paid-email",
            payload: { template: "order_paid", orderId: "order-1" },
          },
        },
        {
          id: "job-verification",
          attemptsMade: 2,
          data: { payload: { template: "email_verification" } },
        },
        {
          id: "job-reset",
          attemptsMade: 1,
          data: { payload: { template: "password_reset" } },
        },
        {
          id: "job-bank-change",
          attemptsMade: 5,
          data: { payload: { template: "bank_account_changed" } },
        },
        {
          id: "job-reminder",
          attemptsMade: 1,
          data: { payload: { template: "event_reminder" } },
        },
        { id: "job-no-payload", attemptsMade: 1, data: { job_name: "other" } },
        {
          id: "job-empty-payload",
          attemptsMade: 1,
          data: { payload: {} },
        },
      ]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });

    const service = new DlqMonitorService(
      { REDIS_URL: "redis://:secret@redis.example:6380/0" } as Env,
      bounceService,
    );

    await expect(service.checkDlq()).resolves.toEqual({
      totalDeadLettered: 6,
      criticalFailuresFound: 4,
    });
    expect(QueueMock).toHaveBeenCalledWith("dead-letter", {
      connection: {
        host: "redis.example",
        port: 6380,
        password: "secret",
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
      },
    });
    expect(queue.getJobs).toHaveBeenCalledWith(
      ["wait", "delayed", "failed"],
      0,
      50,
    );
    expect(bounceService.recordDeadLetter).toHaveBeenCalledTimes(4);
    expect(bounceService.recordDeadLetter).toHaveBeenNthCalledWith(
      1,
      "order_paid",
      {
        jobId: "job-order",
        jobName: "order-paid-email",
        attempts: 4,
      },
    );
    expect(bounceService.recordDeadLetter).toHaveBeenNthCalledWith(
      2,
      "email_verification",
      {
        jobId: "job-verification",
        jobName: undefined,
        attempts: 2,
      },
    );
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("uses zero defaults for missing counts and the default Redis port", async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ wait: 0, failed: 0 }),
      getJobs: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });

    const service = new DlqMonitorService(
      { REDIS_URL: "redis://redis.example" } as Env,
      bounceService,
    );

    await expect(service.checkDlq()).resolves.toEqual({
      totalDeadLettered: 0,
      criticalFailuresFound: 0,
    });
    expect(QueueMock).toHaveBeenCalledWith("dead-letter", {
      connection: {
        host: "redis.example",
        port: 6379,
        password: undefined,
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
      },
    });
    expect(bounceService.recordDeadLetter).not.toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("defaults the wait and failed counts when Redis omits them", async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ delayed: 2 }),
      getJobs: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });

    const service = new DlqMonitorService(
      { REDIS_URL: "redis://redis.example:6379" } as Env,
      bounceService,
    );

    await expect(service.checkDlq()).resolves.toEqual({
      totalDeadLettered: 2,
      criticalFailuresFound: 0,
    });
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("returns an empty result after queue inspection errors and still closes the queue", async () => {
    const queue = {
      getJobCounts: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      getJobs: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });

    const service = new DlqMonitorService(
      { REDIS_URL: "redis://redis.example:6379" } as Env,
      bounceService,
    );

    await expect(service.checkDlq()).resolves.toEqual({
      totalDeadLettered: 0,
      criticalFailuresFound: 0,
    });
    expect(queue.getJobs).not.toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalledOnce();
    expect(bounceService.recordDeadLetter).not.toHaveBeenCalled();
  });

  it("closes the queue when reading jobs fails after counts were available", async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ wait: 3 }),
      getJobs: vi.fn().mockRejectedValue(new Error("job payload unavailable")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });
    const service = new DlqMonitorService(
      { REDIS_URL: "redis://redis.example" } as Env,
      bounceService,
    );
    await expect(service.checkDlq()).resolves.toEqual({
      totalDeadLettered: 0,
      criticalFailuresFound: 0,
    });
    expect(queue.close).toHaveBeenCalledOnce();
    expect(bounceService.recordDeadLetter).not.toHaveBeenCalled();
  });

  it("propagates queue shutdown failure so the caller does not treat cleanup as successful", async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({}),
      getJobs: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockRejectedValue(new Error("queue shutdown failed")),
    };
    QueueMock.mockImplementation(function () {
      return queue;
    });
    const service = new DlqMonitorService(
      { REDIS_URL: "redis://redis.example" } as Env,
      bounceService,
    );
    await expect(service.checkDlq()).rejects.toThrow("queue shutdown failed");
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
