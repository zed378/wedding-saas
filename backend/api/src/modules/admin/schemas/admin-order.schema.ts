import { z } from "zod";

export const adminOrderQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z
    .enum(["all", "pending", "paid", "failed", "expired", "refunded"])
    .default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminOrderQueryDto = z.infer<typeof adminOrderQuerySchema>;
