"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { OutboundEvent, OutboundWebhook } from "@prisma/client";

const EVENTS: OutboundEvent[] = ["LEAD_CREATED", "LEAD_STATUS_CHANGED", "LEAD_ASSIGNED"];

export default function OutboundWebhooksPanel({ webhooks }: { webhooks: OutboundWebhook[] }) {
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [event, setEvent] = useState<OutboundEvent>("LEAD_CREATED");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function create() {
    if (!name || !targetUrl) {
      toast.error("Name and URL are required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/settings/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, targetUrl, event }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create webhook");
      toast.success("Outbound webhook created");
      setName("");
      setTargetUrl("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    setLoading(true);
    try {
      await fetch(`/api/settings/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    setLoading(true);
    try {
      await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" });
      toast.success("Webhook removed");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-slate-700">Outbound Webhooks (Pabbly Connect / Zapier)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Fire a signed JSON POST to a Pabbly Connect or Zapier &quot;Catch Hook&quot; URL whenever one of these
        events happens, so you can trigger any downstream automation (Slack pings, spreadsheets, extra WhatsApp
        flows, etc.).
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="input md:col-span-2"
          placeholder="https://connect.pabbly.com/workflow/sendwebhookdata/..."
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
        />
        <select className="input" value={event} onChange={(e) => setEvent(e.target.value as OutboundEvent)}>
          {EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary mt-2" disabled={loading} onClick={create}>
        Add webhook
      </button>

      <ul className="mt-4 space-y-2">
        {webhooks.map((hook) => (
          <li key={hook.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {hook.name} <span className="badge bg-slate-100 text-slate-600">{hook.event}</span>
              </p>
              <p className="truncate text-xs text-slate-500">{hook.targetUrl}</p>
              <p className="text-xs text-slate-400">Signing secret: {hook.secret.slice(0, 8)}…</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-secondary" disabled={loading} onClick={() => toggle(hook.id, !hook.active)}>
                {hook.active ? "Disable" : "Enable"}
              </button>
              <button className="btn-secondary" disabled={loading} onClick={() => remove(hook.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
        {webhooks.length === 0 && <p className="text-sm text-slate-400">No outbound webhooks configured yet.</p>}
      </ul>
    </section>
  );
}
