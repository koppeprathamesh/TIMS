import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { parseBody } from "@/lib/validation/parse";
import { clientAddress, consumeRateLimit } from "@/lib/auth/rate-limit";
import { resetPasswordWithToken } from "@/lib/auth/password-reset";

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await parseBody(request, resetPasswordSchema);

    const limit = consumeRateLimit(`reset:ip:${clientAddress(request)}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) {
      throw AppError.tooManyRequests("Too many attempts. Please try again later.", limit.retryAfterSeconds);
    }

    await resetPasswordWithToken(token, password);
    return NextResponse.json({ message: "Your password has been updated. You can now sign in." });
  } catch (error) {
    return errorResponse(error);
  }
}
