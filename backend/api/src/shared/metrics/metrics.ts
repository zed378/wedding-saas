/**
 * `P3-05` — counters in Prometheus text exposition format, with no dependency.
 *
 * `docs/DEVOPS/05` asks for a signature-failure rate and `docs/DEVOPS/07` alerts on it; nothing in the
 * API exposed a metric before this. ADR-017 chose Prometheus; this is the smallest thing that speaks
 * its format — counters with labels — because a counter is all the payment alerts need. Histograms and
 * the request metrics of `docs/DEVOPS/05` can move this to a client library when they arrive.
 *
 * Per process. Behind a single API container (ADR-015) that is the whole picture; with replicas,
 * Prometheus sums across scrape targets, which is how counters are meant to be read.
 */

type Labels = Readonly<Record<string, string>>;

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
      throw new Error(`invalid metric name ${name}`);
    }
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = this.key(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get(labels: Labels = {}): number {
    return this.values.get(this.key(labels)) ?? 0;
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, value] of [...this.values.entries()].sort()) {
      lines.push(`${this.name}${key} ${String(value)}`);
    }
    return lines.join("\n");
  }

  /** `{a="x",b="y"}` in declared label order; the empty string for no labels. */
  private key(labels: Labels): string {
    if (this.labelNames.length === 0) return "";
    const parts = this.labelNames.map(
      (name) => `${name}="${escape(labels[name] ?? "")}"`,
    );
    return `{${parts.join(",")}}`;
  }
}

function escape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

/** Every counter the API exposes. One registry per process. */
export const metrics = {
  paymentWebhookSignatureInvalid: new Counter(
    "wi_payment_webhook_signature_invalid_total",
    "Payment notifications refused because their signature did not verify or they were malformed.",
    ["provider", "reason"],
  ),
  paymentWebhookProcessed: new Counter(
    "wi_payment_webhook_processed_total",
    "Verified payment notifications, by what processing did with them.",
    ["provider", "result"],
  ),
  paymentNeedsReview: new Counter(
    "wi_payment_needs_review_total",
    "Verified payment notifications flagged for a human: late payment, second charge, mismatch, unknown payment.",
    ["provider", "result"],
  ),
  ordersExpired: new Counter(
    "wi_orders_expired_total",
    "Pending orders expired unpaid, by order type — a checkout-funnel signal (P3-07).",
    ["order_type"],
  ),
} as const;

export function renderMetrics(): string {
  return `${Object.values(metrics)
    .map((counter) => counter.render())
    .join("\n\n")}\n`;
}
