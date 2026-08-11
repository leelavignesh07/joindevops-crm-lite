import { prisma } from "@/lib/prisma";
import { pickNextAssignee } from "@/lib/assignment";
import { enqueueOutboundWebhooksForEvent } from "@/lib/queue";
import { findExistingLead, normalizeEmail, normalizeName, normalizePhone, recordNewIdentifiers } from "@/lib/dedupe";
import type { NormalizedEnrollmentInput } from "@/lib/enrollmentSourceParsers";

/**
 * Records a paid Learnyst course enrollment. Matches against existing Leads
 * with the same dedup logic as ingestLead (src/lib/dedupe.ts) — most
 * enrollments belong to a person already tracked from a demo/free-session
 * registration, but someone who buys directly without ever being tracked
 * gets a new Lead created for them here so they still show up in the CRM.
 *
 * The first Enrollment for a Lead marks it CONVERTED (and HOT) — this is
 * the "evaluate whether the lead converted or not" signal. Any later
 * Enrollment for an already-converted Lead is a repeat purchase, i.e. a
 * realized upsell.
 */
export async function ingestEnrollment(input: NormalizedEnrollmentInput) {
  if (!input.email && !input.phone) {
    throw new Error("Enrollment requires at least an email or a phone number");
  }

  const signals = {
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    name: normalizeName(input.name),
  };

  let leadId = await findExistingLead(signals);
  if (!leadId) {
    const assignedToId = await pickNextAssignee();
    const lead = await prisma.lead.create({
      data: {
        name: input.name?.slice(0, 200),
        email: input.email?.toLowerCase().trim(),
        phone: input.phone?.trim(),
        interestedCourse: input.courseName.slice(0, 200),
        source: input.source,
        assignedToId: assignedToId ?? undefined,
      },
    });
    leadId = lead.id;
    await prisma.leadActivity.create({
      data: { leadId, type: "CREATED", message: `Customer captured directly from a ${input.source} enrollment` },
    });
  }

  await recordNewIdentifiers(leadId, signals);

  const enrollment = await prisma.enrollment.create({
    data: {
      leadId,
      courseName: input.courseName.slice(0, 200),
      courseRef: input.courseRef,
      amount: input.amount ? Math.round(input.amount) : undefined,
      source: input.source,
      rawPayload: input.rawPayload as object | undefined,
    },
  });

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!lead.convertedAt) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedAt: new Date(), status: "CONVERTED", probability: "HOT" },
    });
    await enqueueOutboundWebhooksForEvent("LEAD_STATUS_CHANGED", leadId);
  }

  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "ENROLLED",
      message: `Enrolled in ${input.courseName}${input.amount ? ` (₹${input.amount})` : ""}`,
    },
  });
  await enqueueOutboundWebhooksForEvent("ENROLLMENT_CREATED", leadId);

  return enrollment;
}
