import { Queue } from "bullmq";
import { redisConnection } from "@/lib/redis";

export const COMMUNICATION_QUEUE = "communications";
export const OUTBOUND_WEBHOOK_QUEUE = "outbound-webhooks";

export type CommunicationJob = {
  leadId: string;
  channel: "EMAIL" | "WHATSAPP";
  templateKey: string;
  triggeredById?: string;
};

export type OutboundWebhookJob = {
  outboundWebhookId: string;
  event: "LEAD_CREATED" | "LEAD_STATUS_CHANGED" | "LEAD_ASSIGNED";
  leadId: string;
};

export const communicationQueue = new Queue<CommunicationJob>(COMMUNICATION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const outboundWebhookQueue = new Queue<OutboundWebhookJob>(OUTBOUND_WEBHOOK_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export async function enqueueCommunication(job: CommunicationJob) {
  await communicationQueue.add("send", job);
}

export async function enqueueOutboundWebhooksForEvent(
  event: OutboundWebhookJob["event"],
  leadId: string
) {
  const { prisma } = await import("@/lib/prisma");
  const hooks = await prisma.outboundWebhook.findMany({
    where: { event, active: true },
  });
  for (const hook of hooks) {
    await outboundWebhookQueue.add("dispatch", {
      outboundWebhookId: hook.id,
      event,
      leadId,
    });
  }
}
