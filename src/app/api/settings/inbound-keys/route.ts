import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, ADMIN_ONLY } from "@/lib/rbac";

export async function GET() {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const keys = await prisma.webhookInboundKey.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ keys });
}

const LEAD_SOURCES = ["TALLY", "WEBFLOW", "PABBLY", "ZAPIER", "LEARNYST"] as const;
const ENROLLMENT_SOURCES = ["LEARNYST", "PABBLY", "ZAPIER"] as const;

const createSchema = z
  .object({
    purpose: z.enum(["LEAD", "ENROLLMENT"]).default("LEAD"),
    source: z.enum(["TALLY", "WEBFLOW", "PABBLY", "ZAPIER", "LEARNYST"]),
  })
  .refine(
    (data) =>
      data.purpose === "LEAD"
        ? (LEAD_SOURCES as readonly string[]).includes(data.source)
        : (ENROLLMENT_SOURCES as readonly string[]).includes(data.source),
    { message: "Source is not valid for the selected purpose" }
  );

export async function POST(req: NextRequest) {
  const user = await requireRole(ADMIN_ONLY);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const key = await prisma.webhookInboundKey.create({
    data: {
      purpose: parsed.data.purpose,
      source: parsed.data.source,
      token: crypto.randomBytes(20).toString("hex"),
    },
  });

  return NextResponse.json({ key }, { status: 201 });
}
