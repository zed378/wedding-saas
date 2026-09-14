import { Inject, Injectable } from "@nestjs/common";

import { logger } from "../../shared/logging/logger";
import { CATALOG, type CatalogReader } from "./catalog.token";
import type { PackageRow } from "./catalog.repository";

/** The addon whose purchase allows a custom domain (`P7-01`). */
const CUSTOM_DOMAIN_ADDON = "custom_domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an invitation is allowed. Every consumer reads these, never a package row. */
export interface Entitlements {
  /** The package these come from, or `null` for an invitation nobody has paid for. */
  readonly packageId: string | null;
  /** BR-8.1, `docs/PLAN/11` § Limits per Package. */
  readonly maxPhotos: number;
  /** `docs/API/08` `display.watermark`. */
  readonly watermark: boolean;
  /**
   * Months of validity a paid publish grants (`P3-09`). `null` when unpaid: a trial publish's
   * three days are BR-2.8's, not a package attribute.
   */
  readonly durationMonths: number | null;
  /** Whether a custom domain may be attached (`P7-01`). */
  readonly customDomain: boolean;
}

/**
 * `P3-01` — the one answer to "what is this invitation allowed".
 *
 * Before this service the answer lived in three places: a `200` constant in `MediaService`,
 * the same constant imported by `GalleryService`, and a watermark query in
 * `PublicInvitationRepository`. Three places agree only until a second tier exists.
 *
 * ## Paid
 *
 * The package of the **latest paid order**. Only `status = 'paid'` counts — see
 * `CatalogRepository.latestPaidPurchase` for why pending and refunded do not. A package later
 * deactivated still governs the invitations that bought it: deactivation stops new sales.
 *
 * ## Unpaid (ADR-073)
 *
 * `docs/PLAN/11` gives the free draft 200 photos and `docs/API/08` makes it watermarked; no
 * document says where those numbers come from once a second tier exists. The photo quota is
 * the **smallest** `max_photos` among active packages — a draft can then never hold more
 * photos than the cheapest purchase allows, so paying never strands an upload. Today that is
 * the one package's 200, exactly `docs/PLAN/11`'s figure.
 */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(CATALOG) private readonly catalog: CatalogReader) {}

  async forInvitation(invitationId: string): Promise<Entitlements> {
    // An id that cannot be a UUID has no orders, and must not reach Postgres as one: a cast
    // error would turn the caller's ordinary 404 into a 500.
    if (!UUID.test(invitationId)) return this.unpaid();
    const purchase = await this.catalog.latestPaidPurchase(invitationId);
    if (purchase !== null) {
      return {
        ...fromPackage(purchase.package),
        customDomain: purchase.addonIds.includes(CUSTOM_DOMAIN_ADDON),
      };
    }
    return this.unpaid();
  }

  /** What a purchase of this package would grant — for checkout copy and `P3-09`. */
  forPackage(pkg: PackageRow): Entitlements {
    return { ...fromPackage(pkg), customDomain: false };
  }

  async unpaid(): Promise<Entitlements> {
    const active = await this.catalog.activePackages();
    if (active.length === 0) {
      // A broken seed. Failing loudly beats inventing a quota nobody decided.
      logger.error(
        { context: { event: "entitlements.no_active_package" } },
        "no active package: unpaid entitlements cannot be computed",
      );
      throw new Error("No active package exists; check the packages seed.");
    }
    return {
      packageId: null,
      maxPhotos: Math.min(...active.map((pkg) => pkg.maxPhotos)),
      // BR-2.8: a trial publish is watermarked; `docs/API/08`: never the premium page
      // without payment.
      watermark: true,
      durationMonths: null,
      customDomain: false,
    };
  }
}

function fromPackage(pkg: PackageRow): Omit<Entitlements, "customDomain"> {
  return {
    packageId: pkg.id,
    maxPhotos: pkg.maxPhotos,
    watermark: pkg.hasWatermark,
    durationMonths: pkg.durationMonths,
  };
}
