import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import type { Prisma } from "@prisma/client";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  WON: "Won",
  LOST: "Lost",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const scopeWhere: Prisma.LeadWhereInput = user?.role === "SALES" ? { assignedToId: user.id } : {};

  const [byStatus, bySource, totalLeads, last7Days] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: scopeWhere, _count: true }),
    prisma.lead.groupBy({ by: ["source"], where: scopeWhere, _count: true }),
    prisma.lead.count({ where: scopeWhere }),
    prisma.lead.count({
      where: { ...scopeWhere, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        {user?.role === "SALES" ? "Your leads at a glance." : "Team-wide lead overview."}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <p className="text-xs font-medium uppercase text-slate-500">Total Leads</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{totalLeads}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium uppercase text-slate-500">New (7 days)</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{last7Days}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium uppercase text-slate-500">Won</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">{statusMap.WON ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium uppercase text-slate-500">Open</p>
          <p className="mt-1 text-3xl font-bold text-brand-600">
            {totalLeads - (statusMap.WON ?? 0) - (statusMap.LOST ?? 0)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">By Pipeline Stage</h2>
          <div className="space-y-2">
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{label}</span>
                <span className="font-medium text-slate-900">{statusMap[key] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">By Source</h2>
          <div className="space-y-2">
            {bySource.map((s) => (
              <div key={s.source} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{s.source}</span>
                <span className="font-medium text-slate-900">{s._count}</span>
              </div>
            ))}
            {bySource.length === 0 && <p className="text-sm text-slate-400">No leads yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
