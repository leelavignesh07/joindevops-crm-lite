import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, MANAGER_UP } from "@/lib/rbac";

export async function GET() {
  const user = await requireRole(MANAGER_UP);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const templates = await prisma.messageTemplate.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ templates });
}
