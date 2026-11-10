import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPasswordConstantTime } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { issueSession } from "@/lib/auth/issue-session";
import { clientAddress, consumeRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { AppError, errorResponse } from "@/lib/errors";
import { loginSchema } from "@/lib/validation/auth";
import { recordAuditEvent } from "@/lib/audit";

const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 30;
const EMAIL_LIMIT = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// One message for every refusal so the response never reveals whether an account exists or is locked.
const GENERIC_FAILURE = "Invalid email or password.";

async function auditBestEffort(input: Parameters<typeof recordAuditEvent>[0]) {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    console.error("Failed to record login audit event", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.badRequest("Request body must be valid JSON.");
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid login request.", parsed.error.flatten());
    }
    const { email, password } = parsed.data;

    const ipKey = `login:ip:${clientAddress(request)}`;
    const emailKey = `login:email:${email}`;
    const ipLimit = consumeRateLimit(ipKey, IP_LIMIT, WINDOW_MS);
    const emailLimit = consumeRateLimit(emailKey, EMAIL_LIMIT, WINDOW_MS);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      throw AppError.tooManyRequests(
        "Too many sign-in attempts. Please wait a few minutes and try again.",
        Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds)
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Always run bcrypt, even for unknown emails, so timing does not reveal which emails exist.
    const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());

    if (!user || !valid || locked || user.status !== "ACTIVE") {
      if (user && !locked && user.status === "ACTIVE") {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (updated.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
          });
        }
      }
      await auditBestEffort({
        action: "auth.login",
        resourceType: "User",
        resourceId: user?.id,
        outcome: "DENIED",
        metadata: { email, reason: locked ? "locked" : user ? "invalid_credentials" : "unknown_user" },
      });
      throw AppError.unauthorized(GENERIC_FAILURE);
    }

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    resetRateLimit(emailKey);

    const token = await issueSession(user, membership?.organizationId);
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(request));

    await auditBestEffort({
      organizationId: membership?.organizationId,
      actorId: user.id,
      action: "auth.login",
      resourceType: "User",
      resourceId: user.id,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
