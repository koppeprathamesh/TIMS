import type { NextRequest } from "next/server";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { queryObject } from "@/lib/validation/query";

// Query strings are validated like bodies: bad input is a 400 with field errors, never a 500.
export function parseQuery<T extends z.ZodTypeAny>(request: NextRequest, schema: T): z.infer<T> {
  const parsed = schema.safeParse(queryObject(request.nextUrl.searchParams));
  if (!parsed.success) throw AppError.badRequest("Invalid query parameters.", parsed.error.flatten());
  return parsed.data;
}

export async function parseBody<T extends z.ZodTypeAny>(request: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw AppError.badRequest("Invalid request.", parsed.error.flatten());
  return parsed.data;
}
