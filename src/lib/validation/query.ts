import { z } from "zod";

// Shared, strict handling of query strings: invalid input is a 400, never a 500, and sort fields
// are whitelisted so callers cannot order by internal columns.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const pageParam = z.coerce.number().int("page must be a whole number.").min(1, "page must be at least 1.").max(100_000).default(1);

export function pageSizeParam(defaultSize: number, max = 100) {
  return z.coerce.number().int("pageSize must be a whole number.").min(1).max(max).default(defaultSize);
}

export const dateParam = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(DATE_ONLY.test(v) ? `${v}T00:00:00.000Z` : v).getTime()), "Invalid date.");

export const sortDirParam = z.enum(["asc", "desc"]).default("asc");

// A date-only `to` value is inclusive of that whole day.
export function toDate(value: string, endOfDay: boolean) {
  return new Date(DATE_ONLY.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
}

// Empty strings behave like a missing parameter so forms can submit blank filters.
export function queryObject(params: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value !== "" && !(key in out)) out[key] = value;
  }
  return out;
}
