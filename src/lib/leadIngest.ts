import { prisma } from "@/lib/prisma";
import { pickNextAssignee } from "@/lib/assignment";
import { enqueueCommunication, enqueueOutboundWebhooksForEvent } from "@/lib/queue";
import type { LeadSourceType } from "@prisma/client";

export type NormalizedLeadInput = {
  name?: string;
  email?: string;
  phone?: string;
  course?: string;
  message?: string;
  source: LeadSourceType;
  sourceRef?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  rawPayload?: unknown;
};

/**
 * Single entry point used by every inbound webhook (Tally, Webflow,
 * Pabbly/Zapier relay incl. Meta Ads) and the manual "add lead" form.
 * Creates the lead, auto-assigns a rep, logs the activity, and queues the
 * acknowledgement email/WhatsApp + any outbound webhooks (LEAD_CREATED).
 */
export async function ingestLead(input: NormalizedLeadInput) {
  if (!input.email && !input.phone) {
    throw new Error("Lead requires at least an email or a phone number");
  }

  const assignedToId = await pickNextAssignee();

  const lead = await prisma.lead.create({
    data: {
      name: input.name?.slice(0, 200),
      email: input.email?.toLowerCase().trim(),
      phone: input.phone?.trim(),
      course: input.course?.slice(0, 200),
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

  if (lead.email) {
    await enqueueCommunication({ leadId: lead.id, channel: "EMAIL", templateKey: "lead_ack_email" });
  }
  if (lead.phone) {
    await enqueueCommunication({ leadId: lead.id, channel: "WHATSAPP", templateKey: "lead_ack_whatsapp" });
  }

  await enqueueOutboundWebhooksForEvent("LEAD_CREATED", lead.id);
  if (assignedToId) {
    await enqueueOutboundWebhooksForEvent("LEAD_ASSIGNED", lead.id);
  }

  return lead;
}
