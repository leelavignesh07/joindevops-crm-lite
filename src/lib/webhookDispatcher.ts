import crypto from "node:crypto";
import type { Lead, OutboundWebhook } from "@prisma/client";

/**
 * Fires a signed POST to a configured Pabbly Connect / Zapier catch hook.
 * Receivers should verify the X-CRM-Signature header:
 *   hex(hmac_sha256(secret, rawBody)) === header value
 */
export async function dispatchOutboundWebhook(
  hook: Pick<OutboundWebhook, "targetUrl" | "secret" | "event">,
  lead: Lead
) {
  const payload = {
    event: hook.event,
    timestamp: new Date().toISOString(),
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      interestedCourse: lead.interestedCourse,
      source: lead.source,
      sourceRef: lead.sourceRef,
      status: lead.status,
      probability: lead.probability,
      convertedAt: lead.convertedAt,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
      assignedToId: lead.assignedToId,
      createdAt: lead.createdAt,
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", hook.secret).update(rawBody).digest("hex");

  const res = await fetch(hook.targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CRM-Signature": signature,
      "X-CRM-Event": hook.event,
    },
    body: rawBody,
  });

  if (!res.ok) {
    throw new Error(`Outbound webhook failed with status ${res.status}`);
  }
}
