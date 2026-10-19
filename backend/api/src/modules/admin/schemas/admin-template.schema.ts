import { z } from "zod";

/**
 * P5-04: Admin Template and Version Management schemas.
 * docs/API/03-TEMPLATE-API.md § Admin
 */

export const createTemplateSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must only contain lowercase alphanumeric characters and hyphens",
    ),
  name: z.string().trim().min(1).max(100),
  category: z.array(z.string().trim().min(1).max(40)).default([]),
  is_premium: z.boolean().default(false),
  thumbnail_url: z.string().url().max(500).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  category: z.array(z.string().trim().min(1).max(40)).optional(),
  is_premium: z.boolean().optional(),
  thumbnail_url: z.string().url().max(500).nullable().optional(),
  status: z.enum(["draft", "published", "deprecated"]).optional(),
  reason: z.string().trim().min(5).max(500),
});

export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;

export const createTemplateVersionSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(
      /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/,
      "Version must follow semantic versioning (e.g. 1.0.0)",
    ),
  sections: z.unknown(),
  theme: z.unknown(),
  customizable_theme_keys: z
    .array(z.string().trim().min(1).max(60))
    .default([]),
  changelog: z.string().trim().max(5000).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

export type CreateTemplateVersionDto = z.infer<
  typeof createTemplateVersionSchema
>;

export const updateTemplateVersionSchema = z.object({
  sections: z.unknown().optional(),
  theme: z.unknown().optional(),
  customizable_theme_keys: z
    .array(z.string().trim().min(1).max(60))
    .optional(),
  changelog: z.string().trim().max(5000).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

export type UpdateTemplateVersionDto = z.infer<
  typeof updateTemplateVersionSchema
>;

export const templateVersionActionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export type TemplateVersionActionDto = z.infer<
  typeof templateVersionActionSchema
>;

export const deleteTemplateSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export type DeleteTemplateDto = z.infer<typeof deleteTemplateSchema>;
