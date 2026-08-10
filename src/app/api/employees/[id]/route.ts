import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, ADMIN_ONLY } from "@/lib/rbac";

const updateSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireRole(ADMIN_ONLY);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (params.id === admin.id && (parsed.data.active === false || parsed.data.role === "SALES")) {
    return NextResponse.json({ error: "You cannot demote or deactivate your own account" }, { status: 400 });
  }

  const employee = await prisma.user.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ employee });
}
