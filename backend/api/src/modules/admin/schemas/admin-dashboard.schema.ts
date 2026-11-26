import { z } from "zod";
/** Fixed UTC periods; arbitrary filters are not part of API/09. */
export const adminDashboardQuerySchema = z.strictObject({});
export type AdminDashboardQueryDto = z.infer<typeof adminDashboardQuerySchema>;
