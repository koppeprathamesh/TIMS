import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";

// Unauthenticated visitors never get the protected UI shell; role/scope checks stay in the API.
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token && verifySession(token)) return NextResponse.next();

  const response = NextResponse.redirect(new URL("/login", request.url));
  if (token) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export const config = {
  matcher: [
    "/app/:path*",
    "/select-facility",
    "/select-department",
    "/select-project",
    "/dashboard",
    "/tool/:path*",
    "/edit-tool/:path*",
  ],
};
