import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import type { Env } from "../src/config/env.schema";
import { FakePaymentGateway } from "../src/modules/payment/fake-payment-gateway";
import { MidtransGateway } from "../src/modules/payment/midtrans/midtrans.gateway";
import { selectPaymentGateway } from "../src/modules/payment/payment-gateway.provider";

/**
 * `P3-03` — the fake gateway `P3-05`'s abuse suites will drive, the environment selection, and the
 * two module boundaries the card's DoD names.
 */

describe("the fake gateway produces every notification P3-05 needs", () => {
  it("a genuine notification verifies", () => {
    const gateway = new FakePaymentGateway();
    const n = gateway.notify("pay-1", "success", 139000n);
    expect(gateway.verifyNotification(n)).toMatchObject({
      valid: true,
      event: {
        providerReferenceId: "pay-1",
        outcome: "success",
        amount: 139000n,
      },
    });
  });

  it("a forged notification does not", () => {
    const gateway = new FakePaymentGateway();
    expect(
      gateway.verifyNotification(gateway.forge("pay-1", "success", 139000n)),
    ).toEqual({
      valid: false,
      reason: "signature_mismatch",
      claimedReference: "pay-1",
    });
  });

  it.each([
    ["amount", { amount: "1" }],
    ["outcome", { outcome: "success" as const }],
    ["reference", { reference: "pay-2" }],
    ["sequence", { sequence: 99 }],
  ])("a notification tampered in %s does not", (_field, change) => {
    const gateway = new FakePaymentGateway();
    const genuine = gateway.notify("pay-1", "pending", 139000n);
    expect(
      gateway.verifyNotification(gateway.tamper(genuine, change)).valid,
    ).toBe(false);
  });

  it("a duplicate verifies both times, identically", () => {
    const gateway = new FakePaymentGateway();
    const n = gateway.notify("pay-1", "success", 139000n);
    expect(gateway.verifyNotification(n)).toEqual(
      gateway.verifyNotification({ ...n }),
    );
  });

  it("out-of-order notifications are each genuine and carry their issue order", () => {
    const gateway = new FakePaymentGateway();
    const pending = gateway.notify("pay-1", "pending", 139000n);
    const success = gateway.notify("pay-1", "success", 139000n);
    // Delivered success first, then pending: both verify; the handler must not regress.
    expect(gateway.verifyNotification(success).valid).toBe(true);
    expect(gateway.verifyNotification(pending).valid).toBe(true);
    expect(gateway.sequenceOf(success)).toBeGreaterThan(
      gateway.sequenceOf(pending),
    );
  });

  it("malformed payloads are malformed", () => {
    const gateway = new FakePaymentGateway();
    for (const body of [null, "x", {}, { reference: "pay-1" }]) {
      expect(gateway.verifyNotification(body)).toMatchObject({
        valid: false,
        reason: "malformed",
      });
    }
  });

  it("a notification from one instance does not verify on another (random key per process)", () => {
    const a = new FakePaymentGateway();
    const b = new FakePaymentGateway();
    expect(b.verifyNotification(a.notify("pay-1", "success", 1n)).valid).toBe(
      false,
    );
  });

  it("reports the latest notified status, null for an unknown reference, and simulates outages", async () => {
    const gateway = new FakePaymentGateway();
    gateway.notify("pay-1", "pending", 5n);
    gateway.notify("pay-1", "success", 5n);
    expect((await gateway.queryStatus("pay-1"))?.outcome).toBe("success");
    expect(await gateway.queryStatus("pay-unknown")).toBeNull();

    gateway.outage = "retryable";
    await expect(
      gateway.createTransaction({
        providerReferenceId: "pay-2",
        amount: 5n,
        customer: { name: "A", email: "a@example.test" },
      }),
    ).rejects.toMatchObject({ retryable: true });
    expect(gateway.created).toEqual([]);
  });
});

describe("which gateway runs (P0-18)", () => {
  const env = (over: Partial<Env>): Env =>
    ({ APP_ENV: "development", NODE_ENV: "development", ...over }) as Env;

  it("Midtrans whenever a server key is configured", () => {
    expect(
      selectPaymentGateway(env({ MIDTRANS_SERVER_KEY: "SB-Mid-server-x" })),
    ).toBeInstanceOf(MidtransGateway);
  });

  it.each(["development", "test"] as const)(
    "the fake in %s without a key",
    (APP_ENV) => {
      expect(selectPaymentGateway(env({ APP_ENV }))).toBeInstanceOf(
        FakePaymentGateway,
      );
    },
  );

  it("never the fake on a deployed environment without a key: it refuses everything", async () => {
    const gateway = selectPaymentGateway(
      env({ APP_ENV: "staging", NODE_ENV: "production" }),
    );
    expect(gateway).not.toBeInstanceOf(FakePaymentGateway);
    await expect(
      gateway.createTransaction({
        providerReferenceId: "pay-1",
        amount: 1n,
        customer: { name: "A", email: "a@example.test" },
      }),
    ).rejects.toMatchObject({ name: "PaymentProviderError", retryable: false });
    expect(
      gateway.verifyNotification(
        new FakePaymentGateway().notify("p", "success", 1n),
      ).valid,
    ).toBe(false);
  });
});

// --------------------------------------------------------------------------- boundaries

const SRC = join(__dirname, "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? sources(full)
      : /\.ts$/.test(entry)
        ? [full]
        : [];
  });
}

describe("module boundaries (card DoD)", () => {
  it("the payment module contains no reference to invitations", () => {
    // `docs/BACKEND/01`: payment talks to `order`; `order` emits `order.paid`.
    const offenders = sources(join(SRC, "modules", "payment")).filter((file) =>
      /invitation/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("nothing outside the adapter names the provider", () => {
    // Allowed: the adapter folder; the composition root that constructs it; configuration, where
    // the environment variables carry the vendor's name.
    const allowed = [
      join("modules", "payment", "midtrans"),
      join("modules", "payment", "payment-gateway.provider.ts"),
      join("config"),
    ];
    const offenders = sources(SRC)
      .filter((file) => !allowed.some((a) => relative(SRC, file).startsWith(a)))
      .filter((file) => /midtrans/i.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
