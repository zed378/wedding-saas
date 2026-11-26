import { z } from "zod";
import { sanitizePlainText } from "../../../shared/sanitizer/sanitize";

const reason = z
  .string()
  .trim()
  .min(5)
  .max(500)
  .transform(sanitizePlainText)
  .pipe(z.string().trim().min(5).max(500));
export const slugBlocklistWriteSchema = z
  .object({
    term: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/),
    match_type: z.enum(["exact", "substring"]),
    category: z.enum(["reserved", "profanity", "brand", "other"]),
    reason,
  })
  .strict();
export const slugBlocklistDeleteSchema = z.object({ reason }).strict();
export const slugBlocklistTestSchema = z
  .object({ slug: z.string().trim().min(3).max(50) })
  .strict();
export const slugBlocklistQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type SlugBlocklistWrite = z.infer<typeof slugBlocklistWriteSchema>;
