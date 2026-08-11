"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const STATUSES = ["NEW", "CONTACTED", "DEMO_SCHEDULED", "DEMO_ATTENDED", "FOLLOW_UP", "CONVERTED", "NOT_CONVERTED"];

export default function LeadStatusControl({ leadId, currentStatus }: { leadId: string; currentStatus: string }) {
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function updateStatus(next: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update status");
      setStatus(next);
      toast.success(`Status updated to ${next}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setLoading(false);
    }
  }

  return (
    <select
      className="input"
      value={status}
      disabled={loading}
      onChange={(e) => updateStatus(e.target.value)}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
