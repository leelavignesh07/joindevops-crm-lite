const COLORS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  QUALIFIED: "bg-amber-100 text-amber-700",
  PROPOSAL: "bg-purple-100 text-purple-700",
  WON: "bg-emerald-100 text-emerald-700",
  LOST: "bg-red-100 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status}</span>;
}
