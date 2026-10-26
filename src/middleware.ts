/**
 * Middleware d'accès aux pages et d'émission du jeton CSRF (§8).
 *
 * Le middleware ne vérifie que la présence du cookie de session : la validité
 * réelle (base de données, expiration, révocation) est contrôlée dans le
 * layout serveur. Aucune décision d'autorisation ne repose sur ce seul filtre.
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "mt5_session";
const CSRF_COOKIE = "mt5_csrf";

const PROTECTED_PREFIXES = ["/robots", "/historique", "/journaux", "/compte"];

function randomCsrfToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isProtectedPage =
    pathname === "/" || PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isProtectedPage && !request.cookies.get(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("suite", pathname);
    return NextResponse.redirect(login);
  }

  if (pathname === "/login" && request.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  if (!request.cookies.get(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, randomCsrfToken(), {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86_400,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
