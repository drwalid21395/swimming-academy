import { NextResponse } from "next/server";

import { withAuth } from "next-auth/middleware";

import { canAccessPath, isProtectedPath, type AppRole } from "@/lib/authorization";



export default withAuth(
  (request) => {
    const { pathname } = request.nextUrl;
    const role = request.nextauth.token?.role as AppRole | undefined;

    if (pathname === "/sign-in" && role) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    if (role && isProtectedPath(pathname) && !canAccessPath(role, pathname)) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => !isProtectedPath(req.nextUrl.pathname) || Boolean(token),
    },
    pages: { signIn: "/sign-in" },
  },
);

export const config = {
  matcher: ["/admin/:path*", "/professor/:path*", "/student/:path*", "/sign-in"],
};
