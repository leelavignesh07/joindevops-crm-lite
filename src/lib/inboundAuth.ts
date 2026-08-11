import { prisma } from "@/lib/prisma";
import type { LeadSourceType, WebhookPurpose } from "@prisma/client";

/**
 * Every inbound webhook URL carries a per-source, per-purpose secret token, e.g.
 *   POST https://crm.example.com/api/webhooks/leads/tally?token=xxxxxxxx
 *   POST https://crm.example.com/api/webhooks/enrollments/learnyst?token=xxxxxxxx
 * Tokens are managed from Settings > Inbound Webhooks and stored hashed-free
 * (they're bearer secrets, not passwords) since they're rotated, not typed by humans.
 */
export async function verifyInboundToken(purpose: WebhookPurpose, source: LeadSourceType, token: string | null) {
  if (!token) return false;
  const key = await prisma.webhookInboundKey.findUnique({ where: { token } });
  return Boolean(key && key.active && key.purpose === purpose && key.source === source);
}
