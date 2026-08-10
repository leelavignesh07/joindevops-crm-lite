"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Rep = { id: string; name: string | null; email: string };

export default function LeadAssignControl({
  leadId,
  currentAssigneeId,
  salesReps,
}: {
  leadId: string;
  currentAssigneeId: string | null;
  salesReps: Rep[];
}) {
  const [assigneeId, setAssigneeId] = useState(currentAssigneeId ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function updateAssignee(next: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to reassign");
      setAssigneeId(next);
      toast.success("Lead reassigned");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reassign");
    } finally {
      setLoading(false);
    }
  }

  return (
    <select className="input" value={assigneeId} disabled={loading} onChange={(e) => updateAssignee(e.target.value)}>
      <option value="">Unassigned</option>
      {salesReps.map((rep) => (
        <option key={rep.id} value={rep.id}>
          {rep.name ?? rep.email}
        </option>
      ))}
    </select>
  );
}
