import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { parseBody } from "@/lib/validation/parse";
import { clientAddress, consumeRateLimit } from "@/lib/auth/rate-limit";
import { appBaseUrl, requestPasswordReset } from "@/lib/auth/password-reset";

const HOUR_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const { email } = await parseBody(request, forgotPasswordSchema);

    const byIp = consumeRateLimit(`forgot:ip:${clientAddress(request)}`, 10, HOUR_MS);
    const byEmail = consumeRateLimit(`forgot:email:${email}`, 3, HOUR_MS);
    if (!byIp.allowed || !byEmail.allowed) {
      throw AppError.tooManyRequests(
        "Too many reset requests. Please try again later.",
        Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds)
      );
    }

    try {
      await requestPasswordReset(email, appBaseUrl(request));
    } catch (error) {
      // The caller must not learn whether the account exists or whether delivery failed.
      console.error("Password reset request failed", error);
    }

    return NextResponse.json(
      { message: "If an account exists for that email, a reset link is on its way." },
      { status: 202 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
