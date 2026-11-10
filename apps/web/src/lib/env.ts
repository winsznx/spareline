import { z } from "zod";

const schema = z.object({
  // Absolute URL, or a same-origin path served by the Next.js rewrite in next.config.ts (e.g. "/api/v1").
  NEXT_PUBLIC_API_BASE_URL: z
    .union([z.string().url(), z.string().regex(/^\/[a-z0-9/_-]*$/i)])
    .default("http://localhost:8000/v1"),
  NEXT_PUBLIC_MAP_STYLE_URL: z.string().url().default("https://tiles.openfreemap.org/styles/positron"),
});

const parsed = schema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || undefined,
  NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL || undefined,
});

export const API_BASE_URL = parsed.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
export const MAP_STYLE_URL = parsed.NEXT_PUBLIC_MAP_STYLE_URL;
