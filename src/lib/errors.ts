import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }
  static unauthorized(message = "Authentication is required.") {
    return new AppError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You do not have permission to perform this action.") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(message = "The requested resource was not found.") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, "CONFLICT", message, details);
  }
  static tooManyRequests(message = "Too many attempts. Please try again later.", retryAfterSeconds = 60) {
    return new AppError(429, "RATE_LIMITED", message, { retryAfterSeconds });
  }
}

// Consistent error envelope. Never leaks stack traces or internal details.
export function errorResponse(error: unknown) {
  const correlationId = randomUUID();

  if (error instanceof AppError) {
    const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.status === 429 ? undefined : error.details,
          correlationId,
        },
      },
      {
        status: error.status,
        headers: error.status === 429 && retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
      }
    );
  }

  console.error(`[correlationId=${correlationId}]`, error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again or contact support.",
        correlationId,
      },
    },
    { status: 500 }
  );
}
