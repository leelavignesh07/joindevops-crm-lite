const COLORS: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  WARM: "bg-amber-100 text-amber-700",
  COLD: "bg-sky-100 text-sky-700",
};

export default function ProbabilityBadge({ probability }: { probability: string }) {
  return <span className={`badge ${COLORS[probability] ?? "bg-slate-100 text-slate-700"}`}>{probability}</span>;
}
