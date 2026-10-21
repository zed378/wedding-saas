import { z } from "zod";

/**
 * P5-10: Admin Invitation Search and Detail Schema.
 * docs/API/09-ADMIN-API.md § Invitation Overview
 */
export const adminInvitationQuerySchema = z.object({
  search_slug: z.string().trim().max(50).optional(),
  search_user: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminInvitationQueryDto = z.infer<typeof adminInvitationQuerySchema>;

export const adminInvitationDetailSchema = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

export type AdminInvitationDetailDto = z.infer<typeof adminInvitationDetailSchema>;
