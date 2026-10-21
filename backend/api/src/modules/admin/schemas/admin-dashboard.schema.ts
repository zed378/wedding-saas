import { z } from "zod";

/**
 * P5-11: Dashboard Metrics Schema.
 * docs/API/09-ADMIN-API.md § Dashboard
 */
export const adminDashboardQuerySchema = z.object({
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

export type AdminDashboardQueryDto = z.infer<typeof adminDashboardQuerySchema>;

