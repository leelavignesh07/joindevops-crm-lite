import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, MANAGER_UP } from "@/lib/rbac";

export async function GET() {
  const user = await requireRole(MANAGER_UP);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const employees = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { assignedLeads: true } },
    },
  });

  return NextResponse.json({ employees });
}
