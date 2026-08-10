"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button className="btn-secondary w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
