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

export const adminOrderRefundSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  step_up_code: z.string().trim().optional(),
});

export type AdminOrderRefundDto = z.infer<typeof adminOrderRefundSchema>;

