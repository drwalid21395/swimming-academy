"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/20"
      onClick={() => signOut({ callbackUrl: "/sign-in" })}
      type="button"
    >
      <LogOut aria-hidden className="size-4" />
      خروج
    </button>
  );
}
