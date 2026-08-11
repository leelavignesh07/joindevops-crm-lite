const COLORS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  DEMO_SCHEDULED: "bg-sky-100 text-sky-700",
  DEMO_ATTENDED: "bg-brand-50 text-brand-700",
  FOLLOW_UP: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-emerald-100 text-emerald-700",
  NOT_CONVERTED: "bg-red-100 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace(/_/g, " ")}</span>;
}
