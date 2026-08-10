import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import TemplatesPanel from "@/components/settings/TemplatesPanel";
import OutboundWebhooksPanel from "@/components/settings/OutboundWebhooksPanel";
import InboundKeysPanel from "@/components/settings/InboundKeysPanel";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const [templates, webhooks, keys] = await Promise.all([
    prisma.messageTemplate.findMany({ orderBy: { key: "asc" } }),
    prisma.outboundWebhook.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.webhookInboundKey.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage acknowledgement templates, inbound lead webhook URLs, and outbound integrations to Pabbly/Zapier.
        </p>
      </div>

      <InboundKeysPanel keys={keys} />
      <OutboundWebhooksPanel webhooks={webhooks} />
      <TemplatesPanel templates={templates} />
    </div>
  );
}
