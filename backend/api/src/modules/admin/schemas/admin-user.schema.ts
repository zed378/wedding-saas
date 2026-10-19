import { z } from "zod";

/**
 * P5-06: Admin User Management schemas.
 * docs/API/09-ADMIN-API.md § User Management
 */

export const adminUserQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "suspended"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUserQueryDto = z.infer<typeof adminUserQuerySchema>;

export const adminUserActionReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export type AdminUserActionReasonDto = z.infer<
  typeof adminUserActionReasonSchema
>;
