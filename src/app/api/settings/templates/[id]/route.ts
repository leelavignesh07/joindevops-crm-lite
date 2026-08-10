import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, MANAGER_UP } from "@/lib/rbac";

const updateSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireRole(MANAGER_UP);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const template = await prisma.messageTemplate.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ template });
}
