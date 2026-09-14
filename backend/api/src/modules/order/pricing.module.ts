import { Module } from "@nestjs/common";

import { CatalogRepository } from "./catalog.repository";
import { CATALOG } from "./catalog.token";
import { EntitlementsService } from "./entitlements.service";
import { PricingService } from "./pricing.service";

/**
 * `P3-01` — pricing and entitlements. Imported by media (quota), invitation (gallery quota),
 * publishing (watermark) and, from `P3-02`, orders.
 */
@Module({
  providers: [
    CatalogRepository,
    { provide: CATALOG, useExisting: CatalogRepository },
    PricingService,
    EntitlementsService,
  ],
  exports: [PricingService, EntitlementsService],
})
export class PricingModule {}
