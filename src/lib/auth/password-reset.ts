import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { recordAuditEvent } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { sendMail } from "@/lib/mail";
import { notifyUser } from "@/lib/admin/notifications";
import { ROLES } from "@/lib/authz/permissions";

const TOKEN_TTL_MS = 30 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Links must never be built from the request Host header (reset-link poisoning), so production
// requires APP_BASE_URL; development falls back to the request origin.
export function appBaseUrl(request: Request): string | null {
  const configured = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
}

// Always completes the same way whether or not the account exists. Reset tokens are single-use,
// expire after 30 minutes and are stored only as a hash.
export async function requestPasswordReset(email: string, baseUrl: string | null) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
    }),
  ]);

  const delivered = baseUrl
    ? await sendMail({
        to: user.email,
        subject: "Reset your TIMS password",
        text:
          `Hello ${user.displayName},\n\nUse the link below to choose a new password. ` +
          `It works once and expires in 30 minutes.\n\n${baseUrl}/reset-password?token=${token}\n\n` +
          "If you did not ask for this, you can ignore this message.",
      })
    : false;

  // Without a working mail transport, hand the request to administrators who can reset it manually.
  if (!delivered) {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { organizationId: true },
    });
    const admins = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        role: ROLES.SUPER_ADMIN,
        memberships: { some: { organizationId: { in: memberships.map((m) => m.organizationId) }, status: "ACTIVE" } },
      },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        notifyUser(admin.id, {
          type: "PASSWORD_RESET_REQUESTED",
          title: `Password reset requested: ${user.email}`,
          message: `${user.displayName} asked to reset their password. Set a temporary password from the Users page.`,
        })
      )
    );
  }
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, status: true } } },
  });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== "ACTIVE") {
    throw AppError.badRequest("This reset link is invalid or has expired. Request a new one.");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // Consuming the token first means a second use of the same link cannot succeed.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.badRequest("This reset link is invalid or has expired. Request a new one.");

    await tx.user.update({
      where: { id: record.userId },
      // Bumping tokenVersion signs the user out everywhere; the lockout is cleared as well.
      data: { passwordHash, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId, id: { not: record.id } } });
    await recordAuditEvent(
      {
        actorId: record.userId,
        action: "auth.password_reset_completed",
        resourceType: "User",
        resourceId: record.userId,
      },
      tx
    );
  });
}
