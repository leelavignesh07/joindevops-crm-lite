/**
 * Standalone worker process (run via `npm run worker`, separate container/
 * process from the Next.js web app). Consumes the "communications" queue
 * (acknowledgement emails/WhatsApp) and the "outbound-webhooks" queue
 * (Pabbly Connect / Zapier relays), so a slow provider never blocks a page load.
 */
import { Worker, type Job } from "bullmq";
import { redisConnection } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { sendAcknowledgementEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { renderTemplate } from "@/lib/templates";
import { dispatchOutboundWebhook } from "@/lib/webhookDispatcher";
import {
  COMMUNICATION_QUEUE,
  OUTBOUND_WEBHOOK_QUEUE,
  type CommunicationJob,
  type OutboundWebhookJob,
} from "@/lib/queue";

async function processCommunication(job: Job<CommunicationJob>) {
  const { leadId, channel, templateKey, triggeredById } = job.data;

  const [lead, template] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.messageTemplate.findUnique({ where: { key: templateKey } }),
  ]);

  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!template || !template.isActive) {
    return; // Template disabled/missing: skip silently, no communication row needed.
  }

  const communication = await prisma.communication.create({
    data: { leadId, channel, templateKey, triggeredById, status: "PENDING" },
  });

  try {
    let providerMessageId: string | undefined;

    if (channel === "EMAIL") {
      if (!lead.email) throw new Error("Lead has no email address");
      providerMessageId = await sendAcknowledgementEmail({
        to: lead.email,
        subject: renderTemplate(template.subject ?? "Thanks for reaching out!", lead),
        bodyText: renderTemplate(template.body, lead),
      });
    } else {
      if (!lead.phone) throw new Error("Lead has no phone number");
      const watiTemplateName = process.env.WATI_ACK_TEMPLATE_NAME ?? "lead_acknowledgement";
      const result = await sendWhatsAppTemplate({
        phone: lead.phone,
        templateName: watiTemplateName,
        bodyParams: [lead.name?.trim() || "there"],
      });
      providerMessageId = typeof result === "object" ? JSON.stringify(result).slice(0, 200) : undefined;
    }

    await prisma.communication.update({
      where: { id: communication.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId },
    });
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: channel === "EMAIL" ? "EMAIL_SENT" : "WHATSAPP_SENT",
        message: `${channel === "EMAIL" ? "Acknowledgement email" : "WhatsApp acknowledgement"} sent`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.communication.update({
      where: { id: communication.id },
      data: { status: "FAILED", error: message.slice(0, 500) },
    });
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: channel === "EMAIL" ? "EMAIL_FAILED" : "WHATSAPP_FAILED",
        message: `Failed to send ${channel.toLowerCase()}: ${message}`.slice(0, 500),
      },
    });
    throw err; // let BullMQ retry with backoff
  }
}

async function processOutboundWebhook(job: Job<OutboundWebhookJob>) {
  const { outboundWebhookId, leadId, event } = job.data;

  const [hook, lead] = await Promise.all([
    prisma.outboundWebhook.findUnique({ where: { id: outboundWebhookId } }),
    prisma.lead.findUnique({ where: { id: leadId } }),
  ]);
  if (!hook || !hook.active || !lead) return;

  try {
    await dispatchOutboundWebhook(hook, lead);
    await prisma.leadActivity.create({
      data: { leadId, type: "WEBHOOK_FIRED", message: `${event} webhook sent to ${hook.name}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.leadActivity.create({
      data: { leadId, type: "WEBHOOK_FIRED", message: `${event} webhook to ${hook.name} FAILED: ${message}`.slice(0, 500) },
    });
    throw err;
  }
}

const communicationWorker = new Worker<CommunicationJob>(COMMUNICATION_QUEUE, processCommunication, {
  connection: redisConnection,
  concurrency: 5,
});

const outboundWebhookWorker = new Worker<OutboundWebhookJob>(OUTBOUND_WEBHOOK_QUEUE, processOutboundWebhook, {
  connection: redisConnection,
  concurrency: 5,
});

for (const worker of [communicationWorker, outboundWebhookWorker]) {
  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} in queue ${worker.name} failed:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[worker] job ${job.id} in queue ${worker.name} completed`);
  });
}

console.log("Communication worker started, listening for jobs...");

process.on("SIGTERM", async () => {
  await Promise.all([communicationWorker.close(), outboundWebhookWorker.close()]);
  process.exit(0);
});
