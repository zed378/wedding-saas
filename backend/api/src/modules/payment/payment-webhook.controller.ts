import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";

import { ok } from "../../http/envelope";
import { PaymentWebhookService } from "./payment-webhook.service";

/**
 * `P3-05` — `POST /api/webhooks/payment/:provider`. `docs/API/07` § Webhook Flow.
 *
 * **No `requireAuth`, and no rate limit** (`EXEMPT_PATH_PREFIXES`): the caller is the payment provider,
 * whose authenticity is the notification's signature, checked by the service before anything else, and
 * whose retries are legitimate traffic. Unversioned, because the provider holds the URL.
 *
 * `:provider` is not a resource id: it names the configured gateway, and anything else is 404. The IDOR
 * inventory exempts this route with the test that owns its access rule.
 */
@Controller("api/webhooks/payment")
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post(":provider")
  @HttpCode(200)
  async receive(@Param("provider") provider: string, @Body() body: unknown) {
    await this.webhooks.handle(provider, body);
    // 200 for every verified notification, whatever it did: the provider has nothing to retry.
    return ok({ received: true });
  }
}
