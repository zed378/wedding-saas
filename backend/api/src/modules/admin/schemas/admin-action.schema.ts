import { z } from "zod";

/**
 * P5-03: Mandatory reason for administrative state-altering actions.
 * docs/API/09 § Principles:
 * "All write endpoints that affect users (suspend, refund) REQUIRE a reason in the body"
 */
export const adminActionReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export type AdminActionReasonDto = z.infer<typeof adminActionReasonSchema>;

export const auditLogQuerySchema = z.object({
  admin_id: z.string().uuid().optional(),
  resource_type: z.string().trim().min(1).max(40).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;
