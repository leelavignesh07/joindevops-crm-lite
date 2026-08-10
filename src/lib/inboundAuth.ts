import { prisma } from "@/lib/prisma";
import type { LeadSourceType } from "@prisma/client";

/**
 * Every inbound lead webhook URL carries a per-source secret token, e.g.
 *   POST https://crm.example.com/api/webhooks/leads/tally?token=xxxxxxxx
 * Tokens are managed from Settings > Inbound Webhooks and stored hashed-free
 * (they're bearer secrets, not passwords) since they're rotated, not typed by humans.
 */
export async function verifyInboundToken(source: LeadSourceType, token: string | null) {
  if (!token) return false;
  const key = await prisma.webhookInboundKey.findUnique({ where: { token } });
  return Boolean(key && key.active && key.source === source);
}
