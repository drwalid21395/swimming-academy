export type AppRole = "ADMIN" | "PROFESSOR" | "STUDENT";

export const roleHome: Record<AppRole, string> = {
  ADMIN: "/admin",
  PROFESSOR: "/professor",
  STUDENT: "/student",
};

const protectedSections = ["/admin", "/professor", "/student"] as const;

export function isProtectedPath(pathname: string) {
  return protectedSections.some((section) => pathname === section || pathname.startsWith(`${section}/`));
}

export function canAccessPath(role: AppRole, pathname: string) {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return role === "ADMIN";
  if (pathname === "/professor" || pathname.startsWith("/professor/")) {
    return role === "PROFESSOR" || role === "ADMIN";
  }
  if (pathname === "/student" || pathname.startsWith("/student/")) {
    return role === "STUDENT" || role === "ADMIN";
  }
  return true;
}
