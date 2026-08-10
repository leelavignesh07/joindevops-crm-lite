"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { MessageTemplate } from "@prisma/client";

export default function TemplatesPanel({ templates }: { templates: MessageTemplate[] }) {
  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-slate-700">Acknowledgement Templates</h2>
      <p className="mt-1 text-xs text-slate-500">
        Placeholders: <code>{"{{name}}"}</code>, <code>{"{{course}}"}</code>, <code>{"{{source}}"}</code>,{" "}
        <code>{"{{brand}}"}</code>. WhatsApp acknowledgements use a WATI-approved template (configured via the{" "}
        <code>WATI_ACK_TEMPLATE_NAME</code> env var) — the body below is for reference/fallback session messages.
      </p>
      <div className="mt-4 space-y-4">
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} />
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-slate-400">No templates found — run the seed script to create defaults.</p>
        )}
      </div>
    </section>
  );
}

function TemplateRow({ template }: { template: MessageTemplate }) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [isActive, setIsActive] = useState(template.isActive);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function save() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save template");
      toast.success("Template saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">
          {template.name} <span className="badge bg-slate-100 text-slate-600">{template.channel}</span>
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>
      {template.channel === "EMAIL" && (
        <input className="input mt-2" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
      )}
      <textarea className="input mt-2" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn-primary mt-2" disabled={loading} onClick={save}>
        Save
      </button>
    </div>
  );
}
