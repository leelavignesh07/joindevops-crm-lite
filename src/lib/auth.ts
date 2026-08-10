import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

const ALLOWED_DOMAIN = process.env.ALLOWED_GOOGLE_WORKSPACE_DOMAIN ?? "joindevops.com";

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      authorization: {
        params: {
          hd: ALLOWED_DOMAIN,
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = user.email ?? "";
      if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN.toLowerCase()}`)) {
        return false;
      }
      // Google's hd claim double-checks the Workspace domain when present.
      const hd = (profile as { hd?: string } | undefined)?.hd;
      if (account?.provider === "google" && hd && hd.toLowerCase() !== ALLOWED_DOMAIN.toLowerCase()) {
        return false;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        const usersCount = await prisma.user.count();
        // First user to ever sign in becomes ADMIN automatically; everyone else
        // starts as SALES and an admin promotes them from the Employees page.
        await prisma.user.create({
          data: {
            email,
            name: user.name,
            image: user.image,
            role: usersCount === 0 ? "ADMIN" : "SALES",
          },
        });
      } else if (!existing.active) {
        return false;
      }
      return true;
    },
    async session({ session }) {
      if (session.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true, role: true, active: true },
        });
        if (dbUser) {
          (session.user as { id: string; role: Role; active: boolean }).id = dbUser.id;
          (session.user as { id: string; role: Role; active: boolean }).role = dbUser.role;
          (session.user as { id: string; role: Role; active: boolean }).active = dbUser.active;
        }
      }
      return session;
    },
  },
};
