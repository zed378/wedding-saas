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

export const auditLogQuerySchema = z
  .object({
    admin_id: z.string().uuid().optional(),
    resource_type: z.string().trim().min(1).max(40).optional(),
    resource_id: z.string().uuid().optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (query) =>
      !query.date_from ||
      !query.date_to ||
      Date.parse(query.date_from) <= Date.parse(query.date_to),
    { path: ["date_to"], message: "date_to must not precede date_from" },
  );

export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;
