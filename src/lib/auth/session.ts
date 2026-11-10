import jwt from "jsonwebtoken";

// The session token only carries identity + selected organizational context.
// Permissions are never trusted from the token — they are recomputed from
// the database on every request (see lib/authz/authorize.ts).
export interface SessionPayload {
  userId: string;
  /** Token version the user had when this session was issued (see User.tokenVersion). */
  tv?: number;
  organizationId?: string;
  facilityId?: string;
  departmentId?: string;
  projectId?: string | null;
}

const MIN_SECRET_LENGTH = 16;
const MIN_PRODUCTION_SECRET_LENGTH = 32;
// Values copied from examples or docs; matched at the start so a genuinely random secret is never refused.
const PLACEHOLDER_PREFIXES = ["replace-with", "changeme", "change-me", "your-secret", "your_secret", "example", "secret"];

// Resolved lazily so `next build` can import route modules without runtime secrets, while
// production still refuses to sign or verify a session with a weak or placeholder secret.
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  const production = process.env.NODE_ENV === "production";
  const minimum = production ? MIN_PRODUCTION_SECRET_LENGTH : MIN_SECRET_LENGTH;
  if (!secret || secret.length < minimum) {
    throw new Error(`JWT_SECRET must be configured with at least ${minimum} characters.`);
  }
  if (production) {
    const lower = secret.toLowerCase();
    if (PLACEHOLDER_PREFIXES.some((p) => lower.startsWith(p)) || new Set(secret).size < 10) {
      throw new Error("JWT_SECRET is still set to a placeholder or low-entropy value. Generate a strong random secret.");
    }
  }
  return secret;
}

const EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: EXPIRY_SECONDS, algorithm: "HS256" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as SessionPayload & jwt.JwtPayload;
  } catch (error) {
    // A misconfigured secret is an operator error, not an invalid token; surface it loudly.
    if (error instanceof Error && error.message.startsWith("JWT_SECRET")) throw error;
    return null;
  }
}

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "tims_session";
export const SESSION_MAX_AGE = EXPIRY_SECONDS;

// Browsers drop `Secure` cookies over plain HTTP, so only set it when the request really is HTTPS
// (or when SESSION_COOKIE_SECURE forces it). Otherwise LAN access via http://<ip>:3000 cannot log in.
export function sessionCookieOptions(request: Request) {
  const override = process.env.SESSION_COOKIE_SECURE;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    new URL(request.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    secure: override ? override === "true" : proto === "https",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}
