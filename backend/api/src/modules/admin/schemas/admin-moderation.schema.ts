import { z } from "zod";

/**
 * P5-09: Administrative Moderation schemas.
 * docs/API/09-ADMIN-API.md § Moderation
 */
export const adminModerationQuerySchema = z.object({
  status: z
    .enum(["all", "pending", "approved", "rejected"])
    .default("pending"),
  invitation_id: z.string().uuid().optional(),
  flag_source: z
    .enum(["all", "reported", "auto_flagged"])
    .default("all"),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminModerationQueryDto = z.infer<
  typeof adminModerationQuerySchema
>;

export const adminModerateActionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500).optional(),
});

export type AdminModerateActionDto = z.infer<
  typeof adminModerateActionSchema
>;

export const adminDeleteActionSchema = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

export type AdminDeleteActionDto = z.infer<
  typeof adminDeleteActionSchema
>;
