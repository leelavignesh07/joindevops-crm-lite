import { prisma } from "@/lib/prisma";
import { pickNextAssignee } from "@/lib/assignment";
import { enqueueCommunication, enqueueOutboundWebhooksForEvent } from "@/lib/queue";
import { findExistingLead, normalizeEmail, normalizeIp, normalizeName, normalizePhone, recordNewIdentifiers } from "@/lib/dedupe";
import type { LeadSourceType } from "@prisma/client";

export type NormalizedLeadInput = {
  name?: string;
  email?: string;
  phone?: string;
  course?: string; // the demo/free-session/course this particular registration is for
  message?: string;
  source: LeadSourceType;
  sourceRef?: string;
  ipAddress?: string; // only present when the upstream form forwards the visitor's IP
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  rawPayload?: unknown;
};

const DUPLICATE_SUBMIT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Single entry point used by every inbound webhook (Tally, Webflow, Learnyst,
 * the Pabbly/Zapier relay incl. Meta Ads) and the manual "add lead" form.
 *
 * Every registration is first checked against existing Leads (src/lib/dedupe.ts)
 * so the same person never ends up as two Lead rows even if they used a
 * different email, phone, or came from a different source. A brand-new person
 * gets a new Lead + round-robin assignment; a person we've already seen gets a
 * new LeadRegistration touchpoint recorded against their existing Lead.
 */
export async function ingestLead(input: NormalizedLeadInput) {
  if (!input.email && !input.phone) {
    throw new Error("Lead requires at least an email or a phone number");
  }

  const signals = {
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    name: normalizeName(input.name),
    ip: normalizeIp(input.ipAddress),
  };

  const matchedLeadId = await findExistingLead(signals);
  if (matchedLeadId) {
    return reRegisterExistingLead(matchedLeadId, input, signals);
  }
  return createNewLead(input, signals);
}

async function createNewLead(
  input: NormalizedLeadInput,
  signals: { email?: string; phone?: string; ip?: string }
) {
  const assignedToId = await pickNextAssignee();

  const lead = await prisma.lead.create({
    data: {
      name: input.name?.slice(0, 200),
      email: input.email?.toLowerCase().trim(),
      phone: input.phone?.trim(),
      interestedCourse: input.course?.slice(0, 200),
      message: input.message?.slice(0, 2000),
      source: input.source,
      sourceRef: input.sourceRef,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      rawPayload: input.rawPayload as object | undefined,
      assignedToId: assignedToId ?? undefined,
    },
  });

  await Promise.all([
    prisma.leadRegistration.create({
      data: {
        leadId: lead.id,
        source: input.source,
        sourceRef: input.sourceRef,
        course: input.course?.slice(0, 200),
        ipAddress: input.ipAddress,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        rawPayload: input.rawPayload as object | undefined,
      },
    }),
    recordNewIdentifiers(lead.id, signals),
  ]);

  await prisma.leadActivity.createMany({
    data: [
      {
        leadId: lead.id,
        type: "CREATED",
        message: `Lead captured from ${lead.source}${lead.sourceRef ? ` (${lead.sourceRef})` : ""}`,
      },
      ...(assignedToId
        ? [
            {
              leadId: lead.id,
              type: "ASSIGNED" as const,
              message: "Auto-assigned via round robin",
              metadata: { assignedToId },
            },
          ]
        : []),
    ],
  });

  await enqueueAcknowledgements(lead.id, lead.email, lead.phone);
  await enqueueOutboundWebhooksForEvent("LEAD_CREATED", lead.id);
  if (assignedToId) {
    await enqueueOutboundWebhooksForEvent("LEAD_ASSIGNED", lead.id);
  }

  return lead;
}

async function reRegisterExistingLead(
  leadId: string,
  input: NormalizedLeadInput,
  signals: { email?: string; phone?: string; ip?: string }
) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const lastRegistration = await prisma.leadRegistration.findFirst({
    where: { leadId },
    orderBy: { sequence: "desc" },
  });
  const isRetrySubmit =
    lastRegistration &&
    lastRegistration.source === input.source &&
    (lastRegistration.course ?? null) === (input.course?.slice(0, 200) ?? null) &&
    Date.now() - lastRegistration.createdAt.getTime() < DUPLICATE_SUBMIT_WINDOW_MS;
  if (isRetrySubmit) {
    return lead; // webhook retry / accidental double form-submit — don't log or re-notify
  }

  await Promise.all([
    prisma.leadRegistration.create({
      data: {
        leadId,
        source: input.source,
        sourceRef: input.sourceRef,
        course: input.course?.slice(0, 200),
        ipAddress: input.ipAddress,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        rawPayload: input.rawPayload as object | undefined,
      },
    }),
    recordNewIdentifiers(leadId, signals),
  ]);

  const updateData: { interestedCourse?: string; upsellFlaggedAt?: Date } = {};
  if (input.course) updateData.interestedCourse = input.course.slice(0, 200);
  const isUpsellSignal = Boolean(lead.convertedAt) && !lead.upsellFlaggedAt;
  if (isUpsellSignal) updateData.upsellFlaggedAt = new Date();

  if (Object.keys(updateData).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data: updateData });
  }

  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "RE_REGISTERED",
      message: `Registered again via ${input.source}${input.course ? ` for ${input.course}` : ""}`,
    },
  });

  if (isUpsellSignal) {
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: "UPSELL_FLAGGED",
        message: `Existing customer showed renewed interest${input.course ? ` in ${input.course}` : ""} — potential upsell`,
      },
    });
  }

  await enqueueAcknowledgements(leadId, lead.email ?? input.email, lead.phone ?? input.phone);

  return lead;
}

async function enqueueAcknowledgements(leadId: string, email?: string | null, phone?: string | null) {
  if (email) {
    await enqueueCommunication({ leadId, channel: "EMAIL", templateKey: "lead_ack_email" });
  }
  if (phone) {
    await enqueueCommunication({ leadId, channel: "WHATSAPP", templateKey: "lead_ack_whatsapp" });
  }
}
