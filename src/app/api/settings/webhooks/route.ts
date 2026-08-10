import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, ADMIN_ONLY } from "@/lib/rbac";

export async function GET() {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const webhooks = await prisma.outboundWebhook.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ webhooks });
}

const createSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  event: z.enum(["LEAD_CREATED", "LEAD_STATUS_CHANGED", "LEAD_ASSIGNED"]),
});

export async function POST(req: NextRequest) {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const webhook = await prisma.outboundWebhook.create({
    data: { ...parsed.data, secret: crypto.randomBytes(24).toString("hex") },
  });

  return NextResponse.json({ webhook }, { status: 201 });
}
