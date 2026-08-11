"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { LeadSourceType, WebhookInboundKey, WebhookPurpose } from "@prisma/client";

const LEAD_SOURCES: LeadSourceType[] = ["TALLY", "WEBFLOW", "PABBLY", "ZAPIER", "LEARNYST"];
const ENROLLMENT_SOURCES: LeadSourceType[] = ["LEARNYST", "PABBLY", "ZAPIER"];
const SLUG_BY_SOURCE: Record<string, string> = {
  TALLY: "tally",
  WEBFLOW: "webflow",
  PABBLY: "pabbly",
  ZAPIER: "zapier",
  LEARNYST: "learnyst",
};
const BASE_PATH: Record<WebhookPurpose, string> = {
  LEAD: "/api/webhooks/leads",
  ENROLLMENT: "/api/webhooks/enrollments",
};

export default function InboundKeysPanel({ keys }: { keys: WebhookInboundKey[] }) {
  const [purpose, setPurpose] = useState<WebhookPurpose>("LEAD");
  const [source, setSource] = useState<LeadSourceType>("TALLY");
  const [loading, setLoading] = useState(false);
  const [origin, setOrigin] = useState("");
  const router = useRouter();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const sourceOptions = purpose === "LEAD" ? LEAD_SOURCES : ENROLLMENT_SOURCES;

  function onPurposeChange(next: WebhookPurpose) {
    setPurpose(next);
    const options = next === "LEAD" ? LEAD_SOURCES : ENROLLMENT_SOURCES;
    if (!options.includes(source)) setSource(options[0]!);
  }

  async function createKey() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/inbound-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, source }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create key");
      toast.success("Webhook URL created");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/inbound-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke key");
      toast.success("Key revoked");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    toast.success("Copied to clipboard");
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-slate-700">Inbound Webhooks</h2>
      <p className="mt-1 text-xs text-slate-500">
        <strong>Lead</strong> webhooks capture a new demo/free-session registration (Tally, Webflow, Learnyst, or a
        Pabbly/Zapier scenario that also relays Meta Ads leads). <strong>Enrollment</strong> webhooks record a paid
        Learnyst course purchase, converting the matching lead. Give each source its own secret URL below and paste
        it into that tool&apos;s webhook/HTTP action config.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <select className="input max-w-[10rem]" value={purpose} onChange={(e) => onPurposeChange(e.target.value as WebhookPurpose)}>
          <option value="LEAD">Lead</option>
          <option value="ENROLLMENT">Enrollment</option>
        </select>
        <select className="input max-w-[10rem]" value={source} onChange={(e) => setSource(e.target.value as LeadSourceType)}>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={loading} onClick={createKey}>
          Generate URL
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {keys.map((k) => {
          const url = `${origin}${BASE_PATH[k.purpose]}/${SLUG_BY_SOURCE[k.source]}?token=${k.token}`;
          return (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  {k.purpose} · {k.source}
                  {!k.active && " (revoked)"}
                </p>
                <p className="truncate font-mono text-xs text-slate-700">{url}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-secondary" onClick={() => copy(url)}>
                  Copy
                </button>
                {k.active && (
                  <button className="btn-secondary" disabled={loading} onClick={() => revoke(k.id)}>
                    Revoke
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {keys.length === 0 && <p className="text-sm text-slate-400">No webhook URLs generated yet.</p>}
      </ul>
    </section>
  );
}
