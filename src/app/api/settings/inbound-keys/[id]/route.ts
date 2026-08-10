import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, ADMIN_ONLY } from "@/lib/rbac";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.webhookInboundKey.update({ where: { id: params.id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
