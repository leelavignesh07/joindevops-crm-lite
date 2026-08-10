import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: Role;
  active: boolean;
};

/** Returns the current logged-in employee, or null if unauthenticated. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as unknown as SessionUser;
}

/** Throws-free guard for API routes: returns the user if allowed, else null. */
export async function requireRole(roles: Role[]): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user || !user.active) return null;
  if (!roles.includes(user.role)) return null;
  return user;
}

export const ALL_ROLES: Role[] = ["ADMIN", "MANAGER", "SALES"];
export const MANAGER_UP: Role[] = ["ADMIN", "MANAGER"];
export const ADMIN_ONLY: Role[] = ["ADMIN"];
