"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const PROBABILITIES = ["HOT", "WARM", "COLD"];

export default function LeadProbabilityControl({ leadId, currentProbability }: { leadId: string; currentProbability: string }) {
  const [probability, setProbability] = useState(currentProbability);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function updateProbability(next: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probability: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update probability");
      setProbability(next);
      toast.success(`Probability updated to ${next}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update probability");
    } finally {
      setLoading(false);
    }
  }

  return (
    <select className="input" value={probability} disabled={loading} onChange={(e) => updateProbability(e.target.value)}>
      {PROBABILITIES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
