import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, ADMIN_ONLY } from "@/lib/rbac";

const updateSchema = z.object({ active: z.boolean().optional(), targetUrl: z.string().url().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const webhook = await prisma.outboundWebhook.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ webhook });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.outboundWebhook.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
