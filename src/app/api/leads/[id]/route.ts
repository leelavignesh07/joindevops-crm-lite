import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import { enqueueOutboundWebhooksForEvent } from "@/lib/queue";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } } } },
      communications: { orderBy: { createdAt: "desc" } },
      enrollments: { orderBy: { enrolledAt: "desc" } },
      registrations: { orderBy: { sequence: "desc" } },
      identifiers: true,
    },
  });

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.role === "SALES" && lead.assignedToId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ lead });
}

const updateLeadSchema = z.object({
  status: z
    .enum(["NEW", "CONTACTED", "DEMO_SCHEDULED", "DEMO_ATTENDED", "FOLLOW_UP", "CONVERTED", "NOT_CONVERTED"])
    .optional(),
  probability: z.enum(["HOT", "WARM", "COLD"]).optional(),
  assignedToId: z.string().optional(),
  name: z.string().optional(),
  interestedCourse: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.lead.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.role === "SALES" && existing.assignedToId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateLeadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Only MANAGER/ADMIN may reassign leads to someone else.
  if (parsed.data.assignedToId && user.role === "SALES") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const lead = await prisma.lead.update({ where: { id: params.id }, data: parsed.data });

  const activities = [];
  if (parsed.data.status && parsed.data.status !== existing.status) {
    activities.push({
      leadId: lead.id,
      userId: user.id,
      type: "STATUS_CHANGE" as const,
      message: `Status changed from ${existing.status} to ${parsed.data.status}`,
    });
  }
  if (parsed.data.probability && parsed.data.probability !== existing.probability) {
    activities.push({
      leadId: lead.id,
      userId: user.id,
      type: "PROBABILITY_CHANGE" as const,
      message: `Probability changed from ${existing.probability} to ${parsed.data.probability}`,
    });
  }
  if (parsed.data.assignedToId && parsed.data.assignedToId !== existing.assignedToId) {
    activities.push({
      leadId: lead.id,
      userId: user.id,
      type: "ASSIGNED" as const,
      message: "Manually reassigned",
      metadata: { assignedToId: parsed.data.assignedToId },
    });
  }
  if (activities.length) {
    await prisma.leadActivity.createMany({ data: activities });
  }

  if (parsed.data.status && parsed.data.status !== existing.status) {
    await enqueueOutboundWebhooksForEvent("LEAD_STATUS_CHANGED", lead.id);
  }
  if (parsed.data.assignedToId && parsed.data.assignedToId !== existing.assignedToId) {
    await enqueueOutboundWebhooksForEvent("LEAD_ASSIGNED", lead.id);
  }

  return NextResponse.json({ lead });
}
